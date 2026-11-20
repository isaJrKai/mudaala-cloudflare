"""Durable Hermes task store — PostgreSQL (approved `intelligence` schema).

Implements the TaskStore protocol (see storage.py) against the tables created
by intelligence/jobs/migrations/. Guarantees:

- Atomic claiming: UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED),
  so replicas cannot double-claim a QUEUED task.
- Idempotent create per (owner, idempotency_key) enforced by a UNIQUE
  constraint; payload conflicts detected by comparing payload_canonical.
- Tenant isolation: every read is owner-scoped unless the caller is an
  explicit administrator; foreign/missing tasks are both None.
- Replay protection for service auth across replicas: hermes_nonces consumes
  nonces atomically (INSERT ... ON CONFLICT DO NOTHING) with TTL cleanup.
- Recovery: stale RUNNING tasks requeue; retention sweeps finished tasks.

DEPLOYMENT NOTE: credentials come from the environment (HERMES_DATABASE_URL
or an explicit conninfo passed by the operator). Tests use DISPOSABLE
databases only (embedded-postgres / CI service containers) — never production.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Optional

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError as error:  # pragma: no cover — dependency declared in requirements
    raise ImportError("PostgresTaskStore requires psycopg>=3.2 (pip install 'psycopg[binary]')") from error

from .contracts import TaskRecord, TaskStatus, TaskResult, ExecutionReceipt, FailureClass
from .storage import IdempotencyConflict, canonical_payload
from .validation import TASK_PAYLOAD_MAX_BYTES
from .errors import HermesError

COLUMNS = (
    "task_id, schema_version, task_type, skill_id, purpose, submitted_by, status, budget, "
    "idempotency_key, payload, payload_canonical, attempts, max_attempts, steps_used, "
    "tool_calls_used, created_at, started_at, finished_at, next_attempt_at, trace_id, "
    "worker_id, result, refusal_reason, error_class, failure_class, cancel_requested, receipts"
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
    """Durable TaskStore. One psycopg connection guarded by a lock (the v0
    control plane is a single process; replicas each own their connection)."""

    def __init__(self, conninfo: str, *, apply_migrations: bool = True):
        self._conn = psycopg.connect(conninfo, row_factory=dict_row)
        self._conn.autocommit = True
        self._lock = threading.RLock()
        if apply_migrations:
            self.apply_migrations()

    # -- migrations ----------------------------------------------------------

    def apply_migrations(self) -> None:
        """Apply intelligence/jobs/migrations/*.sql in order, tracked in
        intelligence.migrations. Idempotent: already-applied files are skipped
        (verified against a disposable PostgreSQL instance)."""
        from pathlib import Path

        migrations_dir = Path(__file__).resolve().parents[2] / "jobs" / "migrations"
        with self._lock, self._conn.transaction():
            self._conn.execute("CREATE SCHEMA IF NOT EXISTS intelligence")
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS intelligence.migrations ("
                "name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
        files = sorted(p.name for p in migrations_dir.glob("*.sql"))
        with self._lock:
            applied = {
                row["name"]
                for row in self._conn.execute("SELECT name FROM intelligence.migrations").fetchall()
            }
            for name in files:
                if name in applied:
                    continue
                sql = (migrations_dir / name).read_text(encoding="utf-8")
                with self._conn.transaction():
                    self._conn.execute(sql)
                    self._conn.execute("INSERT INTO intelligence.migrations (name) VALUES (%s)", (name,))

    # -- creation ------------------------------------------------------------

    def create(self, record: TaskRecord, payload_canonical: str) -> tuple[TaskRecord, bool]:
        if len(payload_canonical.encode("utf-8")) > TASK_PAYLOAD_MAX_BYTES:
            raise HermesError("PAYLOAD_TOO_LARGE", f"payload exceeds {TASK_PAYLOAD_MAX_BYTES} bytes")
        row = _record_to_row(record)
        row["payload_canonical"] = payload_canonical
        with self._lock:
            existing = self._conn.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE submitted_by = %s AND idempotency_key = %s",
                (record.submitted_by, record.idempotency_key),
            ).fetchone()
            if existing is not None:
                if existing["payload_canonical"] != payload_canonical:
                    raise IdempotencyConflict("idempotency key reused with a different payload")
                return _row_to_record(existing), True
            self._conn.execute(
                f"INSERT INTO intelligence.hermes_tasks ({COLUMNS}) VALUES ("
                "%(task_id)s, %(schema_version)s, %(task_type)s, %(skill_id)s, %(purpose)s, %(submitted_by)s, "
                "%(status)s, %(budget)s::jsonb, %(idempotency_key)s, %(payload)s::jsonb, %(payload_canonical)s, "
                "%(attempts)s, %(max_attempts)s, %(steps_used)s, %(tool_calls_used)s, %(created_at)s, "
                "%(started_at)s, %(finished_at)s, %(next_attempt_at)s, %(trace_id)s, %(worker_id)s, "
                "%(result)s::jsonb, %(refusal_reason)s, %(error_class)s, %(failure_class)s, "
                "%(cancel_requested)s, %(receipts)s::jsonb)",
                row,
            )
            return record.model_copy(deep=True), False

    # -- reads -----------------------------------------------------------------

    def get(self, task_id: str) -> Optional[TaskRecord]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE task_id = %s", (task_id,)
            ).fetchone()
            return _row_to_record(row) if row else None

    def get_scoped(self, task_id: str, principal) -> Optional[TaskRecord]:
        if principal is None:
            return None
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE task_id = %s AND (submitted_by = %s OR %s)",
                (task_id, principal.caller_id, bool(principal.is_admin)),
            ).fetchone()
            return _row_to_record(row) if row else None

    def find_by_idempotency(self, owner: str, idempotency_key: str) -> Optional[TaskRecord]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE submitted_by = %s AND idempotency_key = %s",
                (owner, idempotency_key),
            ).fetchone()
            return _row_to_record(row) if row else None

    def list_for_owner(self, owner: str, limit: int = 50) -> list[TaskRecord]:
        limit = max(1, min(int(limit), 100))
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE submitted_by = %s "
                "ORDER BY created_at DESC LIMIT %s",
                (owner, limit),
            ).fetchall()
            return [_row_to_record(r) for r in rows]

    def list_all(self, limit: int = 50) -> list[TaskRecord]:
        limit = max(1, min(int(limit), 100))
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM intelligence.hermes_tasks ORDER BY created_at DESC LIMIT %s", (limit,)
            ).fetchall()
            return [_row_to_record(r) for r in rows]

    def list_dead(self, limit: int = 50) -> list[TaskRecord]:
        limit = max(1, min(int(limit), 100))
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE status = 'DEAD' "
                "ORDER BY created_at DESC LIMIT %s",
                (limit,),
            ).fetchall()
            return [_row_to_record(r) for r in rows]

    # -- writes ------------------------------------------------------------------

    def save(self, record: TaskRecord) -> TaskRecord:
        row = _record_to_row(record)
        row["payload_canonical"] = canonical_payload(record.payload)
        with self._lock:
            updated = self._conn.execute(
                f"UPDATE intelligence.hermes_tasks SET schema_version=%(schema_version)s, task_type=%(task_type)s, "
                "skill_id=%(skill_id)s, purpose=%(purpose)s, submitted_by=%(submitted_by)s, status=%(status)s, "
                "budget=%(budget)s::jsonb, idempotency_key=%(idempotency_key)s, payload=%(payload)s::jsonb, "
                "payload_canonical=%(payload_canonical)s, attempts=%(attempts)s, max_attempts=%(max_attempts)s, "
                "steps_used=%(steps_used)s, tool_calls_used=%(tool_calls_used)s, created_at=%(created_at)s, "
                "started_at=%(started_at)s, finished_at=%(finished_at)s, next_attempt_at=%(next_attempt_at)s, "
                "trace_id=%(trace_id)s, worker_id=%(worker_id)s, result=%(result)s::jsonb, "
                "refusal_reason=%(refusal_reason)s, error_class=%(error_class)s, failure_class=%(failure_class)s, "
                "cancel_requested=%(cancel_requested)s, receipts=%(receipts)s::jsonb "
                "WHERE task_id=%(task_id)s RETURNING *",
                row,
            ).fetchone()
            if updated is None:
                raise KeyError(f"unknown task {record.task_id}")
            return _row_to_record(updated)

    def claim_next(self, worker_id: str, now: Optional[float] = None) -> Optional[TaskRecord]:
        now = time.time() if now is None else now
        with self._lock:
            row = self._conn.execute(
                """
                UPDATE intelligence.hermes_tasks SET status = 'RUNNING', started_at = %s, worker_id = %s,
                    attempts = LEAST(attempts + 1, max_attempts)
                WHERE task_id = (
                    SELECT task_id FROM intelligence.hermes_tasks
                    WHERE status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= %s)
                    ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
                )
                RETURNING *
                """,
                (now, worker_id, now),
            ).fetchone()
            return _row_to_record(row) if row else None

    def request_cancel(self, task_id: str, principal) -> Optional[TaskRecord]:
        if principal is None:
            return None
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM intelligence.hermes_tasks WHERE task_id = %s AND (submitted_by = %s OR %s)",
                (task_id, principal.caller_id, bool(principal.is_admin)),
            ).fetchone()
            if row is None:
                return None
            if row["status"] in ("SUCCEEDED", "CANCELLED", "REFUSED", "DEAD"):
                return None
            if row["status"] == "RUNNING":
                updated = self._conn.execute(
                    "UPDATE intelligence.hermes_tasks SET cancel_requested = TRUE WHERE task_id = %s RETURNING *",
                    (task_id,),
                ).fetchone()
                return _row_to_record(updated)
            updated = self._conn.execute(
                "UPDATE intelligence.hermes_tasks SET status = 'CANCELLED', finished_at = %s WHERE task_id = %s RETURNING *",
                (time.time(), task_id),
            ).fetchone()
            return _row_to_record(updated)

    # -- operations ------------------------------------------------------------------

    def recover_stale_running(self, deadline_seconds: float, now: Optional[float] = None) -> int:
        now = time.time() if now is None else now
        with self._lock:
            rows = self._conn.execute(
                """
                UPDATE intelligence.hermes_tasks
                SET status = 'FAILED', finished_at = %s, error_class = 'WorkerRecovery',
                    failure_class = 'TRANSIENT'
                WHERE status = 'RUNNING' AND started_at IS NOT NULL AND started_at < %s
                RETURNING task_id
                """,
                (now, now - deadline_seconds),
            ).fetchall()
            for row in rows:
                self._reschedule(row["task_id"], now)
            return len(rows)

    def sweep_retention(self, now: Optional[float] = None) -> int:
        now = time.time() if now is None else now
        with self._lock:
            rows = self._conn.execute(
                """
                DELETE FROM intelligence.hermes_tasks
                WHERE status IN ('SUCCEEDED','CANCELLED','REFUSED')
                  AND finished_at IS NOT NULL AND finished_at < %s
                RETURNING task_id
                """,
                (now - 24 * 3600,),
            ).fetchall()
            return len(rows)

    def consume_nonce(self, nonce: str, caller_id: str, ttl_seconds: int) -> bool:
        """Atomic cross-replica replay protection. Returns True when already
        used; expired rows are deleted lazily (TTL-bounded growth)."""
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

    # -- internals ---------------------------------------------------------------------

    def _reschedule(self, task_id: str, now: float) -> None:
        row = self._conn.execute(
            "SELECT attempts, max_attempts, failure_class FROM intelligence.hermes_tasks WHERE task_id = %s",
            (task_id,),
        ).fetchone()
        if row is None:
            return
        from .contracts import retry_delay_seconds

        if row["attempts"] >= row["max_attempts"] or row["failure_class"] == "PERMANENT":
            self._conn.execute(
                "UPDATE intelligence.hermes_tasks SET status = 'DEAD', "
                "refusal_reason = COALESCE(refusal_reason, %s) WHERE task_id = %s",
                (f"DEAD_LETTER_{row['failure_class'] or 'FAILURE'}", task_id),
            )
        else:
            self._conn.execute(
                "UPDATE intelligence.hermes_tasks SET status = 'QUEUED', next_attempt_at = %s WHERE task_id = %s",
                (now + retry_delay_seconds(row["attempts"]), task_id),
            )
