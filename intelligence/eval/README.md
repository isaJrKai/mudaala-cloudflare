# Intelligence evaluation harness

**Status:** Working offline harness for deterministic engines v0. **No production benchmark has been run.**

## What this is

- `fixtures/catalogue.json` — synthetic Ugandan-marketplace catalogue (40 listings, 14 pseudonymous sellers). Every value is invented; nothing is production data.
- `fixtures/queries.json` — 18 author-graded queries (grades 0–3). Judgments were written by the implementing agent; they are **not** human-panel-reviewed.
- `metrics.ts` — nDCG@K, Precision@K, Recall@K, MRR, zero-result rate, distinct-sellers-in-top-5, top-seller share (exposure concentration). Metrics are always reported separately, never combined into one score.
- `run-benchmark.ts` — runs MCI-01 → MCI-02 → filter → MCI-03 → MCI-08 over fixtures and compares against a recency-only baseline on the same candidate set (the evaluation protocol's candidate-vs-current requirement).

## Running

```bash
bun run intelligence/eval/run-benchmark.ts                 # console summary
bun run intelligence/eval/run-benchmark.ts --out intelligence/eval/reports/<date>-<version>.json
bun test intelligence/eval/                                # metric unit tests + benchmark invariants
```

## Recorded runs

| Report | Fixtures | Engines | Headline (SYNTHETIC fixtures only) |
|---|---|---|---|
| `reports/2026-11-20-v0.json` | catalogue v0.1, queries v0.1 | mci01–mci08 v0.1.0 | mean nDCG@5 0.9472 (pipeline) vs 0.7816 (recency baseline); mean MRR 0.9167 vs 0.7268; zero-result rate 0; mean distinct sellers top-5 2.44 vs 2.50 |

**Honest trade-off recorded in that run:** on these fixtures the engagement-weighted ranker concentrates large shops slightly more than recency ordering (2.44 vs 2.50 distinct sellers in top-5). The diversity controller's page-level caps are the counterweight; real exposure fairness needs real exposure logs, which do not exist yet.

## What a run proves and does not prove

A passing run proves: the pipeline executes end-to-end, contracts hold, metrics compute, and the deterministic engines behave as specified **on synthetic fixtures**. It does NOT prove: relevance for real Ugandan queries, fairness on real exposure distributions, language handling on Luganda/code-switch traffic, or production latency. The AI search evaluation protocol (adopted gate spec) requires human-reviewed query sets and real, pseudonymised listing fixtures before any rollout decision — that work is the next increment, not this one.

## Next evaluation milestones (from the protocol)

1. Human-reviewed query set with Ugandan-language reviewers and intent notes.
2. Pseudonymised real-listing fixture set (access-restricted, no buyer data).
3. Per-slice analysis: category, language, listing-age band, shop-size band.
4. Latency/CPU budget measurement on the deployed gateway (requires staging deployment).
