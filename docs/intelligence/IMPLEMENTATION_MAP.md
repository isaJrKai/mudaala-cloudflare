# Mudaala Intelligence — Implementation Map (Increment 1)

**Status:** Working implementation plan realised by branch `feat/intelligence-foundation-2026-11-20` (based on `docs/mudaala-intelligence-masterplan-2026-11-20`).
**Date:** 2026-11-20
**Inputs:** `MUDAALA_INTELLIGENCE_INFRASTRUCTURE_MASTERPLAN.md`, `MUDAALA_INTELLIGENCE_40_MODULE_RESOURCE_MATRIX.md`, `MUDAALA_INTELLIGENCE_RESOURCES_AND_TRAINING_CATALOGUE.md`, canonical registry (`architecture/commerce-intelligence-foundation`), `REPOSITORY_INVESTIGATION_REPORT.md` (same directory).

---

## 1. Target topology (unchanged from master plan; this map adds placement)

```
                    ┌──────────────────────────────────────────────────┐
                    │  COMMERCE PLANE (existing, untouched latency path) │
                    │  mudaala.store — Next.js/OpenNext on Cloudflare    │
                    │  Supabase/Postgres = system of record              │
                    │  + one additive gateway client (flag-off default)  │
                    └───────────────┬──────────────────────────────────┘
                                    │ server-to-server, HMAC-signed,
                                    │ scoped, bounded, never user-visible
                    ┌───────────────▼──────────────────────────────────┐
                    │  INTELLIGENCE GATEWAY (separate Cloudflare Worker) │
                    │  service auth · scopes · rate limits · idempotency │
                    │  trace IDs · payload caps · timeouts · audit log   │
                    └───────┬───────────────────────────┬──────────────┘
                            │ sync (bounded <1s)         │ async job submit/status
                    ┌───────▼──────────┐        ┌────────▼─────────────┐
                    │ REAL-TIME MODULE  │        │ HERMES CONTROL PLANE  │
                    │ SERVICES          │        │ orchestration, skills,│
                    │ MCI-01/02/03/08   │        │ memory, delegation,   │
                    │ deterministic v0  │        │ budget/audit; Modal-  │
                    └──────────────────┘        │ targeted, local-runnable│
                                                └────────┬─────────────┘
                                                         │ scoped, expiring
                                                ┌────────▼─────────────┐
                                                │ SPECIALIST WORKERS /  │
                                                │ INTELLIGENCE LAB      │
                                                │ (Modal jobs, eval,    │
                                                │  training)            │
                                                └───────────────────────┘
```

Non-negotiables carried into placement decisions:

- The commerce plane never imports intelligence engines; the only coupling is the gateway client, shared contract types and small validated payload adapters.
- The gateway never holds production database credentials and never executes arbitrary queries.
- Hermes never mutates commerce state; every output is a typed recommendation needing an authorised consumer.
- Every module returns the common envelope with `module_id`, `contract_version`, `trace_id`, `reason_codes`, `provenance`, `model_version`.

## 2. Repository placement

| Path | Plane | Contents |
|---|---|---|
| `intelligence/contracts/` | intelligence | Common envelope, module registry (machine-readable, all 40 modules), job + event schemas, per-module I/O contracts (zod + inferred types) |
| `intelligence/modules/` | intelligence | Pure, dependency-free module engines: `mci01-query-understanding/`, `mci02-retrieval-planner/`, `mci03-relevance-ranker/`, `mci08-diversity-controller/`, `mci27-merchant-performance-analyst/` — each with `contract.ts`, `engine.ts`, `README.md` (purpose, provenance, latency budget, fallback, kill switch, status) and tests |
| `intelligence/gateway/` | intelligence | Separate Cloudflare Worker: HMAC service auth, caller registry, scope enforcement, rate limiting (own Durable Object), replay-nonce cache, payload caps, timeouts, trace propagation, health/version endpoints, shadow-mode async job submission stubs |
| `intelligence/hermes/` | intelligence | Python orchestration core: skill registry, task router, budget caps, append-only audit log, `AgentBackend` adapter interface (pinned-release integration deferred), FastAPI control-plane skeleton for Modal, first two Mudaala-owned skills (MSK-001, MSK-006) |
| `intelligence/eval/` | intelligence | Synthetic fixture catalogue + graded query set, metrics (nDCG@K, Recall@K, MRR, Precision@5, exposure concentration, zero-result rate), `run-benchmark.ts` producing versioned JSON reports |
| `intelligence/jobs/` | intelligence | Async job state machine contract + Postgres outbox/job **draft SQL** (explicitly NOT applied — schema changes require owner approval) |
| `src/lib/intelligence/gateway-client.ts` | commerce | Thin typed client: env-gated, HMAC-signed, timeout + circuit breaker, deterministic fallback (`ok: false` → callers keep local behaviour). MCI-27 is optionally wired to `/api/my/business-analytics`; MCI-01/02/03/08 are wired to public text search. Independent flags `INTELLIGENCE_MCI27_ENABLED` and `INTELLIGENCE_DISCOVERY_ENABLED` both default OFF. |
| `src/lib/intelligence/discovery-pipeline.ts` | commerce | MCI-01/02 query preparation + bounded plan, then MCI-03/08 rank/diversity; validates envelopes and slate IDs, applies 28 KiB payload guard, and fails open to the existing local ranker. |
| `src/lib/intelligence/env-flags.ts` | commerce | Follows the existing `env-flags.ts` pure-function pattern |
| `docs/intelligence/` | docs | This map, investigation report, ADRs, operations/cost, deployment/rollback, completion report |

Excluded from root `tsconfig.json`: `intelligence/gateway` (gets its own worker-types configuration) — one additive exclusion, justified in ADR-0002.

## 3. First capabilities and why (matrix Phase 2 order)

| Order (matrix) | Module | Increment-1 treatment |
|---|---|---|
| 1 | MCI-27 Merchant performance analyst | **Implemented (deterministic v0) + opt-in commerce adapter:** typed insight rules over seller-scoped listing analytics; preserves `listing-analytics` metric definitions; taps≠sales enforced in contract tests; insights are surfaced in My Business only when `INTELLIGENCE_MCI27_ENABLED=true`; LLM wording explicitly deferred |
| 2 | MCI-38 Merchant growth coach | **REUSE `src/lib/merchant-growth.ts` unchanged** (investigation decision); registered in the machine-readable registry with status IN DEVELOPMENT (existing code), no duplicate built |
| 3 | MCI-02 Retrieval planner | **Implemented (deterministic v0):** query plan → bounded retrieval paths; `status=ACTIVE` and public-field-only leakage rules in contract tests |
| 3 | MCI-03 Product relevance ranker | **Implemented (deterministic baseline v0):** versioned explainable engine with feature contributions + reason codes; evaluated on fixtures vs baseline ordering per the AI search evaluation protocol |
| 4 | MCI-06 / MCI-08 | MCI-06 left to PR #235's core (commerce plane). **MCI-08 diversity controller implemented** (deterministic rerank with exposure-fairness tests) |
| 5 | MCI-01 Query understanding | **Implemented (deterministic v0):** Unicode-safe normalisation, UGX price-grammar parsing, concept pack aligned with `product-taxonomy` IDs; language-model upgrade deferred pending a local-language benchmark (honest gap, not silently assumed) |

Deferred modules (MCI-04 personalisation, MCI-05 visual, MCI-11/12 policy, MCI-13/14 fraud, MCI-25/26 forecasting/pricing assistant, MCI-35–37 ads, trade block MCI-29–34) carry explicit statuses in `intelligence/contracts/registry.json` with REUSE/ADOPT/ADAPT/BUILD/TRAIN/DEFER decisions — satisfying resource-matrix §11's machine-readable register requirement.

**Discovery adapter boundary:** the initial remote ranking window is 40 candidates (up to two 20-item pages) to stay below the gateway's 32 KiB body cap. Mudaala's existing Prisma visibility and search predicates remain authoritative; MCI-02's plan supplies the bounded candidate cap. Pages beyond that window continue using the local ranker until a larger, measured batching design is approved. No staging activation is implied.

## 4. Gateway surface (v1, this increment)

| Endpoint | Method | Auth scope | Consumer | Notes |
|---|---|---|---|---|
| `/healthz`, `/version` | GET | none | operators | No data, no auth bypass |
| `/v1/search/understand` | POST | `search:understand` | commerce plane | MCI-01; request carries normalised public query text only |
| `/v1/search/plan` | POST | `search:plan` | commerce plane | MCI-02; returns executable bounded retrieval plan |
| `/v1/search/rank` | POST | `search:rank` | commerce plane | MCI-03 v0; candidate features supplied by caller, ranker adds no private state |
| `/v1/search/diversify` | POST | `search:diversify` | commerce plane | MCI-08 |
| `/v1/merchant/insights` | POST | `merchant:insights` | commerce plane | MCI-27; caller supplies that merchant's own aggregates only |
| `/v1/jobs` | POST | `jobs:submit` | commerce plane / Hermes | Async submission; idempotency key; bounded payload |
| `/v1/jobs/{id}` | GET | `jobs:read` | submitter only | Status; no cross-tenant reads |

Cross-cutting: per-caller HMAC (secret id + signature over method/path/timestamp/body-hash/nonce), ±90 s clock window, nonce replay cache in DO, per-caller token-bucket rate limits, 32 KiB payload cap, 5 s upstream deadline, JSON envelope errors, `x-mudaala-trace-id` propagation. Modules return deterministic fallbacks; gateway degradation never changes commerce behaviour (client-side fallback).

## 5. Security model summary

- Caller registry is config, not code: caller id → { secret ref, scopes, rate limit, status }. Secrets live in worker secrets, never Git.
- Signature covers the body hash: no replay or re-ordering attacks on JSON.
- MCI-27 tenant scoping is enforced in the commerce plane BEFORE aggregation: `/api/my/business-analytics` authenticates the seller and every source query is filtered by that seller's `user.id`. The owner id is pseudonymised before the gateway call. Only the HMAC-authenticated commerce service can invoke `merchant:insights`; the gateway never reads the commerce database. Do not expose this route to browser-direct callers or add a cross-merchant scope.
- Logs carry trace IDs, caller ids, module ids, latencies, outcome codes — never query text or payload contents (privacy rule from master plan §5.1.B).
- Kill switch: per-module `INTELLIGENCE_MODULE_<ID>_DISABLED` and a global `INTELLIGENCE_GATEWAY_DISABLED` in the commerce client, plus route-level 503 behaviour in the gateway.

## 6. Eventing and async jobs (decision, not implementation of a broker)

ADR-0004: v1 uses a **Postgres-backed outbox draft** (`intelligence/jobs/schema.sql`, not applied) + the gateway's job submission API; Cloudflare Queues or an external broker is a deliberate follow-up after provider semantics are tested. Nothing in increment 1 publishes events from the commerce Worker.

## 7. Traceability — mandate deliverables → artifacts

| Mandate deliverable | Artifact(s) |
|---|---|
| 1. Repository investigation report | `docs/intelligence/REPOSITORY_INVESTIGATION_REPORT.md` |
| 2. Updated implementation architecture | this map + ADRs 0001–0004 |
| 3. Working infrastructure foundation | `intelligence/contracts/`, `intelligence/jobs/`, `intelligence/eval/` |
| 4. Hermes orchestration integration | `intelligence/hermes/` (core + control-plane skeleton + 2 skills) |
| 5. Secure Mudaala intelligence gateway | `intelligence/gateway/` + `src/lib/intelligence/gateway-client.ts` |
| 6. First operational specialist capabilities | `intelligence/modules/mci01…`, `mci02…`, `mci03…`, `mci08…`, `mci27…` (deterministic v0, status IN DEVELOPMENT) |
| 7. Automated tests and evaluation suite | `bun test` suites + pytest suite + `intelligence/eval/run-benchmark.ts` |
| 8. Deployment configuration and rollback | `intelligence/gateway/wrangler.jsonc`, `.github/workflows/deploy-intelligence-gateway.yml` (manual approval gate), `docs/intelligence/DEPLOYMENT_AND_ROLLBACK.md` |
| 9. Operational and cost documentation | `docs/intelligence/OPERATIONS_AND_COST.md` |
| 10. Completion report | `docs/intelligence/COMPLETION_REPORT_INCREMENT_1.md` |

## 8. What increment 1 deliberately does NOT do

- No production deployment, no secrets creation, no schema migration, no merge to `main`, no customer-facing activation of any intelligence feature (master plan §16 "explicitly not authorised" list respected).
- Increment 1 did not activate any existing route. A later refinement (PR #344) adds an optional MCI-27 call from `/api/my/business-analytics`; it remains disabled unless `INTELLIGENCE_MCI27_ENABLED=true`, and still requires a staging gateway before end-to-end network verification.
- No LLM inside any latency-sensitive path; no vector database; no Redis dependency; no training run of any kind.
- No claimed benchmark results: the eval harness ships with fixtures and a results log that starts empty.
