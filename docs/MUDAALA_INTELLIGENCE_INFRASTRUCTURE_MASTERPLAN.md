# Mudaala Intelligence Infrastructure — Master Plan

**Status:** Architecture baseline and implementation plan; not an implementation-completion claim.  
**Owner:** Mudaala project owner  
**Created:** 2026-11-20  
**Repository:** `isaJrKai/mudaala-cloudflare`  
**Baseline audited:** `main` at `cdfb6f6d07406fedad4786d65023d8b2910b358d`  
**Working branch:** `docs/mudaala-intelligence-masterplan-2026-11-20`

> This document is the working source of truth for the separate Mudaala Intelligence Infrastructure. It records verified repository facts separately from proposed architecture and work that remains unverified. It does not authorise production deployment, production data access, provider spending, schema changes, or customer-facing AI activation.

---

## 1. Executive decision

Mudaala will have two independently operated planes:

1. **Commerce plane:** the existing Mudaala application remains responsible for accounts, shops, listings, catalogue visibility, contact/enquiry flows, moderation, and the authoritative commerce database.
2. **Intelligence plane:** a separately hosted system provides Hermes orchestration, specialist algorithms/models, asynchronous analysis, model training, evaluation, simulation, and controlled delivery of intelligence results.

The intelligence plane must improve Mudaala without making buyers or merchants interact with an AI chatbot or see Hermes branding. Intelligence is an invisible capability of the product.

### Confirmed product and architecture decisions

- Product: Mudaala, canonical public domain `https://mudaala.store`.
- Mudaala is a local-commerce discovery and merchant digitisation platform, not a checkout-first marketplace. The current product model directs customers to contact or visit sellers; do not assume in-app payments, escrow, delivery dispatch, or in-app chat.
- Existing production stack: Next.js App Router + TypeScript + Cloudflare Workers/OpenNext; PostgreSQL on Supabase, accessed through Cloudflare Hyperdrive and Prisma; Supabase Storage for photos.
- Intelligence hosting direction: **hybrid**.
- Optimisation priority: **quality and user outcomes first**, not lowest possible cost.
- Hermes availability target: **always available**.
- Initial infrastructure budget posture: start with Modal Starter/free allowance for development and validation; do not represent this as a guarantee that a production always-on runtime or model inference is free.
- Hermes is an orchestrator and reasoning runtime, not a mandatory synchronous dependency for every user request.
- The 40-module registry is the agreed baseline. A module is a capability and may be a deterministic service, statistical model, ML model, moderation control, or AI-assisted workflow. It is not automatically a separate LLM.
- Production improvements must be evaluated and approved before rollout. No self-deployment by Hermes.

## 2. Non-negotiable architectural principles

1. **Commerce availability is independent of Hermes.** If Hermes, a model provider, Modal, or a GPU worker is unavailable, core browsing, shop pages, publishing, sign-in, and seller contact must continue using safe deterministic fallbacks.
2. **Fast paths stay fast.** Customer-facing ranking and retrieval use bounded, precomputed or low-latency services. Hermes performs deeper reasoning asynchronously.
3. **Source of truth stays in Mudaala.** Supabase/PostgreSQL remains authoritative for users, shops, listings, moderation and commerce records. The intelligence plane stores derived features, event projections, model artefacts and experiment records only where justified.
4. **Least privilege.** Hermes never receives unrestricted production database credentials, shell access to production, or general-purpose mutation rights.
5. **Tenant and purpose isolation.** Every request is authorised for its user, shop, tenant, purpose and data scope. Buyer preference data is not exposed to merchants or competing shops.
6. **Evidence before claims.** Unknown information remains unknown. A model cannot convert missing evidence into a verified badge, stock claim, sales claim, supplier guarantee, legal conclusion or accusation.
7. **Human control for high-impact actions.** Account suspension, shop restrictions, verification badges, dispute outcomes, financial commitments, supplier orders, and enforcement actions remain with deterministic policy and authorised human approval.
8. **Privacy by design.** Minimise data, respect consent and opt-out, define retention and deletion, avoid sensitive-trait inference, redact PII from prompts and logs, and document third-party data transfers.
9. **Reproducibility.** Every model, prompt, skill, dataset, policy and evaluation has a version and provenance record.
10. **Provider portability.** Modal, GPU vendors and model providers are replaceable behind interfaces; no provider-specific API leaks into Mudaala's domain logic.
11. **No unmeasured self-learning.** Production events can feed offline evaluation and training pipelines, but live model changes require review, shadow evaluation and controlled release.
12. **Budget controls are safety controls.** Set compute, token, storage, concurrency and egress limits; never automatically upgrade or incur unapproved spend.

## 3. Repository audit — verified baseline

### 3.1 Repository identity and current state

- Repository: `isaJrKai/mudaala-cloudflare` (public).
- Default branch: `main`.
- Audited main commit: `cdfb6f6d07406fedad4786d65023d8b2910b358d`.
- The repository contains the production Next.js/Cloudflare application, Prisma schema/migrations, GitHub Actions, domain libraries, API routes, operational scripts and product documentation.
- A full recursive Git tree was inspected to inventory tracked paths. The audit then inspected the README, package manifest, Worker configuration, Prisma schema and key discovery, growth, analytics, privacy and merchant-knowledge files. This is a repository-wide structural audit plus targeted subsystem review; it is **not** a line-by-line audit of every UI component, route, migration, workflow and test. Workstream 1 must complete that deeper review before implementation decisions depend on uninspected code.

### 3.2 Existing platform and runtime

Verified from `README.md`, `package.json`, `wrangler.jsonc` and `prisma/schema.prisma`:

- Next.js App Router, TypeScript, React 19 and Next.js 16.4.3.
- Cloudflare Workers deployment using OpenNext.
- PostgreSQL on Supabase, accessed through Hyperdrive and Prisma's PostgreSQL adapter.
- Supabase Storage is the intended photo store.
- Worker has a Durable Object binding named `MUDAALA_RATE_LIMITER`.
- Worker config includes Hyperdrive binding `HYPERDRIVE`, a 15-minute cron trigger, and observability/logging.
- The checked-in Worker config does not currently declare a Cloudflare Queues producer or consumer binding.
- Package dependencies include `ioredis`, but dependency presence alone does not prove a Redis service is provisioned or used for intelligence.
- `mini-services/` currently contains only `.gitkeep` in the audited main tree; no separate deployed intelligence service was found there.
- GitHub Actions include PR validation, Cloudflare deployment and multiple live verification workflows.

**Important operational issue:** PR #342 records production Worker `exceededCpu` 503s across multiple routes and identifies the observed 10 ms request CPU ceiling as consistent with the Workers Free request CPU allowance. The PR states that it does not itself change the plan or production Worker. This is a commerce-plane reliability issue and a reason not to put heavy intelligence computation inside the Worker. Confirm current PR/production status before acting; do not infer that the problem has been fixed.

### 3.3 Existing intelligence-adjacent capabilities found on main

The following are existing code, not hypothetical modules:

| Existing asset | Verified responsibility | Current interpretation |
|---|---|---|
| `src/lib/merchant-growth.ts` | Deterministic, explainable next-best merchant-action recommendations from a server-built snapshot | Existing rule-based merchant intelligence foundation |
| `src/app/api/growth/recommendation/route.ts` | Authenticated seller endpoint builds server-side profile/listing/event snapshot and calls merchant-growth logic | Existing synchronous recommendation endpoint; keep bounded |
| `src/app/api/growth/events/route.ts` | Authenticated seller event ingestion with an allowlisted event schema and idempotency key handling | Existing first-party merchant event collection |
| `src/app/api/cron/growth-coach/route.ts` | Scheduled merchant growth notification processing | Existing scheduled growth workflow; inspect complete implementation and limits before reuse |
| `docs/MUDAALA_GROWTH_COACH.md` | Product intent, notification behaviour, merchant controls, recommendation principles and frequency limits | Existing product requirements and guardrails |
| `src/lib/price-trends.ts` | Daily median asking-price trend logic; current known design uses active OFFER listings, minimum sample threshold and currency/unit separation | Existing descriptive market analytics; verify current tests and all implementation details |
| `src/app/api/price-trends/route.ts` | Price-trend API | Existing API; inspect access, query limits and response contract |
| `src/lib/listing-analytics.ts` | Listing/shop engagement analytics | Existing first-party analytics foundation |
| `src/lib/discovery-ranking.ts` | Discovery ranking logic | Existing ranking foundation; audit callers and metrics before extension |
| `src/lib/search.ts` and `src/app/api/shops/search/route.ts` | Search and shop-search logic | Existing retrieval surface; audit query plan, indexes and latency |
| `src/app/api/listings/[id]/recommendations/route.ts` | Listing recommendation API | Existing endpoint; do not assume it implements the planned shared recommendation core |
| `src/lib/merchant-kb/` and `docs/MERCHANT_KNOWLEDGE_BASE.md` | Deterministic FAQ/knowledge layer for Telegram Merchant Assistant, with status/source rules and an AI fallback | Reusable knowledge/skill design precedent; not the Hermes memory system |
| `src/app/api/my/business-analytics/route.ts` and business analytics docs/code | Merchant-facing analytics | Existing real-metric source; distinguish views/contact taps from sales |
| `prisma/schema.prisma` | Includes MerchantGrowthEvent, notifications, listing/shop daily analytics, category interests, saved searches and commerce entities | Existing event and analytics data foundation |

Do not assume that all listed capabilities are production-ready, complete, accurate, or suitable for direct model training. Workstream 1 must inspect tests, callers, database indexes, permissions, migrations, and live telemetry.

### 3.4 Existing privacy and trust constraints

The current `content/privacy.md`, `content/safety.md`, schema comments and `docs/MUDAALA_GROWTH_COACH.md` establish important constraints:

- Mudaala says it does not sell personal data.
- Phone numbers are not generally published to search engines; contact details are shown in the context the user chooses.
- Product photos may be sent to an external moderation provider during upload when configured; if moderation is unavailable, production upload is blocked rather than silently bypassing the check.
- Shop location storage is deliberately coarse/rounded; do not seek precise home/private location.
- Mudaala's safety guidance warns buyers and sellers about advance-payment scams and encourages in-person inspection.
- Merchant guidance must be based on actual shop facts; a poster download is not proof of external sharing; taps are not sales.
- Growth notifications have frequency caps, quiet hours, snooze, archive, dismissal and opt-in controls.

Any new intelligence data flow must be reconciled with the published privacy policy, user controls, retention commitments and applicable Ugandan law before production use. The policy may need an explicit update before new categories of personal data are sent to additional providers.

### 3.5 Existing architecture work and PR status

Status was checked against GitHub on 2026-11-20:

| PR | Purpose | Observed state at audit |
|---|---|---|
| [#225](https://github.com/isaJrKai/mudaala-cloudflare/pull/225) | Commerce Intelligence architecture and 40-module registry | Open, draft, not merged |
| [#234](https://github.com/isaJrKai/mudaala-cloudflare/pull/234) | Commerce Discovery Network vision | Open, not merged |
| [#235](https://github.com/isaJrKai/mudaala-cloudflare/pull/235) | Shared channel-neutral recommendation core | Open, draft, not merged |
| [#341](https://github.com/isaJrKai/mudaala-cloudflare/pull/341) | Verified account email, passwordless login and Gmail delivery | Open, not merged |
| [#342](https://github.com/isaJrKai/mudaala-cloudflare/pull/342) | Google-assisted onboarding and reduced session polling; documents CPU-limit findings and a known base-branch email-auth build issue | Open, not merged |

The 40-module source document currently exists on the PR #225 architecture branch, not on the audited main branch. The master plan records the module registry below so the working branch has a stable reference. Before merging or cherry-picking any earlier PR, compare it with current main and resolve overlap; do not assume the old PR branch is current.

### 3.6 Known repository risks and audit follow-ups

- PR #342 reports that main has email-reset routes importing `@/lib/email-auth` and schema fields absent from main, causing global TypeScript and Worker build failures; PR #341 is the companion email implementation. Reproduce this against the current branch/CI before treating it as current fact.
- Worker CPU-limit failures have affected unrelated routes according to PR #342. Measure production CPU and request behaviour; do not hide the problem by moving more work into synchronous routes.
- No Cloudflare Queues binding was present in the inspected `wrangler.jsonc`; an event bus is a proposed addition, not an existing capability.
- No Hermes runtime, Modal deployment, RunPod deployment, intelligence gateway, model registry, training lab, vector database, feature store, or independent intelligence service was found in the inspected main tree.
- The exact state of all outstanding PR checks, production deployment, secrets, Supabase policies, external provider accounts and Cloudflare plan is not established by this code audit.

---

## 4. The agreed 40-module capability registry

These are capability boundaries, not 40 mandatory independent LLMs. The source registry originated in PR #225; the list below is reproduced here as the working baseline.

### A. Discovery and ranking (MCI-01–08)

| ID | Module | Responsibility |
|---|---|---|
| MCI-01 | Query understanding | Parse intent, category, product attributes and local terms |
| MCI-02 | Retrieval planner | Select keyword, filter and semantic retrieval paths |
| MCI-03 | Product relevance ranker | Rank eligible products for a query |
| MCI-04 | Personalisation ranker | Adapt ranking to consented first-party interests |
| MCI-05 | Visual product matcher | Match user-provided image to catalogue items |
| MCI-06 | Similar-item discovery | Find alternatives and substitutes |
| MCI-07 | Local availability ranker | Prioritise realistically reachable nearby sellers |
| MCI-08 | Discovery diversity controller | Reduce repetitive exposure and give new shops fair opportunity |

### B. Trust, safety and compliance (MCI-09–16)

| ID | Module | Responsibility |
|---|---|---|
| MCI-09 | Business identity verifier | Coordinate evidence checks for merchant identity |
| MCI-10 | Supplier due-diligence assessor | Assess supplier evidence and provenance |
| MCI-11 | Listing policy classifier | Detect likely prohibited/restricted listing categories |
| MCI-12 | Image safety moderator | Detect unsafe or disallowed product imagery |
| MCI-13 | Fraud/anomaly detector | Identify suspicious account/listing/transaction patterns |
| MCI-14 | Reputation integrity monitor | Detect review manipulation and coordinated abuse |
| MCI-15 | Transaction risk assessor | Evaluate future order/payment risk only when that domain exists |
| MCI-16 | Case triage assistant | Prioritise moderator queues and summarise evidence |

### C. Buyer and customer experience (MCI-17–22)

| ID | Module | Responsibility |
|---|---|---|
| MCI-17 | Preference learner | Learn shopping interests from consented first-party signals |
| MCI-18 | Shopping intent predictor | Estimate near-term shopping intent |
| MCI-19 | Budget-fit estimator | Match products to declared or observed price preferences without inferring income/class |
| MCI-20 | Buyer journey assistant | Help compare, understand and navigate products using grounded facts |
| MCI-21 | Customer support router | Route questions, complaints and disputes |
| MCI-22 | Retention/churn signal | Identify useful, opt-in re-engagement opportunities |

### D. Merchant and supplier operations (MCI-23–28)

| ID | Module | Responsibility |
|---|---|---|
| MCI-23 | Listing enrichment assistant | Draft titles, descriptions and attribute suggestions |
| MCI-24 | Inventory signal engine | Reconcile declared stock and listing status where supported |
| MCI-25 | Demand forecaster | Forecast category/shop demand |
| MCI-26 | Pricing assistant | Suggest price ranges using comparable evidence |
| MCI-27 | Merchant performance analyst | Explain shop views, contact taps and listing engagement |
| MCI-28 | Restock/sourcing recommender | Suggest replenishment opportunities |

### E. International trade and fulfilment (MCI-29–34)

| ID | Module | Responsibility |
|---|---|---|
| MCI-29 | Global supplier discovery | Discover manufacturers and wholesalers |
| MCI-30 | Manufacturer authenticity assessor | Evaluate factory/trader claims |
| MCI-31 | Wholesale comparison engine | Compare MOQ, unit price and terms |
| MCI-32 | Landed-cost calculator | Estimate total import cost |
| MCI-33 | Trade compliance checker | Flag product/corridor restrictions and permits |
| MCI-34 | Shipment visibility predictor | Track milestones and estimate delivery windows |

### F. Growth, advertising and network health (MCI-35–40)

| ID | Module | Responsibility |
|---|---|---|
| MCI-35 | Sponsored-campaign eligibility | Decide whether a listing/shop can enter ad inventory |
| MCI-36 | Sponsored placement ranker | Rank clearly labelled paid placements |
| MCI-37 | Campaign audience matcher | Match campaigns to permitted interest cohorts |
| MCI-38 | Merchant growth coach | Suggest practical actions to improve shop outcomes |
| MCI-39 | Marketplace liquidity monitor | Detect category/area supply-demand gaps |
| MCI-40 | Network abuse monitor | Detect coordinated spam, scraping and platform attacks |

### Global acceptance gates for every module

- Typed, versioned input/output contract; schema and contract tests.
- Data provenance, lawful purpose, retention and deletion documented.
- Authentication, authorisation, tenant-isolation and abuse tests.
- Offline evaluation against a baseline, including false-positive/false-negative analysis.
- Latency, availability, compute/token cost and failure budgets.
- Deterministic fallback, feature flag and kill switch.
- Monitoring that excludes raw PII and secrets.
- Human review and appeal for high-impact decisions.
- Shadow-mode evidence before customer-visible activation.
- Explicit release approval; documentation status does not mean production-ready.

---

## 5. Target system architecture

### 5.1 Logical components

**A. Commerce application (existing)**

- Remains the customer-facing application and source of truth.
- Calls only a narrow Intelligence Gateway for permitted, bounded requests.
- Does not import Hermes SDKs or ML runtimes into the Next.js Worker.
- Has deterministic fallback behaviour for every optional intelligence feature.

**B. Intelligence Gateway**

- Publicly unreachable except through authenticated Mudaala server-to-server paths.
- Verifies service identity, request audience, signature, timestamp, nonce/idempotency and scopes.
- Enforces tenant/shop/user scope, payload limits, timeouts, rate limits and quotas.
- Exposes versioned endpoints such as `/v1/search/understand`, `/v1/recommendations/rank`, `/v1/products/visual-match`, and asynchronous job submission/status APIs.
- Does not expose arbitrary database queries, arbitrary shell execution or unrestricted agent tools.
- Records trace IDs and minimal operational metadata, not raw private prompts or personal data by default.

**C. Real-time intelligence services**

- Query understanding, retrieval planning, product ranking, local ranking, recommendation, image embeddings and other bounded inference.
- Stateless or horizontally scalable where practical.
- Use precomputed features and indexes; no long-running agent reasoning in the request path.
- Return ranked candidates with typed reason codes, provenance, model/policy version and confidence only where calibrated.
- Use short timeouts and explicit fallbacks.

**D. Hermes control plane**

- One continuously available logical Hermes service with supervised process/container recovery, health checks and persistent state.
- Owns orchestration, planning, research, delegated specialist workflows, memory retrieval and scheduled analysis.
- Uses approved, versioned skills and narrow tools.
- Dispatches long-running tasks to workers; it does not monopolise the inference or training compute pool.
- Cannot autonomously promote models, change production policies, suspend users, issue verified badges, send campaigns or mutate core commerce records.

**E. Specialist worker pool**

- CPU workers for data preparation, batch analytics, feature generation, evaluations and lightweight models.
- GPU workers for image/vision inference, embedding generation, selected LLM inference and model training when justified by benchmarks.
- Workloads are queue-driven, bounded, retryable and idempotent.
- Workers are isolated by environment and job permissions; no production database credentials in general training jobs.

**F. Intelligence Lab**

- Dataset registry and data validation.
- Simulation and historical event replay.
- Experiment tracking and baseline comparisons.
- Model/skill/prompt registry with versioned artefacts.
- Offline evaluation, red-team tests, drift checks and release gates.
- Staging endpoint that mirrors production contracts but uses synthetic or explicitly approved data.

**G. Intelligence data layer**

- Supabase/PostgreSQL remains the authoritative source.
- Separate intelligence schema/database or isolated service store for derived, minimised features and job metadata only after access and retention design.
- Object/artifact storage for approved datasets, model files and evaluation reports.
- Vector search is optional and introduced only when semantic retrieval benchmarks demonstrate value; it is not a prerequisite for all 40 modules.
- No new database or vector provider is selected solely because it is fashionable.

### 5.2 Hosting topology (hybrid, quality-first)

| Workload | Preferred initial placement | Production direction |
|---|---|---|
| Hermes core | Modal Starter for installation and controlled testing | Always-on CPU runtime on Modal if uptime, process lifetime and cost are proven; otherwise a dedicated persistent CPU host |
| Elastic CPU jobs | Modal | Modal autoscaling workers |
| GPU inference/training | Modal GPU for small experiments; benchmark RunPod as alternative | Select per workload based on latency, availability, model fit and total cost |
| Mudaala application | Existing Cloudflare Workers/OpenNext | Remains independent |
| Authoritative data | Existing Supabase/PostgreSQL | Remains source of truth |
| Event delivery | Existing authenticated APIs initially; design a durable queue/outbox | Add Cloudflare Queues or an independently hosted broker after validating delivery, retry and dead-letter requirements |
| Model/dataset artefacts | Approved object storage | Versioned, access-controlled artifact storage |

**Modal Starter/free-tier rule:** use it to validate architecture, Hermes installation, skills, gateway, small CPU jobs and bounded experiments. Do not promise that the included credits cover a 24/7 production process, sustained GPU use, model API tokens, or high-volume workloads. Verify current plan limits, minimum-container behaviour, idle billing, regional availability and pricing before deployment. Never enable automatic paid expansion without owner approval.

**Always-on requirement:** Hermes must have a continuously available logical control plane. A serverless scale-to-zero worker alone does not satisfy this. The deployment must prove minimum live capacity, process supervision, restart recovery, persistent state, health checks, alerting and a tested failover/recovery procedure.

**Provider selection gate:** benchmark from Uganda and the target user regions. Include cold start, warm p50/p95/p99 latency, network round-trip, GPU queue delay, data egress, reliability, privacy terms and full monthly cost. Do not select a provider based on headline GPU hourly price alone.

---

## 6. Event and data flow

### 6.1 Event capture

- Define a versioned, allowlisted event taxonomy. Reuse existing first-party events where accurate.
- Record only events needed for a documented purpose: search, impression, product view, save, contact tap, shop visit intent, merchant listing edit, photo addition, declared stock update, and explicitly supported business outcomes.
- Preserve the distinction between an impression, click, contact tap, enquiry, confirmed sale and delivery. Never infer a sale from a WhatsApp click.
- Include event ID, event type, event time, actor scope, entity ID, schema version, consent/purpose metadata where applicable, and idempotency key.
- Avoid storing raw query strings, phone numbers, message contents or exact location in analytics unless a specific, approved purpose requires them.

### 6.2 Reliable delivery

Proposed pattern:

1. Commerce service commits its domain change and an outbox/event record atomically where feasible.
2. A dispatcher publishes the event to a durable queue.
3. Consumers process idempotently and acknowledge only after durable completion.
4. Failed events retry with bounded exponential backoff.
5. Poison messages go to a dead-letter queue with operator visibility.
6. Reconciliation jobs detect missing or stuck events.

Do not treat a fire-and-forget HTTP call from the Worker as a reliable event bus. Keep queue publish work bounded to avoid repeating current Worker CPU problems.

### 6.3 Data permissions

- Public catalogue facts may support public search/recommendations.
- Merchant-private analytics are visible only to that merchant and authorised staff.
- Buyer preference features are scoped to that buyer and never revealed to sellers.
- Training datasets are minimised, pseudonymised where possible, access-controlled and subject to retention/deletion policy.
- Do not train on private WhatsApp conversations, support messages or appeal records by default.
- Do not infer sensitive attributes, income/class, religion, ethnicity, health, political views or other protected/sensitive traits.
- Data deletion and consent withdrawal must propagate to derived profiles and future training eligibility according to a documented policy.

---

## 7. Hermes education, skills and memory

Hermes is not made competent by installing it or loading 40 prompt files. Education is a governed set of knowledge, tools, examples, evaluations and operating permissions.

### 7.1 Knowledge layers

1. **Product knowledge:** Mudaala purpose, user journeys, product boundaries, current features and roadmap.
2. **Policy knowledge:** privacy, safety, prohibited goods, trust, moderation, appeals and merchant/customer rules.
3. **Technical knowledge:** API contracts, data schema, event taxonomy, service ownership, runbooks and failure modes.
4. **Domain knowledge:** Ugandan commerce language, local product categories, units, currencies, districts and merchant practices.
5. **Operational knowledge:** incident procedures, job workflows, escalation paths and release policies.

Every source must have owner, version, effective date and status (verified, draft, deprecated). Hermes must distinguish policy from examples and proposals.

### 7.2 Skills

- Audit existing Hermes-compatible skill formats and open skill libraries before writing new skills.
- Reuse only skills whose licence, provenance, dependencies and security have been reviewed.
- Convert reusable workflows into Mudaala-specific skills with explicit allowed tools, input schema, output schema, failure behaviour and tests.
- Skills are not trusted code merely because they are labelled skills. Review executable scripts, network access, shell commands and data handling.
- Maintain a skill registry with version, source, licence, reviewer, test results and deployment status.

Initial skill families: product/catalogue analysis; local discovery; search relevance; merchant growth; pricing and market analysis; trust/safety triage; analytics interpretation; supplier research; trade-cost estimation; incident response; model evaluation and release review.

### 7.3 Memory

- Separate stable operational knowledge from short-lived task memory and user-specific data.
- Store memory with source, timestamp, scope, retention and deletion metadata.
- Never store passwords, secrets, payment credentials or unrestricted private conversation histories.
- Do not let memory override current authoritative database facts or policy.
- Provide explicit correction and expiry mechanisms; test retrieval for stale and cross-tenant leakage.

### 7.4 Delegation

- Hermes may delegate to specialist workers with scoped, expiring capabilities.
- Each delegated task has an objective, permitted data, tools, budget, deadline and expected typed result.
- Workers cannot silently expand their permissions or spawn unbounded subagents.
- Hermes validates outputs against schemas and provenance before using them.

---

## 8. Model, algorithm and resource strategy

### 8.1 Do not make 40 LLMs

Use the simplest technique that meets the measured quality target:

- Deterministic rules and policy engines for hard constraints and high-confidence business rules.
- SQL/statistical aggregation for descriptive analytics and market summaries.
- Classical ML for ranking, classification, anomaly detection and forecasting where labelled data supports it.
- Vision encoders/OCR for image and product understanding where useful.
- Embeddings/vector retrieval only where semantic or visual retrieval outperforms the baseline.
- LLMs for language understanding, grounded explanations, research synthesis and selected multi-step tasks.
- Hermes for orchestration and deeper reasoning, not every low-latency prediction.

### 8.2 Resource audit

For every MCI module, investigate and record:

- Existing implementation in Mudaala.
- Existing open-source libraries and pretrained models.
- Dataset availability, source, licence, representativeness and quality.
- Model licence and commercial-use restrictions.
- Hardware, memory, throughput and latency requirements.
- Training/fine-tuning needs and minimum data volume.
- Inference cost and fallback strategy.
- Maintenance activity, security posture and dependency health.
- Integration effort and test coverage.

Classify each candidate:

- **ADOPT:** usable with configuration and integration only.
- **ADAPT:** useful base but needs Mudaala-specific code/data.
- **TRAIN:** requires training or fine-tuning on approved data.
- **BUILD:** no suitable existing solution.
- **REJECT:** incompatible licence, security, quality, cost or maintenance risk.

Candidate ecosystems to evaluate, not pre-approved dependencies: Hermes/Nous skills and Atropos; RecBole and TensorFlow Recommenders for recommendation research; Qdrant or other retrieval systems only if benchmarked; Evidently and task-specific evaluation tools; established vision, OCR, forecasting, moderation and anomaly-detection models. Verify current versions, licence terms, maintenance and compatibility before adoption.

### 8.3 Model governance

Every model release must include:
- model ID and semantic version;
- source/base model and licence;
- dataset and feature versions;
- training code/configuration and reproducible run ID;
- evaluation set and baseline;
- quality, calibration, fairness and safety results;
- latency and cost benchmarks;
- known limitations and intended use;
- approval record, rollout percentage and rollback target.

---

## 9. Module contracts and risk boundaries

Each module must expose a versioned contract and must not directly mutate critical commerce state.

Common response envelope:

```json
{
  "module_id": "MCI-03",
  "contract_version": "1.0",
  "trace_id": "opaque-trace-id",
  "result": {},
  "reason_codes": [],
  "provenance": [],
  "model_version": "ranker-version-or-rule-version",
  "confidence": null,
  "warnings": [],
  "created_at": "ISO-8601"
}
```

The exact schema will be typed in code; the example is illustrative. Confidence is omitted/null unless calibrated and meaningful. No module may return unsupported factual claims.

High-impact module restrictions:
- MCI-09/10: no verified identity or supplier status without independently verified evidence and human approval.
- MCI-11/12: policy engine owns final enforcement; ambiguous cases route to review; moderation provider outage follows an explicit safe policy.
- MCI-13/14/15: risk signals only; no automatic accusation, suspension, payment hold or irreversible action.
- MCI-16/21: triage and draft only; authorised humans decide disputes and sensitive support actions.
- MCI-17/18/19/22/37: consent, purpose limitation, minimisation, opt-out, no sensitive inference or manipulative targeting.
- MCI-23/26: merchant reviews and approves generated content/pricing; never invent attributes, stock, origin, certification or price.
- MCI-24/28: merchant-declared stock and explicit approval remain authoritative.
- MCI-29/30/31: supplier claims require provenance and verification; no unsupported factory-direct or authenticity claims.
- MCI-32/33/34: estimates are not customs/legal guarantees; official/current source and qualified human validation required.
- MCI-35/36: sponsored content is clearly labelled and cannot override organic relevance, safety or trust.
- MCI-38: merchant coaching uses real metrics and clearly separates correlation from causation.
- MCI-39: aggregate thresholds protect individual merchants and buyers.
- MCI-40: security signals are minimised and reviewed before account impact.

---

## 10. Security and privacy architecture

- Separate production, staging, training and local development accounts/projects.
- Use short-lived service credentials with audience, scope and rotation; secrets live in provider secret stores, never Git.
- Gateway authenticates every service request and validates tenant/user/shop scope server-side.
- Hermes receives only task-scoped APIs, not a general-purpose production database connection.
- Training workers use synthetic, public or explicitly approved minimised datasets; no production credentials.
- Encrypt transport and storage; restrict artifact downloads and dataset access.
- Log access decisions, model version, tool invocation, actor and outcome; redact payloads and secrets.
- Apply rate limits, payload limits, timeouts, concurrency caps and circuit breakers.
- Run dependency and container scans; pin images and packages; review skill code.
- Maintain incident runbooks for leaked credentials, data exposure, model compromise, prompt injection, queue backlog and provider outage.
- Treat all user-generated content, retrieved web pages, supplier documents and product descriptions as untrusted input. Prompt injection must not grant tools or permissions.
- Conduct privacy/security review before connecting external LLM providers or uploading any user data.

---

## 11. Reliability, performance and user experience

### 11.1 Service boundaries

- Commerce Worker must not synchronously call Hermes for core page rendering or auth.
- Real-time intelligence endpoints have strict deadlines and deterministic fallback.
- Long-running research, model training, feature generation and merchant analytics are asynchronous.
- Queue consumers are idempotent and horizontally scalable.
- Use circuit breakers and stale-but-safe cached results where appropriate.
- Provider outage must not make listings, shops or customer contact unavailable.

### 11.2 Provisional service objectives

These are engineering targets to validate and adjust with real measurements, not current achieved SLOs:

| Surface | Initial target for design/testing |
|---|---|
| Cached/bounded recommendation API | p95 <= 300 ms within the selected region |
| Search/retrieval path | p95 <= 500 ms, excluding external image upload |
| Intelligence gateway overhead | p95 <= 50 ms excluding model work |
| Hermes control plane | 99.5% monthly availability during initial production pilot; improve with evidence |
| Queue processing | 95% of routine events processed within 60 seconds; alert on backlog |
| Core commerce when intelligence is down | No loss of essential browse, shop, listing, sign-in or contact functionality |

Measure from Uganda and target customer regions. Establish a baseline before committing to final SLOs.

### 11.3 Observability

Capture:
- trace ID across Worker → gateway → queue → Hermes/worker → result;
- latency distributions, error rates, timeouts and retries;
- queue depth, age, dead-letter count and idempotency conflicts;
- CPU, RAM, GPU utilisation, cold starts and container restarts;
- model/skill version, fallback rate and evaluation score;
- per-module cost, token usage, GPU time and data egress;
- safety review rate and false-positive/false-negative outcomes.

Never log raw secrets or unrestricted user content. Use aggregate and redacted telemetry.

---

## 12. Intelligence Lab and learning lifecycle

### 12.1 Environments

1. **Local development:** synthetic fixtures; no production secrets or direct production writes.
2. **Research sandbox:** isolated compute for untrusted libraries, skill inspection and model experiments.
3. **Dataset preparation:** schema validation, deduplication, minimisation, provenance and quality checks.
4. **Simulation/replay:** synthetic buyers/merchants and approved historical event replay.
5. **Evaluation:** fixed holdout datasets, baseline comparison, adversarial and privacy tests.
6. **Staging:** production-like API contracts and infrastructure with synthetic/approved data.
7. **Shadow production:** candidate runs in parallel but does not affect user-visible output.
8. **Canary/production:** limited, approved rollout with feature flag, monitoring and rollback.

### 12.2 Training lifecycle

`collect approved data → validate and minimise → version dataset → train/fit → evaluate offline → red-team/privacy review → shadow → canary → approve → monitor → rollback or promote`

- Do not continuously fine-tune Hermes from raw production conversations.
- Start with prompt/skill/tool quality, deterministic baselines and classical ML where suitable.
- Fine-tune specialist models only when there is a measured gap, sufficient lawful labelled data, and a reproducible evaluation showing improvement.
- Reinforcement learning is not an initial requirement. Consider Atropos or another RL environment only for well-defined tasks with reliable reward signals and safe simulators.
- No online exploration that harms users, changes prices, exposes merchants, or makes enforcement decisions.

### 12.3 Simulation

Simulations must be calibrated against real aggregate patterns and must not be treated as evidence of real user behaviour. Use them for workflow robustness, edge cases, load testing, ranking invariants and agent tool-use tests. Keep synthetic identities and data clearly marked.

---

## 13. Implementation workstreams and deliverables

### WS-0 — Preserve and reconcile existing work
- Recheck PR #225/#234/#235 against current main.
- Identify overlapping files, commits, tests and unmerged implementation.
- Do not merge old branches blindly.
- Deliverable: PR reconciliation report and decision for each PR.

### WS-1 — Complete repository and production audit
- Inspect every top-level subsystem, all API routes relevant to intelligence, domain libraries, Prisma models/migrations/indexes, tests, workflows, Worker bindings, deployment settings and operational telemetry.
- Verify current production CPU plan and reproduce/track PR #342 findings.
- Inspect actual Supabase RLS, database roles, secrets configuration and Cloudflare bindings through authorised tools; do not infer them from schema alone.
- Deliverable: file-level inventory, dependency map, data-flow map, test baseline, known blockers and verified production topology.

### WS-2 — Resource, skill, model and dataset audit
- Build a 40-row catalogue with source links, licence, maintenance, benchmark, compute, integration, privacy and Adopt/Adapt/Train/Build/Reject classification.
- Inspect Hermes Agent version, supported deployment mode, skills format, memory, tool permissions, delegation and recovery.
- Deliverable: reviewed resource register and provider shortlist.

### WS-3 — Infrastructure proof of concept
- Create isolated Modal workspace/environment; use Starter allowance for bounded tests.
- Build container image and health endpoint; persist only required Hermes state in a controlled store.
- Test restart, crash recovery, long-running process, min-container/always-on behaviour, network egress and spend monitoring.
- Benchmark CPU/GPU alternatives, including RunPod if justified.
- Deliverable: measured architecture decision record; no production traffic yet.

### WS-4 — Contracts, gateway and event delivery
- Define OpenAPI/typed contracts, service authentication, tenant scopes, idempotency and trace propagation.
- Decide and implement outbox/queue pattern after testing provider semantics.
- Add circuit breakers, bounded timeouts and deterministic fallbacks.
- Deliverable: integration tests proving isolation and graceful degradation.

### WS-5 — Hermes education and operations
- Pin Hermes version and base model/provider adapters.
- Build versioned knowledge packs, reviewed skills, tool allowlists and memory scopes.
- Add persistent process supervision, health checks, alerting and recovery runbooks.
- Deliverable: Hermes can perform a bounded, read-only Mudaala research/analysis task and produce an auditable result.

### WS-6 — Intelligence Lab
- Dataset registry, synthetic fixture generator, event replay, simulation, experiment tracking, evaluation harness and artifact registry.
- Deliverable: repeatable benchmark run from versioned inputs to report.

### WS-7 — Module delivery
- Prioritise discovery, product understanding and merchant analytics based on user impact and available data.
- Build modules in dependency order, with contracts and global acceptance gates.
- Deliverable: each module has tests, benchmark, fallback, telemetry and deployment status; no bulk “40 module” launch.

### WS-8 — Product integration
- Connect invisible buyer and merchant experiences through the gateway.
- Start with shadow results, then feature-flagged canary.
- Deliverable: measured improvement in relevance, useful merchant actions or another defined outcome without degrading core latency.

### WS-9 — Governance and continuous improvement
- Model/skill/data versioning, approval workflow, drift monitoring, incident handling, cost review and rollback.
- Deliverable: operating handbook and repeatable release process.

---

## 14. Initial module delivery order

The order is provisional and depends on WS-1 data/implementation audit:

1. MCI-01 Query understanding
2. MCI-02 Retrieval planner
3. MCI-03 Product relevance ranker
4. MCI-04 Personalisation ranker (only after consent and data controls)
5. MCI-06 Similar-item discovery
6. MCI-07 Local availability ranker
7. MCI-08 Discovery diversity controller
8. MCI-05 Visual product matcher
9. MCI-27 Merchant performance analyst
10. MCI-38 Merchant growth coach
11. MCI-26 Pricing assistant
12. MCI-25 Demand forecaster

Trust and safety foundations (MCI-09–16 and MCI-40) must be designed early and developed alongside discovery, not postponed until after growth. Their outputs begin as review signals with human oversight. Trade and advertising modules remain later-stage until their source data and product/business prerequisites exist.

---

## 15. Release gates and definition of done

No workstream is complete because code was written or a document exists. Completion requires:

- implementation linked to a commit/PR;
- tests run and results recorded;
- security/privacy review where relevant;
- benchmark and baseline comparison;
- operational metrics and alerting;
- fallback and rollback tested;
- owner approval for paid infrastructure, production data access and production rollout.

A module may be marked only as one of:
- **PROPOSED** — described, not implemented.
- **RESEARCHED** — candidate resources and feasibility reviewed.
- **IN DEVELOPMENT** — implementation underway.
- **SHADOW** — running without affecting user experience.
- **CANARY** — limited approved user-facing rollout.
- **PRODUCTION** — passed release gates and explicitly approved.
- **PAUSED/REJECTED** — blocked or unsuitable, with reason.

---

## 16. Immediate next actions

1. Preserve this branch and document; do not merge into main yet.
2. Reconcile PR #225, #234 and #235 with current main.
3. Complete WS-1 file-level and production audit before selecting databases, queues or service boundaries.
4. Produce the 40-module resource catalogue before installing a collection of tools.
5. Run Hermes on Modal Starter only as an isolated proof of concept; do not connect it to production data.
6. Prove always-on behaviour and total cost before deciding whether Hermes core remains on Modal or moves to a dedicated persistent CPU host.
7. Build gateway and event contracts before any module can call production services.
8. Keep all intelligence features behind flags and deterministic fallbacks.

### Explicitly not authorised by this plan

- No production database migration or data export.
- No new production secrets or credentials.
- No automatic paid Modal/RunPod/GPU spend.
- No direct production database access for Hermes.
- No customer-facing AI activation.
- No automatic account/shop enforcement.
- No model training on identifiable/private user data.
- No merge to `main` or production deployment.

---

## 17. Decision log

| Decision | Status |
|---|---|
| Separate intelligence plane from Mudaala commerce runtime | Approved direction |
| Hybrid hosting | Approved direction |
| Quality-first optimisation | Approved direction |
| Hermes always-available logical core | Approved requirement; exact host unproven |
| Modal Starter for initial proof of concept | Approved starting constraint; current limits/pricing must be reverified |
| RunPod as optional GPU provider | Candidate, not selected |
| Supabase remains commerce source of truth | Approved |
| Cloudflare Worker remains thin commerce edge | Approved |
| Durable event queue/outbox | Required design; provider/implementation pending |
| 40 capability registry | Approved baseline |
| 40 independent LLMs | Rejected |
| Hermes visible as a buyer/seller chatbot | Rejected for this product vision |
| Hermes unrestricted production DB access | Rejected |
| Automatic self-training/self-deployment | Rejected |
| All 40 modules launched together | Rejected |

---

## 18. Audit provenance and references

Repository sources inspected:
- `README.md`
- `package.json`
- `wrangler.jsonc`
- `prisma/schema.prisma`
- `src/lib/merchant-growth.ts`
- `src/lib/price-trends.ts`
- `src/lib/listing-analytics.ts`
- `src/lib/discovery-ranking.ts`
- `src/lib/search.ts`
- `src/app/api/cron/growth-coach/route.ts`
- `src/app/api/growth/events/route.ts`
- `src/app/api/growth/recommendation/route.ts`
- `docs/MUDAALA_GROWTH_COACH.md`
- `docs/MERCHANT_KNOWLEDGE_BASE.md`
- `content/privacy.md`
- `content/safety.md`
- Recursive Git tree of main at the baseline commit.

Related PRs:
- https://github.com/isaJrKai/mudaala-cloudflare/pull/225
- https://github.com/isaJrKai/mudaala-cloudflare/pull/234
- https://github.com/isaJrKai/mudaala-cloudflare/pull/235
- https://github.com/isaJrKai/mudaala-cloudflare/pull/341
- https://github.com/isaJrKai/mudaala-cloudflare/pull/342

External platform documentation to verify at implementation time:
- Modal pricing and deployment: https://modal.com/pricing and https://modal.com/docs
- Hermes Agent: https://github.com/NousResearch/hermes-agent
- Cloudflare Queues: https://developers.cloudflare.com/queues/
- Supabase security and database documentation: https://supabase.com/docs

**End of master plan.**
