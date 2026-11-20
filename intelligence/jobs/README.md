# Intelligence jobs — async contract and durable-store draft

**Status:** Contract implemented (`../contracts/jobs.ts`); durable store is a reviewed draft. Nothing applied anywhere.

## What exists now

- `../contracts/jobs.ts` — job kinds, state machine (`QUEUED → RUNNING → SUCCEEDED/FAILED/CANCELLED/DEAD`), budget caps (≤5 attempts, ≤1 h deadline, 32 KiB payload), bounded backoff, GPU-approval flag. Contract-tested on both planes' sides (TS here, mirrored semantics in Hermes Python).
- Gateway `/v1/jobs` — submission API with idempotent replay detection and submitter-scoped records (staging memory store).
- `schema.sql` — **draft only**: separate `intelligence` schema, outbox + job tables, dead-letter view, reconciliation query. Applying it is an owner-approval decision (master plan §16 forbids unapproved production migrations).

## Decision path (ADR-0004)

1. Owner reviews `schema.sql`.
2. Apply to a staging Postgres first; wire the gateway's `JobStore` adapter to it.
3. Run the reconciliation sweep + dead-letter drill.
4. Only then decide whether Cloudflare Queues replaces/augments Postgres for delivery; the `JobStore` interface is the swap point.

## Why not Cloudflare Queues already

No Queues binding exists; provider semantics (delivery guarantees, retry, dead-letter, cost) are untested; and adding a binding to the commerce Worker now would repeat the CPU-pressure pattern documented in PR #342. The outbox pattern works with what exists today.
