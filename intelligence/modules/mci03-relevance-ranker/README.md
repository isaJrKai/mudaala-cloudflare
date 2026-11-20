# MCI-03 — Product relevance ranker (deterministic v0)

**Status:** IN_DEVELOPMENT (implemented + tested + fixture-benchmarked; not deployed, not shadowed)
**Contract:** `intelligence/contracts/modules/mci03.ts` · **Engine:** `engine.ts` (`mci03-ranker-v0.1.0`)
**Weights:** `MCI03_WEIGHTS` (provenance ref `mci03.weights.v0`) · **Gateway route:** `/v1/search/rank`
**Latency budget:** 200 ms · **Compute:** CPU_S · **Owner:** unassigned

## Purpose

Rank eligible candidates for a query plan with explainable scoring: text relevance (title/description coverage + category-hint bonus, relevance floor), freshness (refresh-based exponential decay), engagement (aggregate counts only, log-scaled, saturating), locality (caller-authorised coarse context), availability (IN_STOCK +4 / ON_ORDER +2 / UNKNOWN 0 / OUT_OF_STOCK −10) and a new-shop opportunity boost.

## Why deterministic v0

Registry decision: BUILD baseline, ADAPT a learning-to-rank model only after human-judged relevance labels exist. The v0 `contributions` object is deliberately the future feature vector — adding an ML scorer later is a version bump behind the same contract, not a rewrite.

## Privacy posture

- Sellers are pseudonymous `seller_ref` values; no user ids.
- Engagement inputs are coarse aggregate counts (no viewer identity, mirroring `listing-analytics`).
- No per-user state: personalisation belongs to consent-gated MCI-04, not here.

## Evaluation

`intelligence/eval/` — nDCG@5 0.9472 vs recency baseline 0.7816, MRR 0.9167 vs 0.7268 on **synthetic author-graded fixtures** (report `reports/2026-11-20-v0.json`). Honest trade-off recorded: slightly lower top-5 seller breadth than recency (2.44 vs 2.50) on this fixture set. These numbers say nothing about production quality until the protocol's human-reviewed fixture work happens.

## Honest limitations (v0)

- No semantic understanding beyond exact token overlap and the concept pack; synonyms/typos are handled only where MCI-01 normalises them.
- Freshness uses `refreshed_at`; a refreshed old listing legitimately re-surfaces (commerce semantics), but refresh-gaming needs monitoring with real data.
- Weight values are engineering judgement, not measured optima; changing weights requires a benchmark re-run (harness included).

## Fallback and kill switch

- Fallback: callers keep their existing ordering (the recency baseline in the harness is exactly such a fallback); gateway failure means "use your current ordering".
- Kill switch: per-module disable at the gateway; the commerce client never blocks on this route.

## Tests

`engine.test.ts` — 9 cases: coverage/float, relevance floor, description budget, freshness ordering, engagement saturation, locality authorisation, availability honesty (unknown ≠ dead), new-shop boost, contract validation, tie-break determinism.
