# Mudaala Commerce Intelligence — Architecture Constitution

**Status:** Proposed foundation; documentation-only; not enabled in production.
**Branch:** `architecture/commerce-intelligence-foundation`
**Product principle:** simple experiences outside, sophisticated and safe infrastructure inside.
**Scope:** Uganda-first marketplace and merchant operating system, designed to support verified international trade corridors over time. This document does not change Mudaala's current no-checkout product contract.

## 1. Non-negotiable principles

1. **Simple surfaces, shared intelligence.** Buyer, merchant, supplier, moderator and WhatsApp experiences are interfaces over shared domain services. They must not create parallel identities, product catalogues, trust scores or analytics stores.
2. **Trust before growth.** A product, supplier, seller or transaction must pass relevant safety and eligibility gates before ranking or promotion. Revenue never buys a trust pass.
3. **Evidence before confidence.** Models may extract, classify, rank or recommend. They may not invent verification evidence, registration status, product availability, shipment events, payment settlement or customer consent.
4. **Human accountability.** High-impact decisions (account suspension, permanent removal, fraud accusations, disputed payments, supplier rejection) require explainable evidence, an appeal path and authorised human review unless a narrowly defined legal/safety emergency requires immediate temporary containment.
5. **No model as policy authority.** Prohibited-goods rules, permissions, ownership, payment state and publishing confirmation are deterministic server-side controls. LLM output is untrusted input.
6. **Privacy by design.** Collect first-party events needed for the service. Do not scrape browser history, read unrelated cookies, infer sensitive traits or purchase opaque personal profiles. External data requires a lawful basis, clear purpose and explicit permission where required.
7. **Fail safely, degrade gracefully.** A failed recommendation service must not take down Browse. A failed AI provider must not publish an unreviewed listing. A failed shared security control must not silently downgrade authentication or abuse protection.
8. **Incremental and reversible.** Build behind feature flags, test with synthetic/consented data, use additive migrations, maintain rollback paths and keep production behaviour unchanged until release gates pass.
9. **Measure utility, not model count.** The 40 modules are bounded capabilities with owners, contracts and evaluation criteria. They are not a requirement to deploy 40 separate neural networks.
10. **No false security claims.** “Military-grade” is not a technical standard or certification. The target is independently reviewable, defence-in-depth security with documented controls and tested recovery.

## 2. Existing Mudaala constraints and reuse

The current production application is Next.js App Router + TypeScript on Cloudflare Workers (OpenNext), PostgreSQL on Supabase through Cloudflare Hyperdrive and Prisma, and Supabase Storage for listing media.

Existing domain boundaries must be reused:
- `User`, `BusinessProfile`, `Listing`, moderation/reporting, saved searches, shop analytics and existing listing/photo flows remain authoritative.
- Listing creation must continue to enforce authentication, ownership, validation, content policy, moderation, rate limits, location and expiry rules.
- Media intake must reuse the existing moderation/storage pipeline. WhatsApp must not bypass it by forging browser cookies or calling a public upload path as an unauthenticated owner.
- The README currently describes Mudaala as a discovery/contact marketplace, not an in-app checkout marketplace. Escrow, in-app payments, delivery dispatch and in-app chat are not current capabilities. International trade must be introduced as a separately gated product domain, not implied by this architecture document.

### Rate limiting and Redis clarification

The repository already contains a rate-limiter abstraction. The production authority is the shared, SQLite-backed Cloudflare Durable Object implementation, which fails closed when unavailable. The Redis/ioredis ZSET adapter is explicitly labelled legacy/test: its multi-command operation is not atomic and its fallback is isolate-local memory. Do not promote that adapter to production security authority or use local-memory fallback as a global protection boundary.

Redis may later be evaluated for non-authoritative cache/session/feature workloads after load tests and operational review. PostgreSQL remains the source of truth. Cloudflare Durable Objects remain the existing shared rate-limit authority unless a reviewed architecture decision proves a replacement is safer.

## 3. Target system topology

```text
Buyer web/PWA      Merchant web      Supplier workspace      WhatsApp Cloud API
      |                 |                    |                       |
      +-----------------+--------------------+-----------------------+
                                Experience adapters
                                        |
                           AuthN / AuthZ / API boundary
                                        |
                         Shared commerce domain services
       +----------------+---------------+----------------+----------------+
       | Catalog/listing| Identity/linking| Trust & policy | Orders/trade* |
       +----------------+---------------+----------------+----------------+
                                        |
                          Event contracts + outbox
                                        |
                    Durable queue / bounded async consumers
                                        |
            +------------------- Intelligence -------------------+
            | Discovery | Trust signals | Merchant | Customer     |
            | Trade     | Ads/growth    | Safety   | Analytics    |
            +----------------------------------------------------+
                                        |
            PostgreSQL (truth) | object storage | cache (derived)
                                        |
                      Observability, audit, evaluation
```

`* Orders/trade are future, separately approved capabilities. They do not imply that Mudaala currently holds funds, clears customs or operates freight.`

## 4. Language and model strategy

### Application and orchestration
- **TypeScript** remains the primary language for Next.js, Cloudflare Worker routes, domain services, webhook adapters, policy enforcement and event contracts.
- **Python** is introduced only for workloads that benefit from the ML ecosystem: offline training, ranking experiments, forecasting, evaluation and selected inference services.
- **SQL/PostgreSQL** defines durable entities, transactional invariants, ownership and auditable state transitions.
- Avoid a microservice per module. Start with modular services in the existing application and separate deployment only when measured load, isolation or independent scaling requires it.

### Model gateway
Create a provider-neutral server-side model gateway with:
- explicit task-to-model routing;
- provider allowlists and version pinning;
- strict timeouts, bounded retries and token/image limits;
- structured-output schemas and validation;
- per-task budgets and usage telemetry;
- redaction/minimisation before provider calls;
- no secrets or raw customer content in logs;
- provider outage fallback or deterministic/manual workflow;
- offline evaluation sets and regression tests.

Use stronger reasoning/vision models only where they add measurable value. Use smaller, cheaper models for extraction, translation, classification and drafting. Use conventional algorithms for ranking baselines, anomaly signals and forecasts where appropriate. Do not call an LLM for deterministic ownership, payment, permission or prohibited-goods decisions.

The model is replaceable infrastructure, not the product's source of truth. Do not bind the system to GPT, GLM, Qwen, DeepSeek, Gemini or any single vendor.

## 5. The 40 capability contracts

The canonical assignments, owners, inputs, outputs, risk tiers and acceptance tests are in `docs/COMMERCE_INTELLIGENCE_40_MODULES.md`.

Each module must have:
- a stable ID and named business purpose;
- an input/output schema and version;
- a data classification and lawful-purpose statement;
- an owner and dependency list;
- a deterministic fallback;
- offline and online evaluation metrics;
- abuse cases and security tests;
- a feature flag and kill switch;
- cost/latency/error budgets;
- an explicit statement of what it is forbidden to decide.

Modules communicate through versioned contracts and events, not shared mutable in-memory state or hidden prompt-to-prompt messages.

## 6. Event and data architecture

### Event envelope

Every event uses a versioned envelope with:
- `event_id` (globally unique);
- `event_type` and `schema_version`;
- `occurred_at` and server-observed `recorded_at`;
- actor type and pseudonymous internal actor ID;
- tenant/shop scope where applicable;
- object type and object ID;
- purpose/consent context where relevant;
- minimal, typed payload;
- trace/correlation ID.

Events are server-generated after a validated domain action. Never accept a client-supplied event as proof of a purchase, delivery, payment, identity verification or review. Do not log raw WhatsApp bodies, access tokens, private media URLs or unnecessary PII.

### Delivery guarantees
- Use a transactional outbox for events whose publication must follow a database transaction.
- Consumers are idempotent by event ID and have bounded retries, backoff and dead-letter handling.
- Use at-least-once delivery with idempotent effects; do not claim global exactly-once delivery.
- Order-sensitive state transitions use database constraints/transactions, not cache locks alone.
- Event consumers must be replay-safe and schema-version tolerant.

### Storage roles
- **PostgreSQL:** authoritative users, shops, listings, permissions, trust evidence, consent, moderation cases, order/payment state (only if introduced), event/outbox metadata and durable audit records.
- **Object storage:** product images and explicitly retained documents, with private-by-default access for sensitive evidence and lifecycle policies.
- **Cloudflare Durable Objects:** existing authoritative shared rate limiting and suitable strongly coordinated edge state.
- **Redis (optional, evaluated later):** derived cache, short-lived deduplication or high-read ephemeral state only where justified. No source-of-truth records, no trust verdicts, no payment state, no ownership decisions. Require TLS, private networking, ACLs, rotation, persistence/eviction review, monitoring and tested outage behaviour.
- **Analytics/feature store:** derived and minimised data with retention and deletion lineage; do not duplicate raw PII indefinitely.

### Scale and cost
- Start with indexed PostgreSQL tables and bounded event volumes.
- Partition/archive only after measured table growth and query plans justify it.
- Aggregate repetitive view events where possible; use sampling for low-value telemetry without biasing safety evidence.
- Apply per-user/shop/IP quotas and payload limits.
- Load-test connection pooling, queue depth, webhook bursts and hot keys before increasing traffic.
- Keep cold historical events out of latency-sensitive request paths.

## 7. Trust, safety and prohibited goods

Trust is a set of evidence-backed dimensions, not a single opaque score:
- identity evidence and verification level;
- listing and media policy status;
- historical fulfilment evidence (only when actual orders and delivery proof exist);
- dispute and confirmed-violation outcomes;
- account age and behaviour, with safeguards against unfairly disadvantaging new sellers;
- source, recency and confidence of each signal.

A missing signal is **unknown**, not negative proof. A new seller must not be labelled fraudulent simply for having no history.

### Prohibited and regulated goods
- Maintain a versioned policy catalogue with jurisdiction, item category, rationale, source, effective date and required action.
- Hard-block clearly prohibited categories using deterministic server-side policy checks.
- Route ambiguous or regulated listings to a human review queue; do not rely on image/text model confidence alone.
- Keep an audit trail of policy version and decision reason.
- Support appeals and reversals. A report or automated flag is not a confirmed violation.
- Re-check policy at listing creation, edits, reactivation and any future order/advertisement flow.
- Never allow a paid promotion to bypass eligibility or moderation.
- Maintain country-specific rules before enabling a new trade corridor. Do not claim customs, import, export or product certification unless verified by the competent source/partner.

### Trust decision ladder
1. Deterministic eligibility and legal/policy gates.
2. Evidence-backed risk signals and calibrated model assistance.
3. Human review for high-impact or ambiguous cases.
4. Proportionate action with explanation, audit record and appeal.
5. Monitor false positives/negatives and disparate impact; pause a model if quality regresses.

## 8. WhatsApp Merchant Assistant boundary

WhatsApp is an additional interface to Mudaala, not a second marketplace or separate merchant database.

### Identity
- A phone number that can use WhatsApp is not automatically a Mudaala merchant identity.
- The merchant first authenticates to Mudaala and generates a high-entropy, single-use, short-expiry linking code.
- The sender proves control by submitting the code from the WhatsApp number they want linked.
- Consume the code atomically; store a keyed hash, expiry, attempts and consumed state.
- Bind the verified Meta sender ID to one authorised Mudaala user/shop. Support authenticated unlink/revoke and safe relink.
- Never accept a user ID, shop code or phone number typed into chat as ownership proof.

### Message-to-listing flow
1. Verify Meta's webhook signature over exact raw bytes and enforce bounded streaming body size.
2. Apply shared rate limits and message-ID idempotency.
3. Validate the sender link and current authorisation.
4. Retrieve media only via authenticated Meta endpoints; enforce byte, time, MIME and magic-byte limits.
5. Reuse image moderation, metadata stripping and storage policy.
6. Create a private draft; AI can suggest but cannot invent price, quantity, stock, origin or product claims.
7. Ask for missing facts.
8. Show a preview and require explicit confirmation tied to the exact draft revision.
9. Publish through the same listing domain service and constraints as the web application.
10. Return a public URL only after the database confirms the listing.

A material edit invalidates prior confirmation. Duplicate webhook delivery or concurrent confirmation must not create duplicate listings. AI provider failure falls back to a manual draft workflow.

### New phone number
The founder may connect a new number through Meta's supported WhatsApp Business Platform onboarding. Repository work must not unregister, migrate or disturb any existing WhatsApp Business app number. A new number still needs the appropriate Meta Business Account, WABA, app permissions, Cloud API registration and webhook configuration. Credentials are Worker secrets, never Git files.

## 9. Security baseline

“Military-grade” is not a measurable engineering acceptance criterion. The target is defence in depth:
- least-privilege service identities and scoped secrets;
- TLS in transit and managed encryption at rest;
- admin MFA and tightly scoped operator access;
- explicit tenant/shop isolation at every server-side query;
- RLS on exposed Supabase tables, with ownership predicates;
- no service-role or privileged keys in browser bundles;
- input validation, output encoding, CSRF protections where applicable, secure cookies and security headers;
- signed webhook validation, replay/idempotency, payload and rate limits;
- dependency pinning, lockfile integrity, SAST, dependency scanning and secret scanning;
- immutable/append-only audit semantics for privileged actions;
- privacy-safe structured logs and access-controlled incident evidence;
- tested backup, restore, key rotation, incident response and account recovery;
- independent security review and penetration testing before high-risk transaction features.

Security controls must be tested, not merely documented. Never downgrade production shared rate limiting to per-isolate memory if the shared authority fails.

## 10. Buyer, merchant and supplier experience

- Buyer: fast discovery, honest prices, clear seller evidence, visible sponsored labels, accessible controls and a usable guest journey.
- Merchant: simple listing, clear status, explainable insights, safe WhatsApp actions, easy correction and human support.
- Supplier: transparent verification requirements, accurate trade terms, clear fulfilment evidence and a fair appeal path.
- Moderator: evidence-first queues, reason codes, audit history, conflict-of-interest controls and reversible actions.

Do not expose internal risk scores or private reports to other users. Explain outcomes in plain language without revealing anti-abuse thresholds.

## 11. Ads and commercial integrity

- Sponsored inventory is always clearly labelled.
- Ads are eligible only after trust, policy and relevance gates.
- Payment may affect placement within a clearly labelled sponsored auction, never organic trust or safety decisions.
- Do not target using sensitive traits or inferred vulnerability.
- Provide preference controls, frequency caps, advertiser verification and campaign audit logs.
- Measure incremental value and user harm; provide a kill switch.

## 12. Delivery phases and release gates

### Phase A — architecture and evidence (behind the scenes)
- Freeze the 40 module contracts and threat model.
- Inventory existing services, data and open PRs.
- Establish event schemas, privacy classifications and evaluation harness.
- No production migrations, secrets, Meta account changes or deployment.

### Phase B — safe foundations
- Add event/outbox contracts and tests in an isolated branch.
- Implement policy catalogue and trust-evidence primitives.
- Finish WhatsApp webhook hardening review, then merchant linking.
- Use synthetic fixtures and Meta test number only.

### Phase C — first useful intelligence
- Baseline product ranking, search intent and category relevance.
- Build explainable supplier/listing trust evidence.
- Add merchant draft assistance and read-only insights.
- Compare against non-AI baselines before enabling.

### Phase D — staged pilot
- Private test shop and consenting test buyers.
- Shadow-mode recommendations and trust flags.
- Human moderation and manual order/fulfilment processes.
- No escrow or cross-border promises without approved payment, customs and logistics partners.

### Phase E — controlled launch
Each capability must pass: security review, privacy review, unit/integration/e2e tests, load tests, offline evaluation, canary/shadow results, monitoring/alerts, rollback plan, support playbook and explicit founder approval.

## 13. Non-goals for the initial build

- Training a foundation LLM from scratch.
- 40 separately deployed neural networks.
- Reading third-party browser cookies or external browsing histories.
- Secretly inferring class, income, health, religion, politics or other sensitive traits.
- Autonomous suspension, confiscation, payment release or legal determinations.
- Launching international checkout, escrow, customs clearance or freight operations before partners and compliance are verified.
- Changing the live marketplace or enabling unreviewed AI decisions.

## 14. Definition of done

The architecture is not production-ready because a document or model exists. A module is production-ready only when its contract, implementation, tests, monitoring, privacy/security review, evaluation, fallback, owner and rollback are all complete and evidenced. The overall programme remains dark until every required launch gate is signed off.
