# Mudaala Intelligence Infrastructure — Repository Investigation Report

**Status:** Verified investigation record for implementation increment 1.
**Date:** 2026-11-20
**Author:** Intelligence implementation agent (increment 1)
**Investigated on branch:** `docs/mudaala-intelligence-masterplan-2026-11-20` at `11e8e90`
**Method:** local clone of `isaJrKai/mudaala-cloudflare`; full branch listing; read of all three architecture documents and the canonical 40-module registry; targeted source inspection of the intelligence-adjacent subsystems; GitHub REST API where rate limits allowed; `git diff`/`git log` reconciliation of every related branch. This is a structural audit plus targeted subsystem review, not a line-by-line audit of every route, migration and workflow.

---

## 1. Verified repository baseline

| Fact | Value |
|---|---|
| Repository | `isaJrKai/mudaala-cloudflare` (public) |
| Default branch | `main` at `cdfb6f6d07406fedad4786d65023d8b2910b358d` |
| Architecture branch | `docs/mudaala-intelligence-masterplan-2026-11-20` at `11e8e90` |
| Branch delta over main | 3 commits, docs only: master plan (`fd1cdf3`), skills/training catalogue (`8242304`), 40-module resource matrix (`11e8e90`) |
| Canonical 40-module registry | `docs/COMMERCE_INTELLIGENCE_40_MODULES.md` on `architecture/commerce-intelligence-foundation` (tip `5a69d69`) — **not** copied onto the master-plan branch; content verified to match the master plan §4 reproduction, with per-module guardrails |
| Sibling registry-branch docs | `COMMERCE_INTELLIGENCE_ARCHITECTURE.md`, `COMMERCE_INTELLIGENCE_DATABASE_AUDIT.md`, `COMMERCE_INTELLIGENCE_THREAT_MODEL.md` (same branch, docs only) |

The registry branch contains **no implementation code** — docs only. Its tips (`98939de` DB audit, `57aeb24` code-path audit, `5a69d69` data/safety audit) are audit documents that must be re-read before WS-1 deep audit, but they change no code.

## 2. Existing intelligence-adjacent implementation on `main` (verified)

These are real files, not proposals. Reuse decisions feed the implementation map.

| Asset | Verified content | Reuse decision for increment 1 |
|---|---|---|
| `src/lib/merchant-growth.ts` (172 lines) | Deterministic, explainable next-best-action rules; 7 recommendation types; takes a server-built snapshot; deliberately does not query the DB; unit tests at `merchant-growth.test.mjs` | **REUSE as-is** (this is MCI-38's foundation). Do not duplicate. |
| `src/app/api/growth/recommendation/route.ts` | Authenticated seller endpoint (`requireSeller`), server-side snapshot, calls the rules | Keep in commerce plane; future gateway integration only in shadow mode |
| `src/app/api/growth/events/route.ts` | Merchant event ingestion, allowlisted event schema, idempotency key (`unique(userId, idempotencyKey)` on `MerchantGrowthEvent`) | Existing event-capture precedent; intelligence event taxonomy must stay compatible with its event names |
| `src/app/api/cron/growth-coach/route.ts` | Timezone-aware scheduled notifications (`SCHEDULED_HOURS={8,11,15}`, `DAILY_GROWTH_CAP=4`), `x-cron-secret` constant-time check | Existing scheduled workflow; reuse its guard pattern for new cron surfaces |
| `src/lib/discovery-ranking.ts` (144 lines) | Explainable additive scoring (relevance/freshness/engagement/locality/exposure-balance), one-product-per-shop interleaving, rotation buckets, STOP_WORDS | Pattern reference for MCI-03/MCI-08; intelligence plane implements its own **versioned** engine rather than mutating this file |
| `src/lib/search.ts` (216 lines) | Deterministic intent parsing ("between 20k and 40k", "under UGX 50k"), concept→category table, synonyms, Unicode-safe matching; public route is IP rate-limited via Durable Object | Concept vocabulary and intent grammar inform MCI-01; MCI-01 is an independent versioned engine with its own fixtures |
| `src/lib/price-trends.ts` (193 lines) + `price-movers.ts` (89) | Daily median asking prices; honesty caps (`MIN_SAMPLE=5`, 7-day window, OFFER+ACTIVE only, never cross currency, `take: 5000`) | MCI-26 foundation; honesty-cap pattern copied into intelligence module contracts |
| `src/lib/listing-analytics.ts` (83 lines) | Privacy-preserving daily aggregates in `Africa/Kampala` calendar days; event union `VIEW/CALL_CLICK/WHATSAPP_CLICK/SHARE_CLICK`; no viewer identity | MCI-27's data dictionary; the analyst module must preserve these definitions and never equate taps with sales |
| `src/lib/merchant-kb/` (18 files, 49 FAQ entries) | IDF-weighted matcher with status gating (`live/partial/planned/unverified` — planned/unverified never served as fact), threshold 0.55, ambiguity gap 0.06 | Precedent for grounded answers and "unknown stays unknown" behaviour; informs Hermes skill specs |
| `src/lib/telegram-assistant.ts` | Existing LLM fallback (model constant `openai/gpt-oss-120b`, Redis-backed 4-message history, 24h TTL) via `z-ai-web-dev-sdk` | Existing LLM integration precedent; provider-adapter pattern to follow; NOT part of the intelligence plane |
| `prisma/schema.prisma` | 38 models, no Prisma enums (status strings with inline comments). Key intelligence-adjacent models: `MerchantGrowthEvent`, `ListingDailyAnalytics`, `ShopDailyAnalytics`, `CategoryInterest`, `SavedSearch`, `PriceSnapshot`, `BusinessProduct`, `Sale`, `SaleItem`, `StockMovement`, `AuditLog`, `Notification`. Shop = `BusinessProfile` (1:1 `User`), `Listing.status = ACTIVE|FULFILLED|EXPIRED|ARCHIVED|HIDDEN`, `Listing.type = OFFER|REQUEST`, `Listing.availabilityStatus = UNKNOWN|IN_STOCK|AVAILABLE_ON_ORDER|OUT_OF_STOCK` | Contracts must use these exact identifiers/status vocabularies |
| `wrangler.jsonc` | `main: custom-worker.ts`; DO `MUDAALA_RATE_LIMITER` (`RateLimitShard`, SQLite class); Hyperdrive `HYPERDRIVE`; cron `*/15 * * * *`; observability on; **no Queues/KV/R2 bindings** | Commerce Worker stays thin; gateway gets its **own** worker config, not this one |
| `src/lib/auth.ts`, `src/lib/api.ts` | Opaque 32-byte session token in `Session` table; `route()` wrapper maps `ApiError`/`ZodError`, fails closed on limiter/Prisma outage; bearer auth disabled in production | Commerce-plane auth model; the intelligence gateway uses a **separate** service-auth scheme (HMAC), never user-session cookies |
| Tests / CI | Bun test runner, per-suite npm scripts; 10 GitHub workflows; `validate-pr.yml` runs the named suites + `npm run lint` + Google OIDC script test | New suites follow the same pattern (`bun test`, npm script, explicit CI step) |

## 3. Platform facts that shape the architecture

1. **Worker CPU ceiling (verified, current):** PR #342 (open, updated 2026-11-19, +445/−11, 11 files) documents repeated production `exceededCpu` 503s across unrelated routes, with a 10 ms termination consistent with the Workers Free request CPU allowance. The PR explicitly does not change the production Worker. **Consequence:** zero tolerance for adding synchronous compute to the commerce Worker; intelligence calls must be bounded, optional and flag-gated, or deferred out of the request path.
2. **No event bus exists.** No Queues producer/consumer in `wrangler.jsonc`; `ioredis` is in `package.json` but no provisioned Redis service is proven anywhere in the tree. Fire-and-forget HTTP from the Worker is explicitly rejected by the master plan §6.2.
3. **No intelligence-plane code exists.** `grep -ril` for hermes/modal/embedding/vector/pgvector/gateway over `src/ scripts/ docs/ mini-services/` returns only the three planning docs and unrelated HTML `aria-modal` attributes. `mini-services/` contains only `.gitkeep`.
4. **Privacy posture is real, not aspirational:** coarse/rounded shop coordinates, no viewer identity in analytics, phone numbers kept out of public search payloads, moderation provider failure blocks uploads (fail-closed). Any intelligence data flow must preserve these.

## 4. PR reconciliation (WS-0) — verified states and decisions

GitHub REST API rate-limited per-PR lookups; PR #342 was verified live via API, the others were reconciled from their head branches present in the clone plus the master plan's same-day audit record (2026-11-20).

| PR | Head branch (verified in clone) | Content vs main | State | Increment-1 decision |
|---|---|---|---|---|
| #225 commerce intelligence architecture | `architecture/commerce-intelligence-foundation` | docs only (registry, architecture, DB audit, threat model) | open, draft (per master plan same-day record) | Treat its `COMMERCE_INTELLIGENCE_40_MODULES.md` as **canonical**. No merge, no copy — the master plan §4 already reproduces it. Registry-branch audits re-read during WS-1. |
| #234 commerce discovery network vision | `docs/mudaala-commerce-network-vision` | docs only: recommendation engine spec (598 lines: two-stage pipeline, eligibility-before-ranking, Stage A–D philosophy), platform principles, product constitution, vision | open (per master plan record) | Design constraints adopted into the implementation map: eligibility gates precede ranking; Stage A = reliable deterministic discovery. No code taken. |
| #235 shared channel-neutral recommendation core | `feature/commerce-intelligence-core` | **real code**: `src/lib/commerce-intelligence/contracts.ts` (channel/surface vocabularies, `RecommendationContext`, `ChannelAdapter`), `recommendations.ts` (`rankRelatedListings`, deterministic related-products v0 with reason codes), 126-line tests; rewires `/api/listings/[id]/recommendations` | open, draft (per master plan record) | **Do not re-implement inside the intelligence plane in this increment.** Alignment decision instead: gateway contracts adopt the same `channel`/`surface` vocabulary so the unmerged core and the intelligence plane converge instead of diverging. Related-item ranking (MCI-06) stays with that PR's core in the commerce plane. |
| #341 verified-email auth | (branch not intelligence-related) | email auth implementation | open (per master plan record) | Out of scope. Known risk: PR #342 reports main build failures from partial email-auth imports; must be re-verified before any build-relevant work merges near it. |
| #342 onboarding CPU findings | `fix/onboarding-google-signup-cpu-polling-2026-11-20` | fix + documented production CPU evidence | **verified open via API 2026-11-20** | Treat Worker CPU scarcity as a live production constraint (see §3.1). |
| `ai/ranking-engine-implementation-2026-10-30` | same branch | docs only: `docs/AI_SEARCH_EVALUATION_PROTOCOL.md` (86 lines) | unmerged | **Adopt as the evaluation gate spec** for ranking work: Precision@5/nDCG@5, zero-result and duplicate rates, exposure concentration, privacy gates, decision rule, results log. Increment 1's harness implements exactly these metrics. |
| `feature/merchant-growth-coach-foundation` | same branch | largely already on main (merchant-growth, web-push present) | stale | No action; do not merge. |

**Conflict map:** the only realistic collision is naming — PR #235 owns `src/lib/commerce-intelligence/*` in the commerce plane. Increment 1 therefore places the intelligence plane in a new top-level `intelligence/` tree and keeps commerce-plane additions to a single client module under `src/lib/intelligence/`, a path that PR #235 does not touch.

## 5. Verified gaps (absence, not opinion)

- No Hermes runtime, no Modal (or other provider) deployment, no intelligence gateway, no model/prompt/skill registry, no training/eval harness, no vector store, no feature store, no independent intelligence service anywhere in the tree.
- No durable queue/outbox implementation for intelligence events; the master plan's §6.2 pattern is unimplemented.
- No machine-readable module registry (the resource matrix §11 asks for one); statuses for all 40 modules are prose.
- No cross-surface trace ID propagation; observability today is Worker-level logging only.
- No spend/budget controls anywhere (nothing to control yet — but no scaffolding either).

## 6. Risks carried into implementation

| Risk | Handling in increment 1 |
|---|---|
| Commerce Worker CPU ceiling is a live production problem | Intelligence gateway is a separate worker; commerce-plane client is flag-off by default, timeout-bounded, circuit-broken, and no existing route is rewired |
| Unmerged PR #235 may land later | Contracts adopt its channel/surface vocabulary; `intelligence/` tree is disjoint from its paths |
| ioredis/Redis unproven | Nothing in increment 1 requires Redis; queue design uses a Postgres-backed outbox pattern (draft SQL, not applied) |
| Production build fragility reported by PR #342 | No changes to `src/` except one additive client module + one additive env-flags module + tsconfig exclusion; no schema, dependency or route changes |
| Author-graded fixtures are not human-panel judgments | Evaluation reports state fixture provenance explicitly; results log starts at "not run" |
| No provider credentials in this environment | All deployments are config-plus-procedure; nothing is deployable without owner secrets and approval |

## 7. Conclusions feeding the implementation map

1. The foundation gap is real and the plan's ordering (contracts and gateway before any module calls production) is confirmed by the audit: there is nothing to integrate with yet.
2. Existing deterministic code is high quality and honest; the intelligence plane should reuse its patterns (honesty caps, reason codes, explainability, status gating) rather than transplant its code across planes.
3. The evaluation protocol from the AI ranking branch is the correct gate spec and is implemented by this increment's harness.
4. Matrix Phase 2 ordering (MCI-27 → MCI-38 reuse → MCI-02/03 → MCI-06/08 → MCI-01/04) governs capability selection; increment 1 delivers the foundation plus the deterministic versions of MCI-01, MCI-02, MCI-03, MCI-08 and MCI-27.
