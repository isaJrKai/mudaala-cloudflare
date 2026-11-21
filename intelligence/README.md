# Mudaala Intelligence Infrastructure

**Status:** Increment 1 of the implementation plan (`docs/intelligence/IMPLEMENTATION_MAP.md`). Foundation + first deterministic capabilities. Nothing here is deployed, customer-facing, or production-approved — see `docs/intelligence/COMPLETION_REPORT_INCREMENT_1.md`.

## Layout

| Path | What it is |
|---|---|
| `contracts/` | The stable surface: response envelope, machine-readable 40-module registry, job + event schemas, per-module I/O contracts (zod). The commerce plane imports only this and the gateway client. |
| `modules/` | Deterministic, dependency-free module engines — MCI-01, MCI-02, MCI-03, MCI-08, MCI-27 — each with contract, engine, tests and a governance README (provenance, latency budget, fallback, kill switch, honest limitations). |
| `gateway/` | Separate Cloudflare Worker: HMAC service auth, scopes, rate limits, nonce replay protection, trace propagation, bounded dispatch. Never touches the commerce database. |
| `hermes/` | Python orchestration core: skill governance, budget enforcement, audit log, backend seam, FastAPI control-plane skeleton, first two skills (MSK-001, MSK-006). |
| `eval/` | Offline evaluation harness: synthetic Ugandan-market fixtures, author-graded queries, protocol metrics, benchmark runner vs recency baseline. |
| `jobs/` | Async job contract + Postgres outbox **draft SQL** (not applied anywhere; schema changes need owner approval). |

## Principles in force

1. Commerce availability is independent of the intelligence plane; the gateway client's every failure mode resolves to "use your existing local behaviour".
2. Deterministic before learned: engines are versioned, explainable, and their feature contributions are the input layer of any future model (ADR-0003).
3. Honesty is executable: sample-size caps, `confidence: null` unless calibrated, tap≠sales gates, `UNKNOWN` over guesses.
4. Budgets are safety controls: job budgets, GPU approval flags, Hermes token spend locked at 0 in v0.
5. Nothing is marked production-ready by this tree; statuses live in `contracts/registry.json` and require evidence links to change.

## Testing

```bash
bun test intelligence/ src/lib/intelligence/       # 135 TS tests
python -m pytest intelligence/hermes/tests/        # 23 Python tests
npx tsc -p intelligence/gateway/tsconfig.json      # strict worker typecheck
bun run intelligence/eval/run-benchmark.ts         # offline benchmark (synthetic fixtures)
```
