# MCI-27 — Merchant performance analyst (deterministic v0)

**Status:** IN_DEVELOPMENT (implemented + tested; not deployed, not shadowed)
**Contract:** `intelligence/contracts/modules/mci27.ts` · **Engine:** `engine.ts` (`mci27-merchant-performance-analyst-v0.1.0`)
**Gateway route:** `/v1/merchant/insights` · **Latency budget:** 250 ms · **Compute:** CPU_XS · **Owner:** unassigned

## Purpose

Explain a merchant's own shop analytics in plain language: contact-tap rate, views trend, inactive listings, view concentration and fresh-listing traction. Resource matrix order: MCI-27 is the first practical module because the data already exists (`ListingDailyAnalytics`/`ShopDailyAnalytics`, metric definitions in `src/lib/listing-analytics.ts`).

## Rules (v0) and honesty caps

| Rule | Condition | Severity |
|---|---|---|
| `ZERO_CONTACT` | views ≥ 20 and taps = 0 | ACTION |
| `CTR_LOW` / `CTR_WATCH` / `CTR_HEALTHY` | tap rate < 5% / < 10% / ≥ 10% (views ≥ 20) | ACTION / WATCH / INFO |
| `VIEWS_FALLING` / `VIEWS_RISING` | ≤ −20% / ≥ +20% vs previous period (supplied) | WATCH / INFO |
| `DEAD_LISTING_*` | ACTIVE, live ≥ 14 days, 0 views (max 3) | ACTION |
| `VIEWS_CONCENTRATED` | one listing ≥ 80% of views with ≥ 3 listings | WATCH |
| `FRESH_LISTING_*` | live ≤ 7 days with ≥ 10 views (max 2) | INFO |

- Below the minimum sample (`MIN_VIEWS_FOR_RATE = 20`) the insight is withheld and a coverage warning is emitted — never a made-up rate.
- Missing previous-period data is an explicit warning; percentage trends are never invented.
- Every statement cites evidence refs from the snapshot; `confidence` is contract-forced `null` (no calibration exists for rule outputs).

## The tap≠sales rule is executable

`assertNoUnsubstantiatedClaims` (contract) rejects any statement containing "sale(s)", "sold" or "order(s)"; the engine runs it on its own output and the tests assert the negative. Mudaala has no in-app transaction data — a WHATSAPP tap is interest, nothing more.

## Data provenance and minimisation

Input is one merchant's own aggregates, supplied by the authorised caller (the commerce plane computes the snapshot from its tables; the intelligence plane never queries the database). No cross-merchant comparison data is accepted in v0; category benchmarks require valid benchmark data that does not exist yet.

## Explicitly deferred

LLM wording (a later, separable layer behind the same insights), category benchmark comparisons, restock suggestions (MCI-28), demand forecasting (MCI-25).

## Fallback and kill switch

- Fallback: the commerce plane's existing `my/business-analytics` numbers are shown raw — insights are additive.
- Kill switch: per-module disable at the gateway; route scoped `merchant:insights` with per-call merchant subject.

## Tests

`engine.test.ts` — 12 cases: every rule's trigger and severity, sample-size caps, missing-data warnings, concentration arithmetic, executable honesty gate, severity ordering, determinism, version stamping.
