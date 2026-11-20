# MSK-006 — Search Relevance Evaluator

**Status:** active (v0.1.0) · **Owner:** unassigned · **Task types:** `RUN_SEARCH_RELEVANCE_EVAL`

## Objective

Run the deterministic discovery pipeline (MCI-01 → MCI-02 → MCI-03 → MCI-08) against the fixed synthetic fixture set, produce the versioned metrics report (nDCG@5, Precision@5, Recall@10, MRR, exposure metrics, zero-result rate), and summarise the pipeline-vs-baseline comparison **without editorialising beyond the numbers**.

## Tool: `bun_run_eval`

Runs exactly one command:

```bash
bun run intelligence/eval/run-benchmark.ts --out intelligence/eval/reports/<run-stamp>.json
```

The command is fixed by this skill. Any other invocation (different scripts, extra flags beyond `--out`, repository writes) is forbidden and must be refused.

## Method

1. Invoke `bun_run_eval` once (budget: 1 tool call, default).
2. Read the report's `aggregates.pipeline` and `aggregates.baseline` blocks.
3. Summarise: per-metric pipeline vs baseline values, verbatim; note the fixture versions and engine versions from the report; restate the report's `synthetic_data_notice`.
4. Set `result_ref` to the report path.

## Hard rules (adopted evaluation protocol)

- Metrics are reported separately; NEVER combine them into one score.
- Never describe synthetic-fixture results as production evidence.
- Never edit fixtures, judgments, weights, or engines to make numbers look better.
- A passing run is not a release decision; release gates need human-reviewed query sets and the full protocol checklist.

## Failure behaviour

- The tool call fails → return FAILED with `reason_codes: ["EVAL_COMMAND_FAILED"]` and the exit code; do not retry beyond budget.
- Missing `bun` in the environment → FAILED with `reason_codes: ["EVAL_RUNTIME_UNAVAILABLE"]`.

## Security notes

- `bun_run_eval` is allowlisted to the single command above; implementers must refuse flag injection through the output path (reject `--out` values containing shell metacharacters).
