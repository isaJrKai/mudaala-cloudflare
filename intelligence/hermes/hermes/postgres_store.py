"""Durable Hermes task store — PostgreSQL (approved `intelligence` schema).

Implements the TaskStore protocol (see storage.py) against the tables created
by intelligence/jobs/migrations/. Guarantees:

- Atomic claiming: UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED),
  so replicas cannot double-claim a QUEUED task.
- Idempotent create per (owner, idempotency_key) that is atomic ACROSS
  connections: a single INSERT ... ON CONFLICT DO NOTHING decides under the
  database's UNIQUE(submitted_by, idempotency_key) constraint — a racing
  replica re-reads the winner and replays it instead of erroring (round-2
  remediation, reviewer finding 3).
- Tenant isolation in depth: store queries are owner-scoped, AND the store
  sets `set_config('intelligence.owner', <owner>, is_local => true)` per
  transaction so the migration-003/005 row-level-security policies enforce
  the same boundary at the database layer (round-2 remediation, finding 2).
- Two connection roles: the tenant connection (subject to RLS, app role) and
  an optional infrastructure/admin connection (worker claims, retention,
  cross-tenant admin reads — a role holding intelligence_admin membership).
  Without admin_conninfo both are the same connection (dev/tests as owner or
  superuser, where RLS is bypassed by design).
- Lifecycle saves carry the record's own owner context (round-3 remediation),
  so the synchronous request path works on a restricted tenant connection
  without any admin URL; a startup capability probe verifies the
  infrastructure connection can actually drive worker/admin operations and
  either fails startup (require_infrastructure_role=True, e.g. worker mode)
  or announces exactly what is unavailable.
- Replay protection for service auth across replicas: hermes_nonces consumes
  nonces atomically (INSERT ... ON CONFLICT DO NOTHING) with TTL cleanup.
- Recovery: stale RUNNING tasks requeue; retention sweeps finished tasks.
- Durable audit trail: PostgresAuditLog writes to intelligence.hermes_audit
  (append-only by grant, migration 004/005) — round-2 remediation, finding 5.

DEPLOYMENT NOTE: credentials come from the environment (HERMES_DATABASE_URL
or an explicit conninfo passed by the operator). Tests use DISPOSABLE
databases only (embedded-postgres / CI service containers) — never production.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from contextlib import contextmanager
from typing import Any, Optional

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError as error:  # pragma: no cover — dependency declared in requirements
    raise ImportError("PostgresTaskStore requires psycopg>=3.2 (pip install 'psycopg[binary]')") from error

from .contracts import TaskRecord, TaskStatus, TaskResult, ExecutionReceipt, FailureClass
from .storage import IdempotencyConflict, canonical_payload
from .validation import TASK_PAYLOAD_MAX_BYTES
from .errors import HermesError

logger = logging.getLogger("hermes.postgres_store")

COLUMNS = (
    "task_id, schema_version, task_type, skill_id, purpose, submitted_by, status, budget, "
    "idempotency_key, payload, payload_canonical, attempts, max_attempts, steps_used, "
    "tool_calls_used, created_at, started_at, finished_at, next_attempt_at, trace_id, "
    "worker_id, result, refusal_reason, error_class, failure_class, cancel_requested, receipts"
)

REQUIRED_OBJECTS = (
    "intelligence.hermes_tasks",
    "intelligence.hermes_nonces",
    "intelligence.hermes_audit",
)


def _record_to_row(record: TaskRecord) -> dict:
    return {
        "task_id": record.task_id,
        "schema_version": record.schema_version,
        "task_type": record.task_type,
        "skill_id": record.skill_id,
        "purpose": record.purpose,
        "submitted_by": record.submitted_by,
        "status": record.status.value,
        "budget": record.budget.model_dump_json(),
        "idempotency_key": record.idempotency_key,
        "payload": json.dumps(record.payload, ensure_ascii=False, default=str),
        "payload_canonical": record.payload_canonical if hasattr(record, "payload_canonical") else "",
        "attempts": record.attempts,
        "max_attempts": record.max_attempts,
        "steps_used": record.steps_used,
        "tool_calls_used": record.tool_calls_used,
        "created_at": record.created_at,
        "started_at": record.started_at,
        "finished_at": record.finished_at,
        "next_attempt_at": record.next_attempt_at,
        "trace_id": record.trace_id,
        "worker_id": record.worker_id,
        "result": record.result.model_dump_json() if record.result else None,
        "refusal_reason": record.refusal_reason,
        "error_class": record.error_class,
        "failure_class": record.failure_class.value if record.failure_class else None,
        "cancel_requested": record.cancel_requested,
        "receipts": json.dumps([r.model_dump(mode="json") for r in record.receipts], ensure_ascii=False),
    }


def _row_to_record(row: dict) -> TaskRecord:
    payload = row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"] or "{}")
    budget = row["budget"] if isinstance(row["budget"], dict) else json.loads(row["budget"] or "{}")
    result = None
    if row["result"]:
        result = row["result"] if isinstance(row["result"], dict) else json.loads(row["result"])
    receipts_raw = row["receipts"] if isinstance(row["receipts"], list) else json.loads(row["receipts"] or "[]")
    return TaskRecord(
        task_id=row["task_id"],
        schema_version=row["schema_version"],
        task_type=row["task_type"],
        skill_id=row["skill_id"],
        purpose=row["purpose"],
        submitted_by=row["submitted_by"],
        status=TaskStatus(row["status"]),
        budget=budget,
        idempotency_key=row["idempotency_key"],
        payload=payload,
        attempts=row["attempts"],
        max_attempts=row["max_attempts"],
        steps_used=row["steps_used"],
        tool_calls_used=row["tool_calls_used"],
        created_at=row["created_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        next_attempt_at=row["next_attempt_at"],
        trace_id=row["trace_id"] or "",
        worker_id=row["worker_id"],
        result=TaskResult(**result) if result else None,
        refusal_reason=row["refusal_reason"],
        error_class=row["error_class"],
        failure_class=FailureClass(row["failure_class"]) if row["failure_class"] else None,
        cancel_requested=row["cancel_requested"],
        receipts=[ExecutionReceipt(**r) for r in receipts_raw],
    )


class PostgresTaskStore:
    """Durable TaskStore. One psycopg connection per role, each guarded by a
    lock (the v0 control plane is a single process; replicas each own their
    connections)."""

    def __init__(
        self,
        conninfo: str,
        *,
        admin_conninfo: Optional[str] = None,
        apply_migrations: bool = True,
        require_infrastructure_role: bool = False,
        lease_seconds: float = 300.0,
        retention_seconds: float = 24 * 3600.0,
    ):
        self._conn = psycopg.connect(conninfo, row_factory=dict_row)
        self._conn.autocommit = True
        self._admin_conn: Optional[psycopg.Connection] = None
        if admin_conninfo is not None and admin_conninfo != conninfo:
            self._admin_conn = psycopg.connect(admin_conninfo, row_factory=dict_row)
            self._admin_conn.autocommit = True
        self._lock = threading.RLock()
        # Execution lease (round-4 remediation): how long a claim may run
        # before recovery considers its worker dead. Renewed by the worker's
        # heartbeat during execution; claims set it atomically.
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        self._lease_seconds = float(lease_seconds)
        self._retention_seconds = float(retention_seconds)
        if apply_migrations:
            self.apply_migrations()
        # Probe the INFRASTRUCTURE connection's real capability under the
        # deployed RLS model (round-3 remediation): lifecycle operations
        # (claims, unscoped reads, retention) are structurally impossible for
        # an RLS-bound role without the admin boundary — better to know at
        # startup than to watch a worker silently claim nothing.
        self._infra_capable = self._probe_infrastructure_role()
        if require_infrastructure_role and not self._infra_capable:
            target = "HERMES_ADMIN_DATABASE_URL" if self._admin_conn is not None else "the main connection"
            raise RuntimeError(
                "worker/admin mode requires an infrastructure-capable database role, but "
                f"{target} is RLS-bound: it is neither a superuser/BYPASSRLS role, the "
                "table owner with unforced RLS, nor a member of intelligence_admin. "
                "Fix: wire HERMES_ADMIN_DATABASE_URL with a role granted "
                "'GRANT intelligence_admin TO <role>;' (see intelligence/jobs/README.md) "
                "or disable worker mode."
            )
        if not self._infra_capable:
            logger.warning(
                "postgres store: the infrastructure connection is RLS-bound WITHOUT the "
                "admin boundary — worker claims, retention sweeps, admin reads/requeue and "
                "cross-replica cancellation visibility are UNAVAILABLE on this connection. "
                "Tenant request paths (create/read/list/cancel) still work. Wire "
                "HERMES_ADMIN_DATABASE_URL with an intelligence_admin member to enable them."
            )

    def _probe_infrastructure_role(self) -> bool:
        """True when the infrastructure connection can actually see task rows
        under the deployed RLS model: superuser or BYPASSRLS, the table owner
        with unforced RLS, or a member of intelligence_admin. A missing table
        (migrations not yet applied) counts as capable — nothing is enforced
        yet."""
        row = self._infra.execute(
            "SELECT "
            "coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) "
            "OR NOT coalesce("
            "  (SELECT relforcerowsecurity FROM pg_class "
            "   WHERE oid = 'intelligence.hermes_tasks'::regclass),"
            "  false) "
            "OR coalesce("
            "  (SELECT pg_has_role(current_user, 'intelligence_admin', 'member') "
            "   WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intelligence_admin')),"
            "  false) AS capable"
        ).fetchone()
        return bool(row["capable"])

    @property
    def infrastructure_capable(self) -> bool:
        """Whether the infrastructure connection can drive the lifecycle
        operations (worker claims, retention, admin reads) under RLS —
        probed once at construction, after migrations."""
        return self._infra_capable

    # -- connections ---------------------------------------------------------

    @property
    def _infra(self) -> psycopg.Connection:
        """Infrastructure connection: worker claims, lifecycle saves, recovery,
        retention, cross-tenant admin reads, migrations. Its role holds (or
        bypasses — dev owner/superuser) the admin boundary. Defaults to the
        main connection when no separate admin URL is wired."""
        return self._admin_conn if self._admin_conn is not None else self._conn

    @contextmanager
    def _tenant_tx(self, owner: str):
        """Tenant transaction: lock + explicit transaction with the RLS owner
        context set transaction-locally. The owner policy
        (`submitted_by = current_setting('intelligence.owner', true)`) and the
        WITH CHECK on writes hold for every statement inside."""
        with self._lock, self._conn.transaction():
            self._conn.execute("SELECT set_config('intelligence.owner', %s, true)", (owner,))
            yield

    # -- migrations ----------------------------------------------------------

    def apply_migrations(self) -> None:
        """Apply intelligence/jobs/migrations/*.sql in order, tracked in
        intelligence.migrations. Idempotent: already-applied files are skipped.

        When the connected role has no DDL rights (the production app role),
        this verifies the required objects exist (an operator applied the
        migrations — see intelligence/jobs/README.md) and continues; if they
        are missing it fails LOUDLY rather than starting half-configured."""
        from pathlib import Path

        migrations_dir = Path(__file__).resolve().parents[2] / "jobs" / "migrations"
        conn = self._infra
        try:
            with self._lock, conn.transaction():
                conn.execute("CREATE SCHEMA IF NOT EXISTS intelligence")
                conn.execute(
                    "CREATE TABLE IF NOT EXISTS intelligence.migrations ("
                    "name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
                )
        except psycopg.errors.InsufficientPrivilege:
            pass  # restricted role — the object check below decides
        files = sorted(p.name for p in migrations_dir.glob("*.sql"))
        try:
            with self._lock:
                applied = {
                    row["name"]
                    for row in conn.execute("SELECT name FROM intelligence.migrations").fetchall()
                }
                for name in files:
                    if name in applied:
                        continue
                    sql = (migrations_dir / name).read_text(encoding="utf-8")
                    with conn.transaction():
                        conn.execute(sql)
                        conn.execute("INSERT INTO intelligence.migrations (name) VALUES (%s)", (name,))
        except psycopg.errors.InsufficientPrivilege as error:
            missing = [
                obj
                for obj in REQUIRED_OBJECTS
                if conn.execute("SELECT to_regclass(%s) AS reg", (obj,)).fetchone()["reg"] is None
            ]
            if missing:
                raise RuntimeError(
                    "database role lacks migration rights and required objects are missing: "
                    f"{missing}. Apply migrations with an operator connection "
                    "(intelligence/jobs/apply-migrations.mjs) — refusing to start half-configured."
                ) from error
            logger.warning(
                "postgres store: migrations skipped for this role (no DDL rights); "
                "required objects already present — applied by the operator"
            )

    # -- creation ------------------------------------------------------------

    def create(self, record: TaskRecord, payload_canonical: str) -> tuple[TaskRecord, bool]:
        if len(payload_canonical.encode("utf-8")) > TASK_PAYLOAD_MAX_BYTES:
            raise HermesError("PAYLOAD_TOO_LARGE", f"payload exceeds {TASK_PAYLOAD_MAX_BYTES} bytes")
        row = _record_to_row(record)
        row["payload_canonical"] = payload_canonical
        with self._tenant_tx(record.submitted_by):
            # Atomic across INDEPENDENT connections (finding 3): the winner's
            # INSERT commits; a racing replica's INSERT conflicts, does
            # nothing, and re-reads the committed row — replay, never a
            # uniqueness error, never a duplicate. PostgreSQL blocks the
            # conflicting insert until the winner commits or aborts, so the
            # re-read below always sees a decided state.
            inserted = self._conn.execute(
                f"INSERT INTO intelligence.hermes_tasks ({COLUMNS}) VALUES ("
                "%(task_id)s, %(schema_version)s, %(task_type)s, %(skill_id)s, %(purpose)s, %(submitted_by)s, "
                "%(status)s, %(budget)s::jsonb, %(idempotency_key)s, %(payload)s::jsonb, %(payload_canonical)s, "
                "%(attempts)s, %(max_attempts)s, %(steps_used)s, %(tool_calls_used)s, %(created_at)s, "
                "%(started_at)s, %(finished_at)s, %(next_attempt_at)s, %(trace_id)s, %(worker_id)s, "
                "%(result)s::jsonb, %(refusal_reason)s, %(error_class)s, %(failure_class)s, "
                "%(cancel_requested)s, %(receipts)s::jsonb) "
                "ON CONFLICT (submitted_by, idempotency_key) DO NOTHING RETURNING task_id",
                row,
            ).fetchone()
            if inserted is not None:
                return record.model_copy(deep=True), False
            existing = self._conn.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE submitted_by = %s AND idempotency_key = %s",
                (record.submitted_by, record.idempotency_key),
            ).fetchone()
            if existing is None:
                raise RuntimeError("idempotency race resolved without a row; retry the request")
            if existing["payload_canonical"] != payload_canonical:
                raise IdempotencyConflict("idempotency key reused with a different payload")
            return _row_to_record(existing), True

    # -- reads -----------------------------------------------------------------

    def get(self, task_id: str) -> Optional[TaskRecord]:
        """Unscoped read — the infrastructure/lifecycle path (worker progress,
        admin requeue). Runs on the infrastructure connection."""
        with self._lock:
            row = self._infra.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE task_id = %s", (task_id,)
            ).fetchone()
            return _row_to_record(row) if row else None

    def get_scoped(self, task_id: str, principal) -> Optional[TaskRecord]:
        if principal is None:
            return None
        if principal.is_admin:
            # Admin reads run on the infrastructure connection, whose role
            # holds the intelligence_admin membership the RLS admin policy
            # requires (the app role deliberately does not).
            with self._lock:
                row = self._infra.execute(
                    "SELECT * FROM intelligence.hermes_tasks WHERE task_id = %s",
                    (task_id,),
                ).fetchone()
                return _row_to_record(row) if row else None
        with self._tenant_tx(principal.caller_id):
            row = self._conn.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE task_id = %s AND submitted_by = %s",
                (task_id, principal.caller_id),
            ).fetchone()
            return _row_to_record(row) if row else None

    def find_by_idempotency(self, owner: str, idempotency_key: str) -> Optional[TaskRecord]:
        with self._tenant_tx(owner):
            row = self._conn.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE submitted_by = %s AND idempotency_key = %s",
                (owner, idempotency_key),
            ).fetchone()
            return _row_to_record(row) if row else None

    def list_for_owner(self, owner: str, limit: int = 50) -> list[TaskRecord]:
        limit = max(1, min(int(limit), 100))
        with self._tenant_tx(owner):
            rows = self._conn.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE submitted_by = %s "
                "ORDER BY created_at DESC LIMIT %s",
                (owner, limit),
            ).fetchall()
            return [_row_to_record(r) for r in rows]

    def list_all(self, limit: int = 50) -> list[TaskRecord]:
        limit = max(1, min(int(limit), 100))
        with self._lock:
            rows = self._infra.execute(
                "SELECT * FROM intelligence.hermes_tasks ORDER BY created_at DESC LIMIT %s", (limit,)
            ).fetchall()
            return [_row_to_record(r) for r in rows]

    def list_dead(self, limit: int = 50) -> list[TaskRecord]:
        limit = max(1, min(int(limit), 100))
        with self._lock:
            rows = self._infra.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE status = 'DEAD' "
                "ORDER BY created_at DESC LIMIT %s",
                (limit,),
            ).fetchall()
            return [_row_to_record(r) for r in rows]

    # -- writes ------------------------------------------------------------------

    def save(self, record: TaskRecord) -> TaskRecord:
        row = _record_to_row(record)
        row["payload_canonical"] = canonical_payload(record.payload)
        with self._lock, self._infra.transaction():
            # Lifecycle saves carry the record's own owner context
            # (round-3 remediation): on the tenant connection the RLS owner
            # policy WITH CHECK admits the UPDATE; on the infrastructure
            # connection the context is redundant (the admin policy already
            # admits it). One code path, correct under both role shapes.
            self._infra.execute(
                "SELECT set_config('intelligence.owner', %s, true)", (record.submitted_by,)
            )
            # cancel_requested is merged, never cleared (round-4 remediation):
            # a cancel request durable-flagged by ANOTHER instance between
            # this executor's claim and its save must survive the save.
            # Writing the executor's stale snapshot verbatim used to reset
            # the flag and lose the cancellation.
            updated = self._infra.execute(
                f"UPDATE intelligence.hermes_tasks SET schema_version=%(schema_version)s, task_type=%(task_type)s, "
                "skill_id=%(skill_id)s, purpose=%(purpose)s, submitted_by=%(submitted_by)s, status=%(status)s, "
                "budget=%(budget)s::jsonb, idempotency_key=%(idempotency_key)s, payload=%(payload)s::jsonb, "
                "payload_canonical=%(payload_canonical)s, attempts=%(attempts)s, max_attempts=%(max_attempts)s, "
                "steps_used=%(steps_used)s, tool_calls_used=%(tool_calls_used)s, created_at=%(created_at)s, "
                "started_at=%(started_at)s, finished_at=%(finished_at)s, next_attempt_at=%(next_attempt_at)s, "
                "trace_id=%(trace_id)s, worker_id=%(worker_id)s, result=%(result)s::jsonb, "
                "refusal_reason=%(refusal_reason)s, error_class=%(error_class)s, failure_class=%(failure_class)s, "
                "cancel_requested = (intelligence.hermes_tasks.cancel_requested OR %(cancel_requested)s), "
                "receipts=%(receipts)s::jsonb "
                "WHERE task_id=%(task_id)s RETURNING *",
                row,
            ).fetchone()
            if updated is None:
                raise KeyError(f"unknown task {record.task_id}")
            return _row_to_record(updated)

    def save_execution_result(self, record: TaskRecord, now: Optional[float] = None) -> bool:
        """Executor finish-save, guarded against lost claims (round-4).

        Writes the RUNNING → terminal transition ONLY while the row is still
        owned by this worker's claim (same worker_id, still RUNNING). When
        recovery has already requeued the row (lease expired — the worker was
        presumed dead), the row moved on and this executor must NOT overwrite
        it: overwriting a QUEUED row with a terminal status is exactly the
        'two instances execute the same idempotent task' corruption this
        remediation removes. Returns False when the claim was lost; the
        receipt is durable either way (append_receipt)."""
        row = _record_to_row(record)
        row["payload_canonical"] = canonical_payload(record.payload)
        with self._lock, self._infra.transaction():
            self._infra.execute(
                "SELECT set_config('intelligence.owner', %s, true)", (record.submitted_by,)
            )
            updated = self._infra.execute(
                f"UPDATE intelligence.hermes_tasks SET schema_version=%(schema_version)s, task_type=%(task_type)s, "
                "skill_id=%(skill_id)s, purpose=%(purpose)s, submitted_by=%(submitted_by)s, status=%(status)s, "
                "budget=%(budget)s::jsonb, idempotency_key=%(idempotency_key)s, payload=%(payload)s::jsonb, "
                "payload_canonical=%(payload_canonical)s, attempts=%(attempts)s, max_attempts=%(max_attempts)s, "
                "steps_used=%(steps_used)s, tool_calls_used=%(tool_calls_used)s, created_at=%(created_at)s, "
                "started_at=%(started_at)s, finished_at=%(finished_at)s, next_attempt_at=%(next_attempt_at)s, "
                "trace_id=%(trace_id)s, worker_id=%(worker_id)s, result=%(result)s::jsonb, "
                "refusal_reason=%(refusal_reason)s, error_class=%(error_class)s, failure_class=%(failure_class)s, "
                "cancel_requested = (intelligence.hermes_tasks.cancel_requested OR %(cancel_requested)s), "
                "lease_expires_at = NULL "
                "WHERE task_id=%(task_id)s AND worker_id=%(worker_id)s AND status = 'RUNNING' RETURNING *",
                row,
            ).fetchone()
            return updated is not None

    def reschedule_after_failure(self, record: TaskRecord, now: Optional[float] = None) -> bool:
        """CAS retry scheduling after a FAILED execution (round-4): FAILED →
        QUEUED with bounded backoff while attempts remain (transient), or
        FAILED → DEAD (attempts exhausted / permanent). Guarded on the row
        still being the FAILED state this worker just wrote (worker_id match),
        so a recovered row cannot be rescheduled twice."""
        now = time.time() if now is None else now
        from .contracts import retry_delay_seconds

        if record.attempts >= record.max_attempts or record.failure_class is FailureClass.PERMANENT:
            refusal = record.refusal_reason or (
                f"DEAD_LETTER_{record.failure_class.value if record.failure_class else 'FAILURE'}_{record.error_class or ''}"[:200]
            )
            with self._lock, self._infra.transaction():
                self._infra.execute(
                    "SELECT set_config('intelligence.owner', %s, true)", (record.submitted_by,)
                )
                row = self._infra.execute(
                    "UPDATE intelligence.hermes_tasks SET status = 'DEAD', finished_at = %s, "
                    "refusal_reason = COALESCE(refusal_reason, %s) "
                    "WHERE task_id = %s AND worker_id = %s AND status = 'FAILED' RETURNING task_id",
                    (now, refusal, record.task_id, record.worker_id),
                ).fetchone()
            return row is not None
        with self._lock, self._infra.transaction():
            self._infra.execute(
                "SELECT set_config('intelligence.owner', %s, true)", (record.submitted_by,)
            )
            row = self._infra.execute(
                "UPDATE intelligence.hermes_tasks SET status = 'QUEUED', next_attempt_at = %s, "
                "result = NULL, finished_at = NULL, lease_expires_at = NULL "
                "WHERE task_id = %s AND worker_id = %s AND status = 'FAILED' RETURNING task_id",
                (now + retry_delay_seconds(record.attempts), record.task_id, record.worker_id),
            ).fetchone()
        return row is not None

    def claim_next(self, worker_id: str, now: Optional[float] = None) -> Optional[TaskRecord]:
        now = time.time() if now is None else now
        with self._lock:
            row = self._infra.execute(
                """
                UPDATE intelligence.hermes_tasks SET status = 'RUNNING', started_at = %s, worker_id = %s,
                    attempts = LEAST(attempts + 1, max_attempts),
                    lease_expires_at = %s
                WHERE task_id = (
                    SELECT task_id FROM intelligence.hermes_tasks
                    WHERE status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= %s)
                    ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
                )
                RETURNING *
                """,
                (now, worker_id, now + self._lease_seconds, now),
            ).fetchone()
            return _row_to_record(row) if row else None

    def claim_task(self, task_id: str, worker_id: str, now: Optional[float] = None, owner: Optional[str] = None) -> Optional[TaskRecord]:
        """CAS claim of ONE specific task (the synchronous execution path):
        QUEUED → RUNNING with the caller's worker stamp and a fresh lease,
        atomically. Returns None when the row has moved (recovered, claimed
        by another instance, cancelled) — the caller must not execute."""
        now = time.time() if now is None else now
        with self._lock, self._infra.transaction():
            # The sync path may run on the restricted tenant connection
            # (round-3 wiring): the claim is a lifecycle operation on the
            # caller's own row, so it carries the VERIFIED owner context from
            # the authenticated submission (never from a table read).
            if owner is not None:
                self._infra.execute(
                    "SELECT set_config('intelligence.owner', %s, true)", (owner,)
                )
            claimed = self._infra.execute(
                """
                UPDATE intelligence.hermes_tasks SET status = 'RUNNING', started_at = %s, worker_id = %s,
                    attempts = LEAST(attempts + 1, max_attempts),
                    lease_expires_at = %s
                WHERE task_id = %s AND status = 'QUEUED'
                      AND (next_attempt_at IS NULL OR next_attempt_at <= %s)
                RETURNING *
                """,
                (now, worker_id, now + self._lease_seconds, task_id, now),
            ).fetchone()
            return _row_to_record(claimed) if claimed else None

    def renew_lease(self, task_id: str, worker_id: str, now: Optional[float] = None) -> bool:
        """Heartbeat: extend the execution lease of a RUNNING claim owned by
        this worker. CAS on (task_id, worker_id, status='RUNNING') so a stale
        worker can never renew a claim that recovery has already requeued."""
        now = time.time() if now is None else now
        with self._lock:
            row = self._infra.execute(
                "UPDATE intelligence.hermes_tasks SET lease_expires_at = %s "
                "WHERE task_id = %s AND worker_id = %s AND status = 'RUNNING' RETURNING task_id",
                (now + self._lease_seconds, task_id, worker_id),
            ).fetchone()
            return row is not None

    def request_cancel(self, task_id: str, principal) -> Optional[TaskRecord]:
        if principal is None:
            return None
        if principal.is_admin:
            with self._lock, self._infra.transaction():
                return self._cancel_on(self._infra, task_id, principal)
        with self._tenant_tx(principal.caller_id):
            return self._cancel_on(self._conn, task_id, principal)

    def _cancel_on(self, conn: psycopg.Connection, task_id: str, principal) -> Optional[TaskRecord]:
        # Application-level ownership filter stays FIRST (defense in depth):
        # owner/superuser sessions bypass RLS, so the SQL predicate — not only
        # the row-level policy — must carry the tenant boundary.
        if principal.is_admin:
            row = conn.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE task_id = %s",
                (task_id,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE task_id = %s AND submitted_by = %s",
                (task_id, principal.caller_id),
            ).fetchone()
        if row is None:
            return None
        if row["status"] in ("SUCCEEDED", "CANCELLED", "REFUSED", "DEAD"):
            return None
        if row["status"] == "RUNNING":
            updated = conn.execute(
                "UPDATE intelligence.hermes_tasks SET cancel_requested = TRUE WHERE task_id = %s RETURNING *",
                (task_id,),
            ).fetchone()
            return _row_to_record(updated)
        updated = conn.execute(
            "UPDATE intelligence.hermes_tasks SET status = 'CANCELLED', finished_at = %s WHERE task_id = %s RETURNING *",
            (time.time(), task_id),
        ).fetchone()
        return _row_to_record(updated)

    # -- operations ------------------------------------------------------------------

    def append_receipt(self, record: TaskRecord, receipt: "ExecutionReceipt", now: Optional[float] = None) -> bool:
        """Durable, idempotent receipt append (round-4): the receipt becomes a
        row in intelligence.hermes_receipts (UNIQUE task_id+attempt decides
        across replicas — a repeated append is a no-op) and the task row's
        JSONB read-model is extended inside the SAME transaction, so every
        reader sees a consistent pair. The old read-modify-write of the JSONB
        column lost receipts when two processes saved concurrently."""
        now = time.time() if now is None else now
        receipt_row = {
            "receipt_id": f"rcpt-{record.task_id}-{int(receipt.attempt)}",
            "task_id": record.task_id,
            "submitted_by": record.submitted_by,
            "attempt": int(receipt.attempt),
            "worker_id": receipt.worker_id or "",
            "trace_id": receipt.trace_id or record.trace_id or "",
            "started_at": float(receipt.started_at),
            "finished_at": receipt.finished_at,
            "outcome": receipt.outcome,
            "error_class": receipt.error_class,
            "failure_class": receipt.failure_class.value if receipt.failure_class else None,
            "steps_used": int(receipt.steps_used or 0),
            "tool_calls_used": int(receipt.tool_calls_used or 0),
            "recorded_at": now,
        }
        with self._lock, self._infra.transaction():
            self._infra.execute(
                "SELECT set_config('intelligence.owner', %s, true)", (record.submitted_by,)
            )
            inserted = self._infra.execute(
                "INSERT INTO intelligence.hermes_receipts (receipt_id, task_id, submitted_by, attempt, "
                "worker_id, trace_id, started_at, finished_at, outcome, error_class, failure_class, "
                "steps_used, tool_calls_used, recorded_at) VALUES "
                "(%(receipt_id)s, %(task_id)s, %(submitted_by)s, %(attempt)s, %(worker_id)s, %(trace_id)s, "
                "%(started_at)s, %(finished_at)s, %(outcome)s, %(error_class)s, %(failure_class)s, "
                "%(steps_used)s, %(tool_calls_used)s, %(recorded_at)s) "
                "ON CONFLICT (task_id, attempt) DO NOTHING RETURNING receipt_id",
                receipt_row,
            ).fetchone()
            if inserted is None:
                return False  # duplicate append for this attempt — already durable
            self._infra.execute(
                "UPDATE intelligence.hermes_tasks SET receipts = receipts || %s::jsonb "
                "WHERE task_id = %s",
                (json.dumps([receipt.model_dump(mode="json")], ensure_ascii=False), record.task_id),
            )
            return True

    def recover_stale_running(self, deadline_seconds: float, now: Optional[float] = None) -> int:
        """Requeue RUNNING tasks whose execution lease has expired (round-4).

        The lease — set at claim time and renewed by the worker's heartbeat —
        is what makes recovery safe across instances: a live long-running
        task keeps renewing and is never stolen; a crashed worker's claims
        expire and are recovered by whichever instance sweeps first. The
        FAILED marking and the retry/DEAD rescheduling happen in ONE
        transaction, so concurrent sweeps cannot interleave the two steps."""
        now = time.time() if now is None else now
        with self._lock:
            with self._infra.transaction():
                rows = self._infra.execute(
                    """
                    UPDATE intelligence.hermes_tasks
                    SET status = 'FAILED', finished_at = %s, error_class = 'WorkerRecovery',
                        failure_class = 'TRANSIENT', lease_expires_at = NULL
                    WHERE status = 'RUNNING' AND started_at IS NOT NULL
                      AND (
                        (lease_expires_at IS NOT NULL AND lease_expires_at <= %s)
                        OR (lease_expires_at IS NULL AND started_at < %s)
                      )
                    RETURNING task_id, submitted_by, attempts, max_attempts, failure_class
                    """,
                    (now, now, now - deadline_seconds),
                ).fetchall()
                for row in rows:
                    self._reschedule_in_tx(row, now)
            return len(rows)

    def sweep_retention(self, now: Optional[float] = None, retention_seconds: Optional[float] = None) -> int:
        now = time.time() if now is None else now
        ttl = self._retention_seconds if retention_seconds is None else float(retention_seconds)
        with self._lock:
            rows = self._infra.execute(
                """
                DELETE FROM intelligence.hermes_tasks
                WHERE status IN ('SUCCEEDED','CANCELLED','REFUSED')
                  AND finished_at IS NOT NULL AND finished_at < %s
                RETURNING task_id
                """,
                (now - ttl,),
            ).fetchall()
            return len(rows)

    def consume_nonce(self, nonce: str, caller_id: str, ttl_seconds: int) -> bool:
        """Atomic cross-replica replay protection. Returns True when already
        used; expired rows are deleted lazily (TTL-bounded growth). The
        nonces table carries no tenant rows, so no owner context is needed."""
        with self._lock:
            self._conn.execute("DELETE FROM intelligence.hermes_nonces WHERE expires_at <= %s", (time.time(),))
            inserted = self._conn.execute(
                "INSERT INTO intelligence.hermes_nonces (caller_id, nonce, expires_at) VALUES (%s, %s, %s) "
                "ON CONFLICT (caller_id, nonce) DO NOTHING RETURNING caller_id",
                (caller_id, nonce, time.time() + ttl_seconds),
            ).fetchone()
            return inserted is None

    def ping(self) -> bool:
        try:
            with self._lock:
                self._conn.execute("SELECT 1")
            return True
        except psycopg.Error:
            return False

    def close(self) -> None:
        with self._lock:
            self._conn.close()
            if self._admin_conn is not None:
                self._admin_conn.close()

    # -- internals ---------------------------------------------------------------------

    def _reschedule_in_tx(self, row: dict, now: float) -> None:
        """Retry/DEAD decision for one recovered row, executed INSIDE the
        recovery transaction (the recovery UPDATE has already committed this
        row to FAILED within the tx). Legacy of _reschedule(): no re-read
        between the two steps, so a concurrent sweep cannot interleave."""
        from .contracts import retry_delay_seconds

        if row["attempts"] >= row["max_attempts"] or row["failure_class"] == "PERMANENT":
            self._infra.execute(
                "UPDATE intelligence.hermes_tasks SET status = 'DEAD', "
                "refusal_reason = COALESCE(refusal_reason, %s) WHERE task_id = %s",
                (f"DEAD_LETTER_{row['failure_class'] or 'FAILURE'}", row["task_id"]),
            )
        else:
            self._infra.execute(
                "UPDATE intelligence.hermes_tasks SET status = 'QUEUED', next_attempt_at = %s WHERE task_id = %s",
                (now + retry_delay_seconds(row["attempts"]), row["task_id"]),
            )


class PostgresNonceStore:
    """Durable cross-replica nonce store (NonceStore protocol, hermes/auth.py).

    Consume is INSERT ... ON CONFLICT DO NOTHING against the UNIQUE(caller_id,
    nonce) constraint — atomic across replicas. Expired rows are deleted
    lazily on consume (TTL-bounded growth). One connection, lock-guarded."""

    def __init__(self, conninfo: str):
        self._conn = psycopg.connect(conninfo, row_factory=dict_row)
        self._conn.autocommit = True
        self._lock = threading.Lock()

    def consume(self, nonce: str, caller_id: str, ttl_seconds: int) -> bool:
        with self._lock:
            self._conn.execute("DELETE FROM intelligence.hermes_nonces WHERE expires_at <= %s", (time.time(),))
            inserted = self._conn.execute(
                "INSERT INTO intelligence.hermes_nonces (caller_id, nonce, expires_at) VALUES (%s, %s, %s) "
                "ON CONFLICT (caller_id, nonce) DO NOTHING RETURNING caller_id",
                (caller_id, nonce, time.time() + ttl_seconds),
            ).fetchone()
            return inserted is None

    def ping(self) -> bool:
        try:
            with self._lock:
                self._conn.execute("SELECT 1")
            return True
        except psycopg.Error:
            return False

    def close(self) -> None:
        with self._lock:
            self._conn.close()


class PostgresAuditLog:
    """Durable append-only audit sink (AuditSink protocol, hermes/budget.py).

    Entries land in intelligence.hermes_audit (migration 004): who / what /
    outcome metadata only, never payload contents. The app role's grants
    (migration 005) make the table append-only at the DATABASE layer —
    SELECT + INSERT only — so audit records survive restarts and cannot be
    rewritten by the application role (reviewer finding 5)."""

    def __init__(self, conninfo: str):
        self._conn = psycopg.connect(conninfo, row_factory=dict_row)
        self._conn.autocommit = True
        self._lock = threading.Lock()

    def record(self, entry: dict[str, Any]) -> None:
        details = {k: v for k, v in entry.items() if k not in ("ts", "event", "actor")}
        with self._lock:
            self._conn.execute(
                "INSERT INTO intelligence.hermes_audit (ts, event, actor, details) "
                "VALUES (%s, %s, %s, %s::jsonb)",
                (
                    float(entry.get("ts", time.time())),
                    str(entry.get("event", "unclassified")),
                    entry.get("actor"),
                    json.dumps(details, ensure_ascii=False, default=str),
                ),
            )

    def entries(self, limit: int = 100) -> list[dict[str, Any]]:
        """Read-back helper (admin tooling and tests); newest first."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT ts, event, actor, details FROM intelligence.hermes_audit "
                "ORDER BY id DESC LIMIT %s",
                (max(1, min(int(limit), 1000)),),
            ).fetchall()
            return [
                {"ts": r["ts"], "event": r["event"], "actor": r["actor"], "details": r["details"]}
                for r in rows
            ]

    def ping(self) -> bool:
        try:
            with self._lock:
                self._conn.execute("SELECT 1")
            return True
        except psycopg.Error:
            return False

    def close(self) -> None:
        with self._lock:
            self._conn.close()
