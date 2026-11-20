"""Hermes control-plane HTTP API (FastAPI, remediated).

Authentication & identity (the increment-1 remediation core):
- EVERY /v1 endpoint requires HMAC service authentication (hermes/auth.py).
- Caller identity comes ONLY from the verified signature — there is no
  client-supplied identity anywhere. `submitted_by` is rejected.
- Task reads, updates, cancellation and listing are scoped to the verified
  owner; cross-owner access returns 404 (no existence leak). Administrative
  operations are a separate, explicit capability (`admin: true` in the
  registry) and audited.

Endpoints:
- GET  /healthz                        — liveness, no data, no auth
- GET  /readyz                         — storage readiness, no auth
- GET  /version                        — service version + registered skills
- POST /v1/tasks                       — submit (auth) → idempotent create
- GET  /v1/tasks/{id}                  — owner-or-admin read (auth)
- GET  /v1/tasks                       — own tasks (auth); admin: ?all=true
- POST /v1/tasks/{id}/cancel           — owner-or-admin cancellation (auth)
- GET  /v1/admin/dead-letters          — admin dead-letter list
- POST /v1/admin/tasks/{id}/requeue    — admin requeue of FAILED/DEAD tasks

Errors use the stable envelope in hermes/errors.py; internal details never
reach a response. Structured JSON logs carry metadata only.

DEPLOYMENT HONESTY: this server is the shape of the always-on control plane.
Storage: with HERMES_DATABASE_URL the app runs the durable stack (Postgres
task store + nonce store + append-only audit log, migrations 002–005);
without it Hermes still starts, but with EPHEMERAL memory state (announced
on /version). Continuous availability (supervision, restart recovery under
real hosting, alerting) still requires owner provisioning and testing — see
README.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ValidationError

from . import __version__
from .auth import CallerPrincipal, InMemoryNonceStore, NonceStore, parse_caller_registry, verify_service_auth
from .backends import ScriptedBackend
from .budget import AuditSink, InMemoryAuditLog
from .contracts import TaskRecord, TaskStatus, TaskSubmission, TERMINAL_STATUSES
from .errors import HermesError, error_response, install_error_handlers
from .handlers import register_increment_one_skills
from .logging_setup import configure_logging
from .postgres_store import PostgresAuditLog, PostgresNonceStore, PostgresTaskStore
from .router import TaskRouter
from .skills import SkillRegistry
from .storage import IdempotencyConflict, MemoryTaskStore, TaskStore, canonical_payload
from .validation import validate_task_id, validate_trace_id
from .worker import HermesWorker

DEFAULT_SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"
MAX_BODY_BYTES = 32 * 1024
DEFAULT_MAX_ATTEMPTS = 3


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} must be a number, got {raw!r}") from error
    if value <= 0:
        raise RuntimeError(f"{name} must be positive, got {raw!r}")
    return value


def resolve_storage_from_env(*, worker_mode: bool = False) -> tuple[TaskStore, NonceStore, AuditSink, str]:
    """Resolve the storage stack from the environment (round-2 remediation,
    reviewer finding 1; round-3 hardening).

    - HERMES_DATABASE_URL set → the DURABLE stack: PostgresTaskStore,
      PostgresNonceStore and PostgresAuditLog. Configuration is validated
      EXPLICITLY: a malformed URL or an unreachable database FAILS STARTUP
      (never a silent degradation into memory state). The optional
      HERMES_ADMIN_DATABASE_URL wires the infrastructure role (worker claims,
      retention, admin reads) separately from the tenant app role — migration
      005 documents the role model. With worker_mode=True the infrastructure
      connection must be capability-probed (RLS-bound role without the admin
      boundary ⇒ startup fails instead of a silently idle worker).
    - Not set → Hermes STILL STARTS with in-process memory stores. That is a
      deliberate availability decision (the commerce plane must keep working
      with or without the intelligence infrastructure), but it is announced
      loudly and surfaced on /version: tasks, nonces and audit records are
      EPHEMERAL and lost on restart.
    """
    log = logging.getLogger("hermes.server")
    url = os.environ.get("HERMES_DATABASE_URL")
    if not url:
        log.warning(
            "HERMES_DATABASE_URL is not set — running with EPHEMERAL in-process "
            "storage: tasks, nonces and audit records are lost on restart. Set "
            "HERMES_DATABASE_URL to enable the durable stack."
        )
        return MemoryTaskStore(), InMemoryNonceStore(), InMemoryAuditLog(), "memory-ephemeral"
    for name, value in (("HERMES_DATABASE_URL", url), ("HERMES_ADMIN_DATABASE_URL", os.environ.get("HERMES_ADMIN_DATABASE_URL"))):
        if value is not None and not (value.startswith("postgres://") or value.startswith("postgresql://")):
            raise RuntimeError(f"{name} must be a postgres:// or postgresql:// connection URL")
    try:
        store = PostgresTaskStore(
            url,
            admin_conninfo=os.environ.get("HERMES_ADMIN_DATABASE_URL"),
            require_infrastructure_role=worker_mode,
            lease_seconds=_env_float("HERMES_LEASE_SECONDS", 300.0),
        )
        nonces = PostgresNonceStore(url)
        audit_log = PostgresAuditLog(url)
    except RuntimeError:
        # Configuration errors (capability probe, migration verification)
        # already carry safe, actionable wording — surface them unwrapped.
        raise
    except Exception as error:  # noqa: BLE001 — fail fast, leak nothing
        raise RuntimeError(
            f"failed to initialise the durable Hermes storage stack: {type(error).__name__} "
            "(check the database URL, role grants and that migrations are applied — "
            "see intelligence/jobs/README.md)"
        ) from error
    return store, nonces, audit_log, "postgres"


class TaskResponse(BaseModel):
    task_id: str
    status: str
    refusal_reason: Optional[str] = None
    trace_id: Optional[str] = None


def create_app(
    skills_dir: Optional[Path] = None,
    store: Optional[TaskStore] = None,
    callers: Optional[dict] = None,
    nonces: Optional[NonceStore] = None,
    run_worker: Optional[bool] = None,
    register_default_skills: bool = True,
    audit=None,
) -> FastAPI:
    """Build the control-plane app. Tests inject stores/callers/registries;
    production resolves the caller registry from the HERMES_CALLERS secret."""
    app = FastAPI(title="Mudaala Hermes Control Plane", version=__version__, docs_url=None, redoc_url=None)
    install_error_handlers(app)

    resolved_skills = skills_dir or DEFAULT_SKILLS_DIR
    registry = SkillRegistry(resolved_skills)
    backend = ScriptedBackend()
    if register_default_skills:
        # Reviewed deployment code registers the Increment-1 skills; the
        # fail-closed default (register_default_skills=False) exists for
        # tests and for operators who want an empty registry.
        register_increment_one_skills(backend)
    # Worker mode is resolved BEFORE storage so the durable stack can be
    # required to be infrastructure-capable at startup (round-3 remediation):
    # a worker on an RLS-bound role without the admin boundary would start,
    # log "worker started" and then silently claim nothing forever.
    worker_requested = bool(os.environ.get("HERMES_WORKER_MODE") == "1") if run_worker is None else run_worker
    if store is not None:
        # Explicit injection (tests, custom wiring) wins over the environment.
        audit_log = audit if audit is not None else InMemoryAuditLog()
        resolved_store = store
        resolved_nonces = nonces if nonces is not None else InMemoryNonceStore()
        storage_mode = "injected"
    else:
        resolved_store, env_nonces, env_audit, storage_mode = resolve_storage_from_env(worker_mode=worker_requested)
        audit_log = audit if audit is not None else env_audit
        resolved_nonces = nonces if nonces is not None else env_nonces
    resolved_callers = callers if callers is not None else parse_caller_registry(os.environ.get("HERMES_CALLERS"))

    router = TaskRouter(registry, backend, audit_log, store=resolved_store)
    # Multi-instance deployments MUST give each instance its own worker id
    # (HERMES_WORKER_ID): lease renewal is CAS on (task, worker_id), so two
    # instances sharing an id could renew each other's claims.
    worker_id = os.environ.get("HERMES_WORKER_ID") or "hermes-worker-0"
    worker = HermesWorker(resolved_store, router, worker_id=worker_id)

    app.state.registry = registry
    app.state.backend = backend
    app.state.audit = audit_log
    app.state.router = router
    app.state.store = resolved_store
    app.state.worker = worker
    app.state.nonces = resolved_nonces
    app.state.callers = resolved_callers
    app.state.storage_mode = storage_mode
    app.state.run_worker = worker_requested
    # False ⇒ the infrastructure connection is RLS-bound without the admin
    # boundary: worker claims, retention, admin reads/requeue and
    # cross-replica cancellation visibility are unavailable (the store logs
    # the details at startup; tenant request paths still work).
    app.state.infrastructure_capable = getattr(resolved_store, "infrastructure_capable", True)

    # -- auth ---------------------------------------------------------------

    async def read_body_capped(request: Request) -> bytes:
        """Read the body under the size cap, caching it on the request so
        later reads (auth + JSON parse) never consume the stream twice."""
        if hasattr(request, "_body"):
            return request._body
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_BODY_BYTES:
                raise HermesError("PAYLOAD_TOO_LARGE", f"payload exceeds {MAX_BODY_BYTES} bytes")
        request._body = bytes(body)
        return request._body

    def principal_from_request(request: Request, body: bytes) -> CallerPrincipal:
        trace_id_raw = request.headers.get("x-hermes-trace-id", "")
        if trace_id_raw:
            validate_trace_id(trace_id_raw)
        principal, failure = verify_service_auth(
            method=request.method,
            path=request.url.path,
            body=body,
            headers={k.lower(): v for k, v in request.headers.items()},
            callers=app.state.callers,
            nonces=app.state.nonces,
        )
        if failure is not None or principal is None:
            message = {
                "AUTH_MISSING": "missing or malformed auth headers",
                "AUTH_BAD_SIGNATURE": "signature verification failed",
                "AUTH_CLOCK_SKEW": "timestamp outside the ±90s window",
                "AUTH_REPLAY": "nonce already used",
            }.get(failure or "", "authentication failed")
            raise HermesError(failure or "AUTH_MISSING", message)
        return principal

    async def require_principal(request: Request) -> CallerPrincipal:
        body = await read_body_capped(request)
        return principal_from_request(request, body)

    def trace_id_for(request: Request) -> str:
        raw = request.headers.get("x-hermes-trace-id", "")
        return raw[:128] if raw else f"hr-{uuid.uuid4().hex[:12]}"

    # -- open endpoints ------------------------------------------------------

    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True, "service": "mudaala-hermes", "version": __version__}

    @app.get("/readyz")
    def readyz() -> dict:
        ready = bool(app.state.store.ping())
        return {"ok": ready, "service": "mudaala-hermes", "version": __version__}

    @app.get("/version")
    def version() -> dict:
        return {
            "service": "mudaala-hermes",
            "version": __version__,
            "skills": registry.ids(),
            "backend": backend.name,
            "registered_task_types": backend.registered_types(),
            "worker_running": worker.is_running(),
            "storage": app.state.storage_mode,
        }

    # -- authenticated task API ----------------------------------------------

    @app.post("/v1/tasks", response_model=TaskResponse)
    async def submit_task(request: Request) -> TaskResponse:
        principal = await require_principal(request)
        body = await request.body()
        import json as _json

        try:
            raw = _json.loads(body) if body else {}
        except _json.JSONDecodeError:
            raise HermesError("PAYLOAD_INVALID", "body is not valid JSON")
        if not isinstance(raw, dict):
            raise HermesError("PAYLOAD_INVALID", "body must be a JSON object")
        # Identity is derived from verified auth — a client-supplied identity
        # field is rejected outright (strict schema would also forbid it).
        if "submitted_by" in raw:
            raise HermesError("PAYLOAD_INVALID", "submitted_by is derived from verified authentication and is not accepted")
        try:
            submission = TaskSubmission.model_validate(raw)
        except ValidationError:
            # Generic message: schema details are never echoed to the caller.
            raise HermesError("PAYLOAD_INVALID", "request failed schema validation")
        record = TaskRecord.from_submission(submission, owner=principal.caller_id, trace_id=trace_id_for(request))
        record.max_attempts = DEFAULT_MAX_ATTEMPTS
        canonical = canonical_payload(submission.payload)
        try:
            created, replay = app.state.store.create(record, canonical)
        except IdempotencyConflict:
            raise HermesError("IDEMPOTENCY_CONFLICT", "idempotency key already used with a different payload")
        if replay:
            return TaskResponse(
                task_id=created.task_id,
                status=created.status.value,
                refusal_reason=created.refusal_reason,
                trace_id=created.trace_id,
            )
        routed = router.route(created)
        if not app.state.run_worker and routed.status is TaskStatus.QUEUED:
            # Synchronous execution path (single-process deployments/tests):
            # the full lifecycle completes within the request.
            routed = router.execute(routed)
        return TaskResponse(
            task_id=routed.task_id,
            status=routed.status.value,
            refusal_reason=routed.refusal_reason,
            trace_id=routed.trace_id,
        )

    @app.get("/v1/tasks/{task_id}", response_model=TaskRecord)
    async def read_task(task_id: str, request: Request) -> TaskRecord:
        principal = await require_principal(request)
        validate_task_id(task_id)
        record = app.state.store.get_scoped(task_id, principal)
        if record is None:
            raise HermesError("TASK_NOT_FOUND", "unknown task")
        return record

    @app.get("/v1/tasks", response_model=list[TaskRecord])
    async def list_tasks(request: Request, limit: int = 50, all: bool = False) -> list[TaskRecord]:
        principal = await require_principal(request)
        if all and not principal.is_admin:
            raise HermesError("SCOPE_DENIED", "administrator capability required for all-tenant listing")
        limit_bounded = max(1, min(int(limit), 100))
        if all:
            # Admin cross-tenant listing is explicit, authorised and audited.
            app.state.audit.record({"event": "admin_list_tasks", "actor": principal.caller_id})
            list_all = getattr(app.state.store, "list_all", None)
            if list_all is None:
                raise HermesError("SCOPE_DENIED", "store does not support cross-tenant listing")
            return list(list_all(limit_bounded))
        return app.state.store.list_for_owner(principal.caller_id, limit=limit_bounded)

    @app.post("/v1/tasks/{task_id}/cancel", response_model=TaskResponse)
    async def cancel_task(task_id: str, request: Request) -> TaskResponse:
        principal = await require_principal(request)
        validate_task_id(task_id)
        record = app.state.store.request_cancel(task_id, principal)
        if record is None:
            # Either unknown, foreign (no existence leak), or terminal.
            existing = app.state.store.get_scoped(task_id, principal)
            if existing is not None and existing.status in TERMINAL_STATUSES:
                raise HermesError("TASK_CONFLICT", "task already reached a terminal state")
            raise HermesError("TASK_NOT_FOUND", "unknown task")
        return TaskResponse(task_id=record.task_id, status=record.status.value, refusal_reason=record.refusal_reason, trace_id=record.trace_id)

    # -- administrative API (separate capability, audited) --------------------

    @app.get("/v1/admin/dead-letters", response_model=list[TaskRecord])
    async def dead_letters(request: Request, limit: int = 50) -> list[TaskRecord]:
        principal = await require_principal(request)
        from .validation import require_admin

        require_admin(principal)
        app.state.audit.record({"event": "admin_list_dead_letters", "actor": principal.caller_id})
        return app.state.store.list_dead(limit=max(1, min(int(limit), 100)))

    @app.post("/v1/admin/tasks/{task_id}/requeue", response_model=TaskResponse)
    async def requeue_task(task_id: str, request: Request) -> TaskResponse:
        principal = await require_principal(request)
        from .validation import require_admin

        require_admin(principal)
        validate_task_id(task_id)
        record = app.state.store.get(task_id)
        if record is None:
            raise HermesError("TASK_NOT_FOUND", "unknown task")
        if record.status not in (TaskStatus.FAILED, TaskStatus.DEAD):
            raise HermesError("TASK_CONFLICT", "only FAILED or DEAD tasks can be requeued")
        if record.attempts >= record.max_attempts:
            raise HermesError("TASK_CONFLICT", "attempts exhausted; raise max_attempts via a new submission")
        record.transition(TaskStatus.QUEUED)
        record.refusal_reason = None
        record.next_attempt_at = None
        app.state.store.save(record)
        app.state.audit.record({"event": "admin_requeue_task", "actor": principal.caller_id, "task_id": task_id})
        return TaskResponse(task_id=record.task_id, status=record.status.value, trace_id=record.trace_id)

    # -- lifecycle: worker + graceful shutdown --------------------------------

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        configure_logging()
        if app.state.run_worker:
            app.state.worker.start()
        try:
            yield
        finally:
            # Graceful shutdown: stop accepting new claims, finish in-flight.
            app.state.worker.stop(timeout=10)

    app.router.lifespan_context = lifespan

    # 422s from strict schemas render in the stable envelope, without echo.
    from fastapi.responses import JSONResponse

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:  # noqa: ANN202
        trace_id = trace_id_for(request)
        return error_response("PAYLOAD_INVALID", "request failed schema validation", trace_id)

    return app


app = create_app()
