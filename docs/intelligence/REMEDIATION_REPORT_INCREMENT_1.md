# Increment 1 Remediation — Implementation and Verification Report

**Branch:** `fix/intelligence-increment1-remediation` (from `feat/intelligence-foundation-2026-11-20`)
**Scope:** Increment 1 remediation only — no Increment 2 work, no merge, no deploy, `main` untouched.
**Working rule applied:** investigate → fix → test → verify → report.

---

## 1. Original defects investigated

Independent review identified defects in six areas. All were reproduced against the actual code before fixing:

| # | Defect | Location (increment-1 state) | Confirmed |
|---|---|---|---|
| A | Nonce replay protection split check (`seen()`) from record (`record()`) — TOCTOU race; concurrent identical requests could both pass; no caller isolation (nonce shards keyed only by nonce value); no expiry (no alarms, unbounded DO storage) | `gateway/src/index.ts` (steps 4), `gateway/src/do.ts` (`/nonce`, `/nonce-record`), `gateway/src/limiter.ts` | ✔ (new concurrent test fails against old code) |
| B | Payload cap enforced after `request.text()` fully buffers the body; size measured in UTF-16 code units, not bytes; Content-Length the only pre-read guard (missing/misleading headers unprotected) | `gateway/src/index.ts` (steps 2–3), `gateway/src/auth.ts` (hash over re-encoded text) | ✔ (emoji regression + chunked-stream test) |
| C | Hermes accepted client-supplied `submitted_by` as task identity; zero authentication on any endpoint; no task-ownership scoping; admin surface absent; payload unbounded | `hermes/server.py`, `hermes/contracts.py` (TaskSubmission.submitted_by), `hermes/router.py` | ✔ |
| D | Idempotency replayed the original job for ANY reuse of a key (different payload included) on both planes; no retention; payload size in code units | `gateway/src/handlers.ts` (MemoryJobStore), `hermes/server.py` (TaskStore) | ✔ |
| E | Engines trusted TypeScript types / pydantic annotations as runtime validation; MCI-03 query_plan never validated; MCI-08 `ranked` typed as `z.array(z.unknown())` and never validated by the engine; internal error messages leaked to callers | `contracts/modules/mci02.ts`, `modules/*/engine.ts`, `gateway/src/index.ts` catch block | ✔ |
| F | MCI-08: seller-cap demotions vanished from the returned slate (contradicting the documented tail-placement behaviour); `rotation_bucket` declared in contract/docs but never implemented; schema.sql contained invalid PostgreSQL (`CREATE VIEW IF NOT EXISTS`) | `modules/mci08-diversity-controller/engine.ts`, `contracts/modules/mci08.ts`, `jobs/schema.sql` | ✔ |
| G | Repo hygiene: `__pycache__/`, `*.pyc`, `.pytest_cache/` committed; no python ignore rules | `intelligence/hermes/**` | ✔ |
| H | Increment-1 CI had no dependency-install step (TS tests import zod from node_modules) and no database verification — it could not have passed end-to-end | `.github/workflows/validate-intelligence.yml` | ✔ |

## 2. Root causes identified

- **A/B (gateway):** the increment-1 design composed security steps from independent await calls. Replay protection needs a single atomic decision (check-and-record with no interleaving window); payload caps must be enforced at the stream boundary. Root cause: treating the DO and the request pipeline as loosely-coupled helpers instead of atomic security boundaries.
- **C (Hermes):** identity was a request field. Root cause: no authentication layer existed at all — "who called" was whatever the client said. Ownership, scoping and admin capability all derive from the missing verified-identity primitive.
- **D (both planes):** idempotency keys were treated as replay-detection only; correctness requires content equality (key + canonical payload). Root cause: no canonical payload representation and no conflict semantics.
- **E (modules):** validation lived at the HTTP edge only, and not everywhere even there. Root cause: TS types mistaken for runtime guarantees; direct engine callers (eval, Hermes handlers) bypassed the boundary entirely.
- **F (MCI-08/SQL):** documented behaviour and implemented behaviour diverged (docs said "tail", code dropped); `rotation_bucket` was designed, declared, never wired; SQL was drafted without ever being executed against PostgreSQL (invalid syntax survived).
- **G/H (hygiene/CI):** generated artifacts were added before ignore rules existed; the workflow was written but never executed once.

## 3. Files changed

Remediation commits on `fix/intelligence-increment1-remediation` (base: `a745984756a07520efc66e892bcc6dfa64c1a2dc`):

| Commit | Content |
|---|---|
| `0c0ef3e` | chore(intelligence): untrack + ignore generated python artifacts |
| `0179970` | fix(gateway): atomic nonce consumption, caller isolation, TTL expiry alarms, DO storage bounds, header hardening |
| `07f68cb` | fix(gateway): streaming payload cap (UTF-8 bytes), byte-exact HMAC, stable error envelopes, no internal-detail leaks |
| `c541a3d` | fix(gateway): idempotency payload-conflict detection, retention policy, byte-accurate store caps |
| `ba4c876` | feat(hermes): service authentication, verified ownership, tenant isolation, idempotency core, runtime validation, stable errors, lifecycle contracts, storage protocol |
| `4524e89` | fix(jobs): valid repeatable PostgreSQL migrations (001 jobs/outbox, 002 Hermes tasks/nonces, 003 RLS), migration runner, corrected schema.sql, disposable-PG tooling |
| `2538aa4` | test(jobs): schema gate against disposable PostgreSQL |
| `5e03362` | fix(modules): MCI-08 tail placement + implemented rotation bucket + dedup/metadata hardening; runtime validation in all five engines (v0.2.0) |
| `f242242` | feat(eval): post-remediation benchmark report + honest before/after comparison |
| `758fd21` | docs(intelligence): gateway/hermes/jobs READMEs match the implementation |
| `b099144` | ci(intelligence): end-to-end workflow — lockfile installs, SQL gate, disposable PG service |

## 4. Implementation completed

**Gateway (3 commits).** `NonceCache.consume()` — one atomic check-and-record per (caller, nonce); DO decides in a single synchronous block (claim map + storage double-check), shards named `n:<callerId>:<nonce>` (≤64-char idFromName budget enforced by header validation); alarms delete shard storage at TTL (bounded namespace). Streaming cap: `readBodyCapped()` cancels the reader at the first byte past 32 KiB — never buffers the rest; sizes measured in UTF-8 bytes; HMAC computed over the exact bytes received; strict UTF-8 decode before JSON.parse; malformed values/streams → stable envelopes; unexpected handler failures → generic `MODULE_INTERNAL` (details only in the metadata-only log line). Job store: canonical (sorted-key) payload comparison — content-equal payload replays, different payload → `409 IDEMPOTENCY_CONFLICT` (new stable code); synchronous submit makes same-isolate concurrency duplicate-safe; retention sweep (24 h finished records; 1 000-entry bound); byte-accurate caps.

**Hermes (2 commits).** `hermes/auth.py` — HMAC scheme identical to the gateway; identity ONLY from the verified signature; caller/secret-id ≤32 chars, nonce ≤64, strict digit/hex patterns; nonce store caller-scoped and atomic (in-process lock; cross-replica via the `hermes_nonces` table). `hermes/validation.py` — payload ≤16 KiB UTF-8 bytes, depth ≤6, ≤200 values, strings ≤2 000 chars, strict task/trace ids, explicit `require_admin`. `hermes/errors.py` — every failure renders the stable envelope; handlers log class names, never payloads. `hermes/contracts.py` v0.2 — full lifecycle (SUBMITTED→VALIDATED→QUEUED→RUNNING→SUCCEEDED/FAILED/CANCELLED + REFUSED, DEAD), transition table, receipts (one per attempt, bounded), failure classification, retry backoff, `payload` persisted for restart recovery, strict schemas (`extra=forbid`, `validate_assignment`), client identity rejected. `hermes/storage.py` — TaskStore protocol; MemoryTaskStore thread-safe with scoped reads, retention, size bounds; PostgresTaskStore — atomic claims (`FOR UPDATE SKIP LOCKED`), UNIQUE idempotency + canonical-payload conflict detection, scoped reads, recovery, retention, cross-replica nonce consume. `hermes/router.py`/`worker.py` — governance chain + attempt execution with hard timeout (thread + `future.result(timeout=budget.max_seconds)`), receipts, retry scheduling, cooperative cancellation, stale-RUNNING recovery sweep, graceful shutdown. `hermes/handlers.py` — the two Increment-1 skills registered as reviewed code: `ORIENT_PRODUCT_FACTS` (grounds only in caller-supplied approved excerpts — nothing invented), `RUN_SEARCH_RELEVANCE_EVAL` (runs the one fixed benchmark command, reports metrics verbatim). `hermes/backends.py` — provider seam with `NotConfiguredProvider` (refuses everything; no silent mock). `hermes/server.py` — authenticated/scoped API: `/healthz`, `/readyz`, `/version`, `POST/GET /v1/tasks`, `POST /v1/tasks/{id}/cancel`, `GET /v1/tasks`, admin dead-letter list + bounded requeue; streaming body cap; lifespan worker wiring.

**Modules + SQL + eval + CI (4 commits).** MCI-08 v0.2.0: tail placement restored (slate is a full permutation of the input), `rotation_bucket` implemented (deterministic window rotation; 0 = no-op), dedup, metadata bounds, runtime zod validation, fairness computed from the final slate. MCI-01/02/03/27 v0.2.0: every engine re-validates its inputs; `validateMCI02Request` strictly parses the plan. SQL: three tracked migrations (jobs/outbox; hermes_tasks + hermes_nonces; RLS owner/admin policies), `apply-migrations.mjs` runner with `intelligence.migrations` tracking, corrected consolidated `schema.sql`, `dev-postgres.mjs` disposable embedded PostgreSQL. Eval: reproducible report `reports/2026-11-20-v0.2-remediation.json`. CI: install step, SQL gate, disposable PG service, pinned Python deps.

## 5. Tests executed and actual results (local run, 2026-11-20)

| Suite | Command | Result |
|---|---|---|
| TS intelligence (contracts, modules, gateway, eval) | `bun test intelligence/` | **178 pass / 0 fail** (56 gateway incl. DO-concurrency + streaming-cap; new SQL gate 3) |
| Commerce-plane gateway client | `bun test src/lib/intelligence/` | pass (included above) |
| Gateway typecheck | `npx tsc -p intelligence/gateway/tsconfig.json --noEmit` | clean |
| Hermes full suite | `python -m pytest intelligence/hermes/tests/` | **105 pass / 0 fail** (up from 23; includes disposable-PG durability suite) |
| Benchmark | `bun run intelligence/eval/run-benchmark.ts` | reproduced `reports/2026-11-20-v0.2-remediation.json` |
| ESLint (existing CI) | `npx eslint intelligence/ src/lib/intelligence/` | 0 errors (1 pre-existing-style warning) |

Baseline before remediation: 135 bun + 23 pytest, tsc clean — preserved and re-verified at branch-out.

## 6. Security findings resolved

1. **Replay race closed** — atomic consume; acceptance met: concurrent duplicate requests admit exactly one (`Promise.all` worker test + 3-way DO test).
2. **Caller isolation** — nonce shards per (caller, nonce); one caller cannot pre-burn another's nonces.
3. **Unbounded DO storage bounded** — alarm-based deletion at TTL; expired records safely overwritten.
4. **Unbounded body buffering eliminated** — cap enforced mid-stream, bytes measured; misleading/missing Content-Length handled.
5. **Hermes identity forged → impossible** — identity only from verified HMAC; `submitted_by` in a request body is rejected outright; strict schemas forbid extra fields.
6. **Cross-tenant access closed** — owner-scoped reads/updates/cancellation/listing; foreign access returns the same 404 as a missing task (no existence leak); admin is a separate, audited capability; admin endpoints return 403 without it.
7. **Idempotency misuse closed** — different payload under a used key → 409 on both planes; duplicate jobs impossible within an isolate (sync submit) and across replicas (UNIQUE constraint).
8. **Internal-detail leaks closed** — stable generic envelopes for validation and unexpected failures on both planes; schema field details never echoed.
9. **Malformed-input surface closed** — header/nonce/timestamp/signature format validation (no log injection), strict UTF-8, bounded payloads/depth/strings, safe task-id parsing (path traversal rejected).

## 7. Remaining limitations

- **Hosting:** Hermes is designed for continuous availability but has never been deployed — supervision, restart-under-real-hosting, alerting are unproven (WS-3/WS-5). What tests prove: state survives store restarts, stale-RUNNING recovery, graceful shutdown.
- **Thread-based timeouts:** Python cannot force-kill a handler thread; a budget-ignoring handler keeps its thread busy (the task still fails on time, receipt records TIMEOUT).
- **RLS role binding:** owner RLS binds when connecting as the scoped app role with `SET LOCAL intelligence.owner`; superuser/table-owner sessions bypass it by design.
- **Query strings outside the HMAC** (path-only canonical, mirroring gateway ADR-0002): do not make authorization decisions on query parameters alone.
- **Single-process Hermes nonce store** (in-memory) is per-replica; multi-replica deployments must use `PostgresTaskStore.consume_nonce` (implemented, tested) as the NonceStore.
- **Benchmark is synthetic**: author-graded fixtures; no production relevance, fairness or latency claims are possible or made.
- **Job execution** (`/v1/jobs`) remains staging (memory store) pending the approved durable-store wiring decision (ADR-0004); the interface and SQL are ready.

## 8. Infrastructure still requiring provisioning (owner actions, not code)

1. Gateway secrets: `INTELLIGENCE_CALLERS` (provisioned secrets), `GATEWAY_VERSION`, kill switch; service binding from the commerce worker; then staging deploy.
2. Hermes hosting (Modal or alternative) + `HERMES_CALLERS` + `HERMES_DATABASE_URL`; staging PostgreSQL instance; the app DB role for RLS binding.
3. Production database migrations remain owner-approval decisions (master plan §16) — nothing here touches production.
4. Log/alerting pipeline for the structured JSON events (gateway + Hermes + audit JSONL).

## 9. Dependency and cost implications

- **Added:** `psycopg[binary]==3.3.9` (Hermes durable store; no paid service). **Pinned:** fastapi 0.128.0, uvicorn 0.44.0, pydantic 2.12.5, httpx 0.28.1, pytest 9.0.2 (lockfile-grade requirements). No new paid services, no model providers, no external APIs.
- **Removed:** none (no functionality silently removed — MCI-08 tail placement RESTORES documented behaviour).
- **Cost:** zero incremental spend (deterministic engines, no model calls, `max_model_tokens` contract-locked at 0; CI uses disposable PG). The SQL gate adds ~seconds of CI time.
- **Registry/consistency:** `intelligence.migrations` tracking, RLS policies and lifecycle CHECKs are structural; module registry unchanged (no status inflation — modules remain IN_DEVELOPMENT with existing evidence).

## 10. Branch name and commit SHAs

- Branch: `fix/intelligence-increment1-remediation`
- Round-2 tip (pushed): `a1f6e71370023df1c954ca8a9a474db146bfe22c`
- Round-3 fix commit: directly follows the round-2 tip; its SHA is recorded in the compiled report (§10 there) and the delivery summary.
- Round-1 report tip: `3566da165561dd7b2af3e1c90b819a7bdb706e66` (compiled round-1 report; commit `6f5de18631381f2cea5331a24f4f9420c1d16caf` carried the round-2 remediation).
- Original implementation tip (untouched): `a745984756a07520efc66e892bcc6dfa64c1a2dc`; `main` untouched at `cdfb6f6d07406fedad4786d65023d8b2910b358d`.

## 11. CI run links

The remediated workflow validates on pull_request (paths-filtered) and `workflow_dispatch`. No PR existed at report time (draft-PR creation was blocked earlier by token scope), so CI runs are pending the PR the reviewer opens. Required status check: **"Validate Mudaala intelligence workstreams"** (jobs: `typescript`, `python`). Dispatch command:

```bash
gh workflow run validate-intelligence.yml --ref fix/intelligence-increment1-remediation  # or via the Actions tab
```

## 12. Evidence that the original feature branch and `main` were not damaged

- `git diff --stat feat/intelligence-foundation-2026-11-20..fix/intelligence-increment1-remediation` touches ONLY `intelligence/**` and `.github/workflows/validate-intelligence.yml`; **zero** changes under `src/app`, `prisma/`, or root config.
- `main` tip before and after: `cdfb6f6d07406fedad4786d65023d8b2910b358d` (verified via `git ls-remote`).
- The nine original Increment-1 commits are intact on both branches; the remediation branch is a strict descendant (`git merge-base --is-ancestor`).
- No force-push at any point; the branch is pushed as a normal fast-forward.

---

## 13. Round 2 — remediation of the independent reviewer findings (2026-11-20)

The independent review of the round-1 branch confirmed the work was substantial but identified five findings. Every finding was reproduced against the actual code before fixing, fixed, and covered by tests. Round-2 commit: `fix(intelligence)` on the same branch (SHA in §10).

**Finding 1 (critical) — durable storage was not wired into the application.** `create_app()` defaulted to `MemoryTaskStore`/`InMemoryNonceStore`/`InMemoryAuditLog` and never read `HERMES_DATABASE_URL`. Fixed in `hermes/server.py`: `resolve_storage_from_env()` wires `PostgresTaskStore` + `PostgresNonceStore` + `PostgresAuditLog` when the variable is set; configuration is validated explicitly (a non-postgres URL or an unreachable database ⇒ startup FAILS — no silent degradation); without the variable Hermes still starts on memory stores, announced as `memory-ephemeral` on `/version` and in a startup warning (deliberate: the commerce plane keeps working with or without Hermes). `HERMES_ADMIN_DATABASE_URL` wires the separate infrastructure role for worker claims, retention and admin reads. Evidence: an end-to-end test submits a signed task through the API with NO injected stores — the task lands in PostgreSQL (verified by an independent raw connection) plus an audit row; a split-connection test drives tenant and admin paths over two roles; malformed-URL, bad-admin-URL and dead-database tests all fail startup.

**Finding 2 (critical) — RLS existed but was never exercised.** Fixed on both sides. Migrations: `003`/`005` now FORCE row-level security on `hermes_tasks`, and `005` provisions the documented role model (`intelligence_app` tenant path, `intelligence_worker` infrastructure path, admin membership granted by the operator — never by migrations) with least-privilege grants. Store: every tenant operation runs in an explicit transaction with `set_config('intelligence.owner', <verified caller>, is_local => true)` (transaction-scoped — a test proves nothing leaks onto the session); worker/admin operations run on the infrastructure connection. Evidence (dedicated LOGIN roles with exactly the migration-005 grants): a restricted role sees ZERO rows with no owner context and with a WRONG context; rows appear only under the correct context; INSERT without context is rejected by the WITH CHECK policy; the app role's unscoped read, cross-tenant list and claim return NOTHING (those paths require the admin role — structurally enforced by the wiring); the admin role's paths work. Documented honestly: RLS defends against context-less/buggy paths and non-app roles; the app role setting the caller's context is the verified-auth contract itself (identity comes only from the HMAC signature).

**Finding 3 (high) — cross-replica idempotency race.** `create()` was SELECT-then-INSERT under a local lock: two replicas raced and the loser received a uniqueness error. Fixed: a single `INSERT ... ON CONFLICT (submitted_by, idempotency_key) DO NOTHING RETURNING task_id` decides atomically in the database; the loser re-reads the committed winner and replays it (payload-equality check preserved; genuine conflicts still raise `IdempotencyConflict`). Evidence: three independent store instances × five rounds race on the same key — every request succeeds, exactly one creates, two replay, all return the same task id; a separate test proves the conflict path raises `IdempotencyConflict` on the loser and still replays the original afterwards.

**Finding 4 (medium) — rotation could reintroduce same-seller adjacency.** Rotating `A,B,C,A` left once yields `B,C,A,A`; a promotion vacating an interior slot had the same hazard. Fixed in the engine (v0.2.1): the adjacency pass became a reusable repair used three times — the initial pass is behaviour-identical to increment-1 (forward-only, top-1 stability preserved); after rotation the repair may also look BACKWARD (post-rotation the only alternative can sit above the pair) and rejects any move whose vacated spot would create a new violation; after promotion the same guarded repair runs only when a promotion actually happened. Settings are now runtime-validated at the engine boundary (zod: integers, bounded, NaN-rejecting — a zero cap or negative bucket previously passed silently). Evidence: the reviewer's exact example, a cap+rotation+exploration combination test, a promotion-vacate test, an all-buckets invariant sweep, and six settings-rejection assertions (24 MCI-08 tests, was 19). Benchmark re-run: **no metric moved** (p10 top-seller share 0.6112 and distinct sellers top-5 2.4444 — identical to round 1).

**Finding 5 (medium) — audit records were not durable.** Fixed: migration `004` adds `intelligence.hermes_audit`; `PostgresAuditLog` writes it and is wired by the finding-1 resolution. Append-only is enforced at the DATABASE layer for application roles (SELECT+INSERT grants only — the suite proves `UPDATE`/`DELETE` from an app role raise `InsufficientPrivilege`). Evidence: records written by one instance are read back by a fresh instance (restart semantics). The reviewer's retained design limitation stays documented where it belongs: Python cannot force-kill a timed-out handler thread (worker.py header, README "Honest limitations") — a timed-out task fails and is receipted, but its thread may linger until it finishes; material before any skill takes external actions.

**Verification (local, 2026-11-20, after this round):** TypeScript suite 183 pass / 0 fail (167 contracts+modules+gateway+eval, 13 commerce-plane client, 3 SQL-gate — fresh + repeatable WITH the two new migrations), `tsc` clean, ESLint 0 errors (1 pre-existing warning), Hermes 120 pass / 0 fail (up from 105: +5 server configuration tests, +10 PG round-2 tests), benchmark metrics unchanged. `main` untouched at `cdfb6f6…`; the round-1 branch remained this round's base.

---

## 14. Round 3 — the two remaining review findings (2026-11-20)

The second independent review confirmed the round-2 remediation was substantially improved and identified two remaining issues. Both were reproduced against the actual code, fixed, and pinned by tests. The round-3 fix commit directly follows the round-2 tip `a1f6e71`; its SHA is recorded in §10.

**Issue 1 — PostgreSQL role handling: infrastructure fallback under FORCE RLS.** Confirmed: `save()` and `get()` ran on the infrastructure connection, which falls back to the tenant application connection when `HERMES_ADMIN_DATABASE_URL` is absent — under the restricted `intelligence_app` role with enforced RLS, the synchronous lifecycle path (route save → execute → success save) hit the owner policy and failed, and unscoped reads silently returned nothing. Fixed by resolving the connection/ownership model explicitly:

- **Lifecycle saves carry the record's own owner context.** `save()` now wraps its UPDATE in a transaction with `set_config('intelligence.owner', <record.submitted_by>, is_local => true)`. On the tenant connection the RLS owner policy (WITH CHECK) admits the save; on the infrastructure connection the context is redundant (the admin policy already admits it). One code path, correct under both role shapes — the synchronous create → execute → save → read lifecycle works on a restricted tenant connection with NO admin URL wired.
- **The infrastructure capability is probed at startup, not assumed.** `PostgresTaskStore` probes whether its infrastructure connection can actually see task rows under the deployed model (superuser/BYPASSRLS, table owner with unforced RLS, or `intelligence_admin` membership) and exposes `infrastructure_capable`. Without capability it logs exactly which operations are unavailable (worker claims, retention, admin reads/requeue, cross-replica cancellation visibility) while tenant paths keep working; degraded-but-safe behaviour is proven (the admin dead-letter list returns an empty list, never an error or a leak).
- **Worker mode without the required infrastructure role fails startup.** `create_app()` resolves worker mode BEFORE storage resolution and constructs the store with `require_infrastructure_role=True` when worker mode is on — an RLS-bound role raises a RuntimeError naming the fix (`GRANT intelligence_admin TO <role>` / wire `HERMES_ADMIN_DATABASE_URL`), instead of a worker that logs "worker started" and silently claims nothing forever.

Evidence (dedicated restricted roles, production-like wiring): a full create → execute → save → read test over the real signed API with the app role and the admin role wired separately (SUCCEEDED, receipts, durable state verified by an independent raw connection); the tenant-only wiring test (no admin URL) proving the sync path survives restricted roles; the worker-mode-without-role startup failure test; the worker-mode happy-path test where the background worker really claims and completes a submitted task; and a direct probe test (`infrastructure_capable` false for app roles, true for the admin member and the bootstrap superuser).

**Issue 2 — MCI-08 initial adjacency pass could create a new violation.** Confirmed with the reviewer's regression case `A1, A2, B1, A3` (sellers A, A, B, A; `rotationBucket=0`, `explorationSlots=0`): the guard-free initial pass moved B1 to split the head pair (A1, A2), which VACATED a spot joining A2 and A3 — a new same-seller adjacency at the tail. Fixed (engine v0.2.2): the vacated-spot guard now applies to the INITIAL pass as well — a candidate whose removal would join two same-seller items is skipped, while the pass stays forward-only (top-1 stability preserved). Where no safe alternative exists the pair may remain, per the guardrail's own promise — in the regression case three A items and one separator make one adjacency mathematically unavoidable, and the final slate keeps the ORIGINAL head pair instead of creating a new tail pair. Evidence: the reviewer's exact regression test (final slate pinned to `A1, A2, B1, A3`, permutation/cap/tail integrity asserted); a safe-alternative test proving the pass still repairs when a move is safe (`A1, A2, B1, C1` → `A1, B1, A2, C1`); a skip-unsafe-take-safe test (`A1, A2, B1, A3, C1` → `A1, C1, A2, B1, A3`, zero violations); and a tail-placement + repair test reaching zero violations when separation is possible. All 28 MCI-08 tests green (24 prior + 4 new); benchmark re-run with **zero changed metrics** (p10 top-seller share 0.6112, distinct sellers top-5 2.4444 — identical to rounds 1 and 2).

**Verification (local, 2026-11-20, after this round):** TypeScript suite 187 pass / 0 fail (171 contracts+modules+gateway+eval, 13 commerce-plane client, 3 SQL-gate), `tsc` clean, ESLint 0 errors (1 pre-existing warning), Hermes 125 pass / 0 fail (up from 120: +5 restricted-role round-3 tests), benchmark metrics unchanged, disposable-PG role tests all green. `main` untouched at `cdfb6f6…`.

---

## 15. Requirements status

| Requirement | Status | Evidence |
|---|---|---|
| Replay protection | ✅ COMPLETE | Atomic `consume()`; concurrent tests admit exactly one (`gateway.test.ts` race test, `do.test.ts` 3-way concurrency); Hermes `AUTH_REPLAY` suite; cross-replica `hermes_nonces` test + durable `PostgresNonceStore` restart test |
| Gateway payload limits | ✅ COMPLETE | Streaming cap (reader stops before last chunk), misleading/missing Content-Length, emoji byte regression, malformed UTF-8, mid-stream failure tests |
| Hermes authentication | ✅ COMPLETE | `tests/test_auth.py`: unsigned → 401, forged signature → 401, stale → 401, replay → 409, malformed → 401, forged identity field rejected |
| Tenant isolation | ✅ COMPLETE | `tests/test_ownership.py`: foreign read/cancel = 404 (no existence leak), admin explicit + audited; **round 2:** RLS ENFORCED against restricted login roles — rows invisible without/wrong owner context, INSERT rejected, app role cannot drive worker/admin paths |
| Durable task storage | ✅ COMPLETE | `test_storage_postgres.py`: fresh + repeatable migrations, cross-restart lifecycle, atomic multi-worker claims (`FOR UPDATE SKIP LOCKED`), disposable PG only; **round 2:** wired into `create_app` via `HERMES_DATABASE_URL` with fail-fast validation (end-to-end API→PG test) + separate admin connection; **round 3:** restricted-role create → execute → save → read lifecycle test, tenant-only sync path proven, startup capability probe |
| Cross-replica idempotency | ✅ COMPLETE (round 2) | Atomic `INSERT ... ON CONFLICT DO NOTHING` + replay: 3 concurrent independent stores × 5 rounds — one creator, two replays, zero uniqueness errors; conflict-across-stores test |
| Task orchestration | ✅ COMPLETE | Lifecycle transitions, receipts per attempt, retry/backoff/DEAD classification, timeout (thread-kill limitation documented), cooperative cancellation, worker claim/recovery/graceful shutdown, registered Increment-1 handlers |
| Connection/ownership model | ✅ COMPLETE (round 3) | Lifecycle saves carry the record's owner context (sync path works tenant-only under FORCE RLS); infrastructure capability probed at startup and announced; worker mode without an infrastructure-capable role fails startup; worker-mode happy path claims and executes end to end |
| Module correctness | ✅ COMPLETE | MCI-01/02/03/08/27 runtime-validated; MCI-08 tail placement + rotation bucket; **round 2 (engine v0.2.1):** adjacency survives rotation and promotion; **round 3 (engine v0.2.2):** initial pass vacated-spot guard — reviewer's `A1,A2,B1,A3` regression pinned, safe alternatives still taken; benchmark metrics unchanged |
| SQL migrations | ✅ COMPLETE | Five valid repeatable migrations (incl. 004 durable audit, 005 roles+grants+FORCE RLS); fresh + repeatable verified on disposable PG; constraints + RLS asserted in both TS and Python gates |
| Audit durability | ✅ COMPLETE (round 2) | `hermes_audit` table + `PostgresAuditLog` wired with the durable stack; append-only by GRANT (app-role UPDATE/DELETE proven rejected); survives restart; memory mode announced as ephemeral on `/version` |
| CI and tests | ✅ COMPLETE (runs pending PR) | Workflow has install step, SQL gate, disposable-PG python job; suites: 187 bun + 125 pytest green locally; CI run links follow PR creation |
| Documentation | ✅ COMPLETE | gateway/hermes/jobs READMEs match code (role model, storage modes, wiring); this report; honest limitations + hosting-provisioning list |

**Verdict:** all thirteen requirement areas are implemented and locally verified; the two external dependencies for *declared* completion are (1) the CI run on the pushed branch (needs the PR) and (2) hosting provisioning — both owner-side actions, listed above and not claimed as done.
