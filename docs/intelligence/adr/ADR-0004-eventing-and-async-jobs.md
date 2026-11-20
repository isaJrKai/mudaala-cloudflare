# ADR-0004: Eventing and asynchronous jobs — Postgres outbox draft + gateway job API; broker deferred

**Status:** Accepted (increment 1)
**Date:** 2026-11-20
**Scope:** `intelligence/jobs/`, gateway `/v1/jobs` endpoints, Hermes task intake

## Context

Master plan §6.2 requires reliable, idempotent, retryable event delivery with dead-letter handling and explicitly rejects fire-and-forget HTTP from the commerce Worker. Verified constraints: no Cloudflare Queues binding exists; `ioredis` is present in `package.json` but no Redis service is proven; production schema changes are not authorised for this increment ("No production database migration", master plan §16).

## Decision

1. **Define the job/event contracts now, choose the broker later.** `intelligence/jobs/` ships the versioned job state machine (`QUEUED → RUNNING → SUCCEEDED/FAILED/CANCELLED`, `DEAD` after bounded retries with exponential backoff + jitter), idempotency-key semantics, budget fields (max attempts, deadline, compute budget) and an event taxonomy (`intelligence/contracts/events.ts`) aligned with the existing first-party event names (`VIEW`, `CALL_CLICK`, `WHATSAPP_CLICK`, `SHARE_CLICK`, `MerchantGrowthEvent` types).
2. **Postgres-backed outbox/job table as a reviewed draft** (`intelligence/jobs/schema.sql`, separate `intelligence` schema, RLS notes, retention and dead-letter table). It is **not applied** anywhere; it is the ready-to-review proposal for the owner. Postgres is already the system of record and already reachable from trusted server contexts, so it is the lowest-risk durable store for a small job volume.
3. **Gateway `/v1/jobs` API is synchronous-accept only**: submission persists the job (or, in this increment, validates and enqueues into the configured store behind an interface), returns a job id; status reads are scoped to the submitting caller. Hermes consumes jobs through the same interface — it never receives raw database credentials (master plan principle 4).
4. **Cloudflare Queues / external broker is a deliberate follow-up** after a provider-semantics test (delivery guarantees, retry, dead-letter, cost) per master plan §5.2. The queue interface (`JobStore`) is the seam: swapping Postgres for Queues later changes one adapter, not the contracts.
5. **Commerce Worker emits nothing in this increment.** When commerce-plane emission starts, it goes through an outbox written in the same transaction as the domain change, with a separate dispatcher — never an awaited HTTP publish in a request path (Worker CPU constraint).

## Consequences

- Until a store is provisioned and approved, `/v1/jobs` in the gateway operates over the in-memory/DO-backed store for staging tests only; production enablement is a documented, gated step.
- Reconciliation (missing/stuck jobs) is part of the draft schema design (states + timestamps) so the broker swap does not change observability.
- Two implementations of job validation (TS + Python) must stay aligned via shared golden fixtures — accepted under ADR-0001.

## Alternatives rejected

- Adopt Cloudflare Queues immediately: untested semantics, new binding on the commerce Worker (CPU risk), and no consumer deployment exists to receive from it.
- Redis-backed queue now: depends on an unprovisioned service; violates "no new service without measured need".
- Durable-Objects-only queue: fine for rate limiting (bounded), but job durability and reconciliation requirements exceed what a prototype should carry in v1.
