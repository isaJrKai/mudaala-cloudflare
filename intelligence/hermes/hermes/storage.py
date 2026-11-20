"""Task storage — the seam between Hermes governance and durable state.

`TaskStore` is the protocol every store implements:
- `MemoryTaskStore` — thread-safe, bounded, for tests and local dev.
- `PostgresTaskStore` — durable, multi-replica-safe (postgres_store.py),
  backed by the approved `intelligence` schema migrations.

Concurrency contract:
- `create` is idempotent per (owner, idempotency_key): same key + content-
  equal payload returns the existing record; a DIFFERENT payload raises
  IdempotencyConflict. Concurrent creates cannot produce duplicates.
- `claim_next` is an atomic QUEUED → RUNNING claim, safe across workers
  (in-memory: under the store lock; Postgres: FOR UPDATE SKIP LOCKED).
- Tenant isolation: `get_scoped` returns a record ONLY for its owner or an
  explicit administrator; anything else is None (indistinguishable from a
  missing task — no existence leak across tenants).
- Retention: finished records past the TTL are swept; DEAD records are kept
  until an administrator resolves them (dead-letter duty cycle).
"""

from __future__ import annotations

import copy
import json
import threading
import time
from typing import Callable, Optional, Protocol

from .contracts import TaskRecord, TaskStatus, TERMINAL_STATUSES
from .validation import TASK_PAYLOAD_MAX_BYTES


class IdempotencyConflict(RuntimeError):
    """Same idempotency key reused with a different payload."""


def canonical_payload(payload: object) -> str:
    """Deterministic canonical JSON (sorted keys) — the idempotency basis."""

    def canon(node: object) -> str:
        if node is None:
            return "null"
        if isinstance(node, bool):
            return "true" if node else "false"
        if isinstance(node, (int, float)):
            return "null" if node != node or node in (float("inf"), float("-inf")) else repr(node)
        if isinstance(node, str):
            return json.dumps(node, ensure_ascii=False)
        if isinstance(node, (list, tuple)):
            return "[" + ",".join(canon(item) for item in node) + "]"
        if isinstance(node, dict):
            items = sorted((k, v) for k, v in node.items() if isinstance(k, str))
            return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canon(v) for k, v in items) + "}"
        return "null"

    return canon(payload)


class TaskStore(Protocol):
    def create(self, record: TaskRecord, payload_canonical: str) -> tuple[TaskRecord, bool]: ...
    def get(self, task_id: str) -> Optional[TaskRecord]: ...
    def get_scoped(self, task_id: str, principal) -> Optional[TaskRecord]: ...
    def save(self, record: TaskRecord) -> TaskRecord: ...
    def claim_next(self, worker_id: str, now: Optional[float] = None) -> Optional[TaskRecord]: ...
    def claim_task(self, task_id: str, worker_id: str, now: Optional[float] = None, owner: Optional[str] = None) -> Optional[TaskRecord]: ...
    def request_cancel(self, task_id: str, principal) -> Optional[TaskRecord]: ...
    def list_for_owner(self, owner: str, limit: int = 50) -> list[TaskRecord]: ...
    def list_dead(self, limit: int = 50) -> list[TaskRecord]: ...
    def find_by_idempotency(self, owner: str, idempotency_key: str) -> Optional[TaskRecord]: ...
    def recover_stale_running(self, deadline_seconds: float, now: Optional[float] = None) -> int: ...
    def sweep_retention(self, now: Optional[float] = None, retention_seconds: Optional[float] = None) -> int: ...
    def append_receipt(self, record: TaskRecord, receipt, now: Optional[float] = None) -> bool: ...
    def renew_lease(self, task_id: str, worker_id: str, now: Optional[float] = None) -> bool: ...
    def save_execution_result(self, record: TaskRecord, now: Optional[float] = None) -> bool: ...
    def reschedule_after_failure(self, record: TaskRecord, now: Optional[float] = None) -> bool: ...
    def ping(self) -> bool: ...


class MemoryTaskStore:
    """Thread-safe bounded in-memory store (tests / local dev only)."""

    def __init__(
        self,
        retention_seconds: float = 24 * 3600,
        max_records: int = 5_000,
        now: Optional[Callable[[], float]] = None,
    ) -> None:
        import threading

        self._lock = threading.RLock()
        self._by_id: dict[str, TaskRecord] = {}
        self._idem: dict[str, tuple[str, str]] = {}  # owner\x00key → (task_id, payload_canonical)
        self._retention = retention_seconds
        self._max_records = max_records
        self._now = now or time.time

    # -- creation ---------------------------------------------------------

    def create(self, record: TaskRecord, payload_canonical: str) -> tuple[TaskRecord, bool]:
        encoded = len(payload_canonical.encode("utf-8"))
        if encoded > TASK_PAYLOAD_MAX_BYTES:
            from .errors import HermesError

            raise HermesError("PAYLOAD_TOO_LARGE", f"payload exceeds {TASK_PAYLOAD_MAX_BYTES} bytes")
        key = f"{record.submitted_by}\x00{record.idempotency_key}"
        with self._lock:
            existing = self._idem.get(key)
            if existing is not None:
                task_id, stored_canonical = existing
                stored = self._by_id.get(task_id)
                if stored is None:
                    raise RuntimeError("idempotency index references a missing task")
                if stored_canonical != payload_canonical:
                    raise IdempotencyConflict("idempotency key reused with a different payload")
                return copy.deepcopy(stored), True
            self._by_id[record.task_id] = copy.deepcopy(record)
            self._idem[key] = (record.task_id, payload_canonical)
            self._enforce_bounds()
            return copy.deepcopy(record), False

    # -- reads ------------------------------------------------------------

    def get(self, task_id: str) -> Optional[TaskRecord]:
        with self._lock:
            record = self._by_id.get(task_id)
            return copy.deepcopy(record) if record else None

    def get_scoped(self, task_id: str, principal) -> Optional[TaskRecord]:
        """Owner-or-admin read. Returns None for missing AND foreign tasks."""
        if principal is None:
            return None
        with self._lock:
            record = self._by_id.get(task_id)
            if record is None:
                return None
            if record.submitted_by != principal.caller_id and not principal.is_admin:
                return None
            return copy.deepcopy(record)

    def find_by_idempotency(self, owner: str, idempotency_key: str) -> Optional[TaskRecord]:
        with self._lock:
            existing = self._idem.get(f"{owner}\x00{idempotency_key}")
            if existing is None:
                return None
            record = self._by_id.get(existing[0])
            return copy.deepcopy(record) if record else None

    def list_for_owner(self, owner: str, limit: int = 50) -> list[TaskRecord]:
        limit = max(1, min(int(limit), 100))
        with self._lock:
            records = [copy.deepcopy(r) for r in self._by_id.values() if r.submitted_by == owner]
        records.sort(key=lambda r: r.created_at, reverse=True)
        return records[:limit]

    def list_all(self, limit: int = 50) -> list[TaskRecord]:
        """Administrator cross-tenant listing (audited by the endpoint)."""
        limit = max(1, min(int(limit), 100))
        with self._lock:
            records = [copy.deepcopy(r) for r in self._by_id.values()]
        records.sort(key=lambda r: r.created_at, reverse=True)
        return records[:limit]

    def list_dead(self, limit: int = 50) -> list[TaskRecord]:
        limit = max(1, min(int(limit), 100))
        with self._lock:
            records = [copy.deepcopy(r) for r in self._by_id.values() if r.status is TaskStatus.DEAD]
        records.sort(key=lambda r: r.created_at, reverse=True)
        return records[:limit]

    # -- writes -----------------------------------------------------------

    def save(self, record: TaskRecord) -> TaskRecord:
        with self._lock:
            stored = self._by_id.get(record.task_id)
            if stored is None:
                raise KeyError(f"unknown task {record.task_id}")
            self._by_id[record.task_id] = copy.deepcopy(record)
            return copy.deepcopy(record)

    def claim_next(self, worker_id: str, now: Optional[float] = None) -> Optional[TaskRecord]:
        now = self._now() if now is None else now
        with self._lock:
            for record in self._by_id.values():
                if record.status is not TaskStatus.QUEUED:
                    continue
                if record.next_attempt_at is not None and record.next_attempt_at > now:
                    continue
                record.transition(TaskStatus.RUNNING)
                record.started_at = now
                record.worker_id = worker_id
                # Count the attempt at claim time (parity with the Postgres
                # store's atomic claim), so receipts and retries line up.
                record.attempts = min(record.attempts + 1, record.max_attempts)
                return copy.deepcopy(record)
            return None

    def request_cancel(self, task_id: str, principal) -> Optional[TaskRecord]:
        if principal is None:
            return None
        with self._lock:
            record = self._by_id.get(task_id)
            if record is None:
                return None
            if record.submitted_by != principal.caller_id and not principal.is_admin:
                return None
            if record.status in TERMINAL_STATUSES:
                return None  # cancellation of a terminal task is a conflict
            if record.status is TaskStatus.RUNNING:
                record.cancel_requested = True
                return copy.deepcopy(record)
            record.transition(TaskStatus.CANCELLED)
            return copy.deepcopy(record)

    # -- operations ---------------------------------------------------------

    def append_receipt(self, record: TaskRecord, receipt, now: Optional[float] = None) -> bool:
        """Idempotent receipt append for the single-process store: one receipt
        per attempt (duplicate appends are a no-op, matching the Postgres
        UNIQUE(task_id, attempt) semantics). Persistence rides the record —
        the following save()/save_execution_result() writes receipts — so
        this method validates and reports without mutating the record."""
        with self._lock:
            return not any(r.attempt == receipt.attempt for r in record.receipts)

    def claim_task(self, task_id: str, worker_id: str, now: Optional[float] = None, owner: Optional[str] = None) -> Optional[TaskRecord]:
        """CAS claim of one specific task (single-process: lock-guarded).
        `owner` is accepted for protocol parity (RLS has no memory-store
        equivalent) and deliberately unused."""
        now = self._now() if now is None else now
        with self._lock:
            record = self._by_id.get(task_id)
            if record is None or record.status is not TaskStatus.QUEUED:
                return None
            if record.next_attempt_at is not None and record.next_attempt_at > now:
                return None
            record.transition(TaskStatus.RUNNING)
            record.started_at = now
            record.attempts = min(record.attempts + 1, record.max_attempts)
            record.worker_id = worker_id
            return copy.deepcopy(record)

    def renew_lease(self, task_id: str, worker_id: str, now: Optional[float] = None) -> bool:
        """No lease in the single-process memory store: claims are guarded by
        the store lock, so there is nothing to expire. Always True."""
        return True

    def save_execution_result(self, record: TaskRecord, now: Optional[float] = None) -> bool:
        """Single-process finish save; the claim cannot be lost."""
        self.save(record)
        return True

    def reschedule_after_failure(self, record: TaskRecord, now: Optional[float] = None) -> bool:
        """FAILED → QUEUED with backoff or DEAD, decided and applied here
        (single-process CAS: the store lock guards it), mirroring the
        transition onto the record exactly like the legacy in-router path."""
        now = self._now() if now is None else now
        from .contracts import FailureClass, retry_delay_seconds

        if record.attempts >= record.max_attempts or record.failure_class is FailureClass.PERMANENT:
            record.transition(TaskStatus.DEAD)
            if record.refusal_reason is None:
                record.refusal_reason = f"DEAD_LETTER_{record.failure_class.value if record.failure_class else 'FAILURE'}_{record.error_class or ''}"[:200]
        else:
            record.transition(TaskStatus.QUEUED)
            record.next_attempt_at = now + retry_delay_seconds(record.attempts)
        self.save(record)
        return True

    def recover_stale_running(self, deadline_seconds: float, now: Optional[float] = None) -> int:
        """Worker recovery: RUNNING tasks whose worker died (no progress past
        the deadline) are requeued for a retry attempt."""
        now = self._now() if now is None else now
        recovered = 0
        with self._lock:
            for record in self._by_id.values():
                if record.status is TaskStatus.RUNNING and record.started_at is not None:
                    if now - record.started_at > deadline_seconds:
                        record.transition(TaskStatus.FAILED)
                        record.error_class = "WorkerRecovery"
                        from .contracts import FailureClass

                        record.failure_class = FailureClass.TRANSIENT
                        record.finished_at = now
                        self._schedule_retry_or_dead(record, now)
                        recovered += 1
        return recovered

    def sweep_retention(self, now: Optional[float] = None, retention_seconds: Optional[float] = None) -> int:
        now = self._now() if now is None else now
        ttl = self._retention if retention_seconds is None else float(retention_seconds)
        swept = 0
        with self._lock:
            dead_ids = {r.task_id for r in self._by_id.values() if r.status is TaskStatus.DEAD}
            for task_id, record in list(self._by_id.items()):
                if record.status not in TERMINAL_STATUSES or task_id in dead_ids:
                    continue
                if record.finished_at is not None and now - record.finished_at > ttl:
                    self._by_id.pop(task_id, None)
                    swept += 1
            for key, (task_id, _canonical) in list(self._idem.items()):
                if task_id not in self._by_id:
                    self._idem.pop(key, None)
        return swept

    def ping(self) -> bool:
        return True

    # -- internals ----------------------------------------------------------

    def _schedule_retry_or_dead(self, record: TaskRecord, now: float) -> None:
        """FAILED record → QUEUED with backoff (transient, attempts remain)
        or DEAD (permanent / attempts exhausted). Caller holds the lock."""
        from .contracts import FailureClass, retry_delay_seconds

        if record.attempts >= record.max_attempts or record.failure_class is FailureClass.PERMANENT:
            record.transition(TaskStatus.DEAD)
            if record.failure_class is FailureClass.PERMANENT and record.refusal_reason is None:
                record.refusal_reason = f"DEAD_LETTER_PERMANENT_{record.error_class or 'FAILURE'}"
        else:
            record.transition(TaskStatus.QUEUED)
            record.next_attempt_at = now + retry_delay_seconds(record.attempts)

    def _enforce_bounds(self) -> None:
        # Dead-letter records are never swept by the size bound (operator
        # duty); finished records expire by retention first.
        if len(self._by_id) <= self._max_records:
            return
        candidates = [
            (r.task_id, r.finished_at)
            for r in self._by_id.values()
            if r.status in TERMINAL_STATUSES and r.status is not TaskStatus.DEAD and r.finished_at is not None
        ]
        candidates.sort(key=lambda item: (item[1] or 0.0, item[0]))
        victims = {task_id for task_id, _ in candidates[: len(self._by_id) - self._max_records]}
        if not victims:
            return
        for task_id in victims:
            self._by_id.pop(task_id, None)
        for key, (task_id, _canonical) in list(self._idem.items()):
            if task_id not in self._by_id:
                self._idem.pop(key, None)
