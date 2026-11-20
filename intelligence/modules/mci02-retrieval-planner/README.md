# MCI-02 — Retrieval planner (deterministic v0)

**Status:** IN_DEVELOPMENT (implemented + tested; not deployed, not shadowed)
**Contract:** `intelligence/contracts/modules/mci02.ts` · **Engine:** `engine.ts` (`mci02-retrieval-planner-v0.2.0`)
**Gateway route:** `/v1/search/plan` · **Latency budget:** 100 ms · **Compute:** CPU_XS · **Owner:** unassigned

## Purpose

Turn an MCI-01 query plan into a bounded, executable retrieval plan: filters (statuses, types, categories, price, counties, keywords), retrieval paths with coarse selectivity, ordering, candidate cap and exclusion rules. The commerce plane maps the plan onto its Prisma queries; this engine executes nothing.

## Technique and why

Deterministic planning over structured filters. PostgreSQL full-text/trigram remains the retrieval substrate (matrix: "PostgreSQL-native retrieval first; benchmark vector index before adding a service"). `semantic_path_available: false` is a contract literal — when a semantic path is ever added it must be a contract change, not a silent behaviour change.

## Guardrails made executable (registry row)

- **No private/draft leakage:** filters always carry `statuses: ['ACTIVE']` and the exclusion rules `NO_PRIVATE_OR_DRAFT`, `NO_EXPIRED`, `NO_HIDDEN`, `NO_SEED_LISTINGS` — asserted in contract tests.
- **Bounded query cost:** candidate cap default 200, contract max 500, lower bound 1.

## Data provenance and minimisation

Input is the MCI-01 plan plus optional explicit constraints (category, counties, offer/request) supplied by the authorised caller. No identifiers, no history. Output contains only filter/path metadata. Category selectivity uses the explicit top-level taxonomy ID set; punctuation in category IDs is not treated as taxonomy depth.

## Honest limitations (v0)

- Selectivity labels (NARROW/MEDIUM/BROAD) are planner heuristics for cost shaping, not measured statistics.
- No synonym expansion beyond what MCI-01's concept pack provides; no geo ranking (MCI-07's job, deferred).

## Fallback and kill switch

- Fallback: the commerce plane's existing retrieval path is unaffected — a plan is advisory input, and the client contract treats gateway failure as "plan locally".
- Kill switch: per-module disable at the gateway; no cached plan is ever reused past its request.

## Tests

`engine.test.ts` — 10 cases: plan construction from query plans, constraint precedence, cap bounds, exclusion-rule presence on every plan shape, no-semantic-path honesty, determinism.
