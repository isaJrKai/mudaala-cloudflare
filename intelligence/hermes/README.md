# Mudaala Hermes — orchestration core (v0)

**Status:** Governance core implemented + tested (23 pytest cases). Control-plane HTTP skeleton implemented + tested. **Not deployed, not continuously available, no model backend wired.** Deployment requires the owner's Modal (or other host) provisioning and approval — see `docs/intelligence/DEPLOYMENT_AND_ROLLBACK.md`.

## What Hermes is here (and is not)

Hermes is the intelligence plane's orchestration layer (master plan §5.1.D): it routes bounded tasks to governed skills, enforces budgets, writes an audit trail, and produces **recommendations only** — it never mutates commerce records, sends notifications, issues verifications, or spends money.

What v0 provides:

- **Skill governance** (`hermes/skills.py`): skills live in Git (`skills/msk-*/manifest.json` + `SKILL.md`), must declare allowed tools AND forbidden actions (fail-closed), and only `active` skills are routable.
- **Budget enforcement** (`hermes/budget.py`): steps/tool-calls/time caps per task; exhaustion REFUSES the task with a reason instead of silently truncating. Model-token spend is contract-locked at 0 — no LLM backend is wired, so silent spend is impossible.
- **Backend seam** (`hermes/backends.py`): `AgentBackend` protocol. The shipped `ScriptedBackend` runs deterministic registered handlers; the production default is an **empty registry (fail-closed)** — executable task types arrive only through reviewed deployment code. The NousResearch hermes-agent integration is deliberately NOT implemented or claimed; it lands as another backend when a release is pinned and reviewed (WS-5).
- **Router** (`hermes/router.py`): the governance sequence — skill status → task-type declaration → backend handler → budget → audit. Refusal is normal, audited behaviour.
- **Audit** (`hermes/budget.py`): append-only JSONL; entries carry task/skill/actor/outcome metadata, never payload contents.
- **Control plane** (`hermes/server.py`): FastAPI skeleton (`/healthz`, `/version`, `POST /v1/tasks`, `GET /v1/tasks/{id}`) with an in-memory staging store and idempotent submission.

## First two skills (of the 15 planned in the catalogue)

| Skill | Task types | Tools allowed | Purpose |
|---|---|---|---|
| MSK-001 Product & Policy Orientation | `ORIENT_PRODUCT_FACTS` | `read_mudaala_docs` | Grounded answers from approved docs; unknowns stay unknown |
| MSK-006 Search Relevance Evaluator | `RUN_SEARCH_RELEVANCE_EVAL` | `bun_run_eval` (one fixed command) | Run the offline benchmark, report metrics verbatim, no editorialising |

## Running

```bash
pip install -r intelligence/hermes/requirements.txt -r dev-requirements.txt   # + pytest
python -m pytest intelligence/hermes/tests/                                  # 23 tests
uvicorn hermes.server:app --port 8100                                        # local skeleton (staging only)
```

## Honest limitations

- The control plane is a process skeleton: continuous availability (supervision, restart recovery, persistent state, alerting) is unproven and is exactly what WS-3/WS-5 must demonstrate before any "always-on Hermes" claim.
- The in-memory task store is staging-only; durable jobs wait for the approved store (ADR-0004).
- No LLM calls, no token spend, no tool execution beyond the two allowlisted handlers' design — and no handlers registered by default.
- Sub-agent/delegation (master plan §7.4) is a future `AgentBackend`/task-type extension with scoped, expiring capabilities; nothing here expands its own permissions.
