# MCI-08 — Discovery diversity controller (deterministic v0)

**Status:** IN_DEVELOPMENT (implemented + tested; not deployed, not shadowed)
**Contract:** `intelligence/contracts/modules/mci08.ts` · **Engine:** `engine.ts` (`mci08-diversity-controller-v0.2.2`)
**Gateway route:** `/v1/search/diversify` · **Latency budget:** 50 ms · **Compute:** CPU_XS · **Owner:** unassigned

## Purpose

Take an MCI-03 ranking and produce a diversified slate without randomness:

1. **Per-seller cap** (default 2) — beyond-cap items demoted to the tail with the rule recorded.
2. **Adjacency pass** — no two consecutive items from one seller where an alternative exists.
3. **Exploration promotion** — up to `exploration_slots` (default 1) promotions of first-time sellers into the top window (default 10).

Every demotion/promotion carries a machine rule tag (`PER_SELLER_CAP_*`, `ADJACENCY_SWAP`, `EXPLORATION_PROMOTION`) and the result includes a fairness report (distinct sellers in top-5, top-seller share, applied caps, promotions used).

## Guardrail honesty

- **Relevance preservation is measurable:** the slate is a permutation of the input ranking restricted by the cap; the top-1 item never moves unless the cap requires it (tested).
- **`new_shop_slots_used` is defined as exploration promotions**, not a claim about shop age — v0 metadata carries no reliable new-shop signal. Counting promotions avoids fabricating a "new shop" fact.
- Real exposure fairness needs real exposure logs; the fixture benchmark records the observed trade-off (see `intelligence/eval/README.md`) instead of hiding it.

## Data provenance and minimisation

Input: ranked ids + per-id `{seller_ref, category_id, published_at}` metadata only. No engagement, no pricing, no identity data reaches this module. The direct engine boundary enforces the same 1,000-key metadata cap as the gateway contract.

## Fallback and kill switch

- Fallback: the input ranking itself (un-diversified) — the controller is an enhancement, never a dependency.
- Kill switch: per-module disable at the gateway.

## Tests

`engine.test.ts` — 10 cases: cap behaviour + reporting, top-1 preservation, adjacency invariant, exploration promotion (isolated), permutation/relevance preservation, fairness report arithmetic, empty input, determinism.
