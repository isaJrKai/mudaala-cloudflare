# Mudaala Hermes — orchestration core (v0)

**Status:** Remediated control plane + durable task storage implemented and tested (105 pytest cases, including a disposable-PostgreSQL durability suite). **Not deployed, not continuously available, no model backend wired.** Deployment requires the owner's Modal (or other host) provisioning and approval — see `docs/intelligence/DEPLOYMENT_AND_ROLLBACK.md`.

## What Hermes is here (and is not)

Hermes is the intelligence plane's orchestration layer (master plan §5.1.D): it routes bounded tasks to governed skills, enforces budgets, writes an audit trail, and produces **recommendations only** — it never mutates commerce records, sends notifications, issues verifications, or spends money.

What v0 provides:

- **Skill governance** (`hermes/skills.py`): skills live in Git (`skills/msk-*/manifest.json` + `SKILL.md`), must declare allowed tools AND forbidden actions (fail-closed), and only `active` skills are routable.
- **Budget enforcement** (`hermes/budget.py`): steps/tool-calls/time caps per task; exhaustion REFUSES the task with a reason instead of silently truncating. Model-token spend is contract-locked at 0 — no LLM backend is wired, so silent spend is impossible.
- **Backend seam** (`hermes/backends.py`): `AgentBackend` protocol. The shipped `ScriptedBackend` runs deterministic registered handlers; the production default is an **empty registry (fail-closed)** — executable task types arrive only through reviewed deployment code. The NousResearch hermes-agent integration is deliberately NOT implemented or claimed; it lands as another backend when a release is pinned and reviewed (WS-5).
- **Router** (`hermes/router.py`): the governance sequence — skill status → task-type declaration → backend handler → budget → audit. Refusal is normal, audited behaviour.
- **Audit** (`hermes/budget.py`): append-only JSONL; entries carry task/skill/actor/outcome metadata, never payload contents.
- **Service authentication** (`hermes/auth.py`): HMAC service-to-service auth mirroring the gateway scheme; caller identity is derived ONLY from the verified signature (client-supplied `submitted_by` is rejected), nonces are replay-protected and caller-scoped, headers are format-checked and never echoed.
- **Task ownership (tenant boundary)**: every task record carries its verified owner; reads, updates, cancellation and listing are owner-scoped, cross-owner access is a 404 indistinguishable from a missing task, and administrative operations are a separate explicit capability (`admin: true`), audited.
- **Runtime validation** (`hermes/validation.py`): payload bounds (≤16 KiB UTF-8 bytes, depth ≤6, ≤200 values, strings ≤2000 chars), strict task/trace id validation — no reliance on type annotations.
- **Task lifecycle** (`hermes/contracts.py`): SUBMITTED → VALIDATED → QUEUED → RUNNING → SUCCEEDED/FAILED/CANCELLED (+ REFUSED governance outcome, DEAD dead-letter), legal-transition table, execution receipts per attempt, failure classification (TRANSIENT retries with bounded backoff; PERMANENT dead-letters), cooperative cancellation, structured trace ids.
- **Durable storage** (`hermes/postgres_store.py` + `../jobs/migrations/`): PostgreSQL store with atomic multi-worker claims (FOR UPDATE SKIP LOCKED), cross-replica idempotency (UNIQUE constraint) and nonce consumption, stale-RUNNING recovery and retention sweeps — plus the thread-safe MemoryTaskStore for tests/local dev. Tests run against DISPOSABLE databases only (embedded-postgres / CI service containers).
- **Worker** (`hermes/worker.py`): claim/execute loop with recovery sweeps and graceful shutdown; the API can run tasks synchronously (default) or queue them for workers (`HERMES_WORKER_MODE=1`).
- **Registered skills** (`hermes/handlers.py`): the two Increment-1 skills have real deterministic handlers — ORIENT_PRODUCT_FACTS grounds answers only in caller-supplied approved doc excerpts (nothing invented); RUN_SEARCH_RELEVANCE_EVAL runs the one fixed benchmark command and reports metrics verbatim. The provider seam ships `NotConfiguredProvider`, which refuses everything rather than pretending to be a model.

## First two skills (of the 15 planned in the catalogue)

| Skill | Task types | Tools allowed | Purpose |
|---|---|---|---|
| MSK-001 Product & Policy Orientation | `ORIENT_PRODUCT_FACTS` | `read_mudaala_docs` | Grounded answers from approved docs; unknowns stay unknown |
| MSK-006 Search Relevance Evaluator | `RUN_SEARCH_RELEVANCE_EVAL` | `bun_run_eval` (one fixed command) | Run the offline benchmark, report metrics verbatim, no editorialising |

## Running

```bash
pip install -r intelligence/hermes/requirements.txt -r intelligence/hermes/dev-requirements.txt   # pinned versions
python -m pytest intelligence/hermes/tests/             # 105 tests (PG suite uses the embedded disposable DB)
HERMES_TEST_DATABASE_URL=postgres://... python -m pytest intelligence/hermes/tests/test_storage_postgres.py
uvicorn hermes.server:app --port 8100                   # local; set HERMES_CALLERS to authenticate
```

Service auth: sign requests exactly like the gateway client — canonical
`callerId \n secretId \n METHOD \n /path \n timestampSeconds \n sha256Hex(body)`
under the `x-hermes-*` header family. The caller registry is the
`HERMES_CALLERS` secret (JSON map: callerId → `{secret_id, secret, admin,
enabled}`); secrets are provisioned by the operator, never committed.

## Honest limitations

- Continuous availability (supervision, restart recovery under real hosting, alerting) is still unproven and is exactly what WS-3/WS-5 must demonstrate before any "always-on Hermes" claim. What IS proven by tests: task state survives store restarts (durable Postgres suite), stale-RUNNING recovery requeues after a simulated worker crash, and graceful shutdown finishes in-flight tasks.
- Timeout handling runs handlers in worker threads; Python cannot force-kill a thread, so a handler that ignores its budget keeps its thread busy until it finishes or the process recycles it — the TASK fails on time regardless (receipt records TIMEOUT).
- Query strings are intentionally outside the HMAC canonical string (path-only, mirroring the gateway ADR-0002); do not make authorisation decisions on query parameters alone.
- No LLM calls, no token spend, and no tool execution beyond the two allowlisted handlers; the model-provider seam refuses everything until a provider is reviewed.
- RLS on `intelligence.hermes_tasks` is defense in depth; it binds when the app connects as the scoped app role (owner policies use `current_setting('intelligence.owner')`). Connecting as superuser/table-owner bypasses RLS BY DESIGN — deployments must use the app role.
