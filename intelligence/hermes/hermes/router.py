"""Task router — the governance heart of Hermes.

Routing a task means, in order:
1. resolve the skill and require status `active`;
2. require the task type to be listed by the skill and handled by the backend;
3. queue the task (VALIDATED → QUEUED);
4. execute under a fresh BudgetState with a hard timeout;
5. write one execution receipt per attempt (metadata only, never payloads);
6. classify failures and schedule retries (transient) or dead-letter
   (permanent / attempts exhausted) when a store is attached;
7. audit every outcome.

A REFUSED task is a normal, auditable outcome — e.g. draft skill, unknown
task type, budget exhaustion. Refusal is the safety behaviour, not an error.

Timeout handling: handlers run in a worker thread with
`future.result(timeout=budget.max_seconds)`; the timeout raises TaskTimeout,
the attempt is recorded as FAILED/TRANSIENT and the retry policy applies.
(Python threads cannot be force-killed — a handler that ignores its budget
keeps the thread busy until the process recycles it; this is documented as a
runtime limitation in the Hermes README.)
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from typing import Any, Optional

from .backends import AgentBackend
from .budget import AuditSink, BudgetExceeded, BudgetState
from .errors import HermesError
from .contracts import (
    ExecutionReceipt,
    FailureClass,
    TaskCancelledCooperative,
    TaskRecord,
    TaskResult,
    TaskStatus,
    TaskTimeout,
    classify_failure,
)
from .skills import SkillRegistry
from .storage import TaskStore

REFUSAL_NO_SKILL = "REFUSED_SKILL_NOT_ACTIVE"
REFUSAL_UNKNOWN_SKILL = "REFUSED_UNKNOWN_SKILL"
REFUSAL_TASK_TYPE_MISMATCH = "REFUSED_TASK_TYPE_NOT_IN_SKILL"
REFUSAL_NO_HANDLER = "REFUSED_NO_BACKEND_HANDLER"
REFUSAL_CANCELLED = "TASK_CANCELLED"


class TaskRouter:
    def __init__(
        self,
        skills: SkillRegistry,
        backend: AgentBackend,
        audit: AuditSink,
        now: Optional[Any] = None,
        store: Optional[TaskStore] = None,
        worker_id: str = "hermes-sync",
        execution_pool: Optional[ThreadPoolExecutor] = None,
    ):
        self._skills = skills
        self._backend = backend
        self._audit = audit
        self._now = now or time.time
        self._store = store
        self._worker_id = worker_id
        self._pool = execution_pool

    # -- governance chain ---------------------------------------------------

    def route(self, record: TaskRecord) -> TaskRecord:
        """SUBMITTED → VALIDATED → QUEUED, refusing at each gate. Pure
        governance: no execution happens here."""
        trace_id = record.trace_id or f"hermes-{record.task_id}"

        # 1. Skill governance.
        try:
            skill = self._skills.get(record.skill_id)
        except KeyError:
            return self._refuse(record, trace_id, REFUSAL_UNKNOWN_SKILL)
        if not self._skills.routable(record.skill_id):
            return self._refuse(record, trace_id, REFUSAL_NO_SKILL)

        # 2. Task type must be declared by the skill AND handled by the backend.
        if record.task_type not in skill.task_types:
            return self._refuse(record, trace_id, REFUSAL_TASK_TYPE_MISMATCH)
        if not self._backend.handles(record.task_type):
            return self._refuse(record, trace_id, REFUSAL_NO_HANDLER)

        # 3. Queue the task.
        record.transition(TaskStatus.VALIDATED)
        record.transition(TaskStatus.QUEUED)
        self._save(record)
        return record

    # -- execution ----------------------------------------------------------

    def execute(self, record: TaskRecord) -> TaskRecord:
        """QUEUED → RUNNING → SUCCEEDED / FAILED (retry scheduling applies
        when a store is attached). Cancellation is honoured before start and
        cooperatively between handler steps."""
        if record.status is TaskStatus.QUEUED and record.cancel_requested:
            record.transition(TaskStatus.CANCELLED)
            record.refusal_reason = REFUSAL_CANCELLED
            self._audit.record(
                {
                    "event": "task_cancelled",
                    "task_id": record.task_id,
                    "trace_id": record.trace_id,
                    "actor": record.submitted_by,
                }
            )
            self._save(record)
            return record

        # Two entry states: QUEUED (sync path — claim now) or RUNNING
        # (worker path — the store's atomic claim already transitioned and
        # counted the attempt). Anything else is a caller bug.
        if record.status is TaskStatus.QUEUED:
            if self._store is not None and hasattr(self._store, "claim_task"):
                # Sync path claims CAS-style, exactly like a worker: the row
                # moves QUEUED → RUNNING under this worker id with a fresh
                # lease, or it has already moved (recovered, claimed by
                # another instance) and this request must NOT execute the
                # same idempotent task again — it refuses instead.
                claimed = self._store.claim_task(record.task_id, self._worker_id, self._now(), owner=record.submitted_by)
                if claimed is None:
                    # The row moved under us (recovered, claimed by another
                    # instance, cancelled). REFUSED would lie about who made
                    # the decision; this is a plain race conflict and the
                    # honest response is a 409, not a fabricated status.
                    self._audit.record({
                        "event": "task_sync_claim_lost",
                        "task_id": record.task_id,
                        "trace_id": record.trace_id,
                        "actor": record.submitted_by,
                        "worker_id": self._worker_id,
                    })
                    raise HermesError(
                        "TASK_CLAIM_LOST",
                        "the task is no longer claimable (it moved to another worker or was recovered); fetch its current state",
                    )
                record = claimed
            else:
                record.transition(TaskStatus.RUNNING)
                record.started_at = self._now()
                record.attempts = min(record.attempts + 1, record.max_attempts)
                record.worker_id = self._worker_id
        elif record.status is not TaskStatus.RUNNING:
            raise ValueError(f"execute() requires a QUEUED or RUNNING task, got {record.status.value}")
        attempt = record.attempts
        started = time.time()

        budget = BudgetState(
            max_steps=record.budget.max_steps,
            max_seconds=record.budget.max_seconds,
            max_tool_calls=record.budget.max_tool_calls,
            cancel_check=self._cancel_check_for(record),
        )

        receipt = ExecutionReceipt(
            attempt=attempt,
            worker_id=self._worker_id,
            trace_id=record.trace_id or record.task_id,
            started_at=started,
            finished_at=None,
            outcome="FAILED",
        )

        try:
            budget.begin_step()
            result = self._run_under_timeout(record, budget)
        except TaskTimeout:
            record.steps_used = budget.steps_used
            record.tool_calls_used = budget.tool_calls_used
            record.error_class = "TaskTimeout"
            record.failure_class = classify_failure("TaskTimeout")
            self._finish_failed(record, receipt, "TIMEOUT", started)
            self._audit.record(
                {
                    "event": "task_failed",
                    "task_id": record.task_id,
                    "trace_id": record.trace_id,
                    "skill_id": record.skill_id,
                    "task_type": record.task_type,
                    "actor": record.submitted_by,
                    "error_class": "TaskTimeout",
                    "attempt": attempt,
                }
            )
            self._schedule_retry_or_dead(record)
            return record
        except BudgetExceeded as error:
            record.steps_used = budget.steps_used
            record.tool_calls_used = budget.tool_calls_used
            record.error_class = "BudgetExceeded"
            record.failure_class = FailureClass.PERMANENT
            self._finish_failed(record, receipt, "REFUSED", started)
            return self._refuse(record, record.trace_id, error.reason)
        except TaskCancelledCooperative:
            record.steps_used = budget.steps_used
            record.tool_calls_used = budget.tool_calls_used
            record.transition(TaskStatus.CANCELLED)
            record.refusal_reason = REFUSAL_CANCELLED
            receipt.outcome = "REFUSED"
            receipt.error_class = "Cancelled"
            receipt.finished_at = time.time()
            self._append_receipt(record, receipt)
            self._audit.record(
                {
                    "event": "task_cancelled",
                    "task_id": record.task_id,
                    "trace_id": record.trace_id,
                    "actor": record.submitted_by,
                    "attempt": attempt,
                }
            )
            self._save(record)
            return record
        except Exception as error:  # noqa: BLE001 — audited and classified, never silent
            record.steps_used = budget.steps_used
            record.tool_calls_used = budget.tool_calls_used
            error_class = type(error).__name__
            record.error_class = error_class[:64]
            record.failure_class = classify_failure(error_class)
            self._finish_failed(record, receipt, "FAILED", started)
            self._audit.record(
                {
                    "event": "task_failed",
                    "task_id": record.task_id,
                    "trace_id": record.trace_id,
                    "skill_id": record.skill_id,
                    "task_type": record.task_type,
                    "actor": record.submitted_by,
                    "error_class": error_class,
                    "attempt": attempt,
                }
            )
            self._schedule_retry_or_dead(record)
            return record

        # Success.
        record.steps_used = budget.steps_used
        record.tool_calls_used = budget.tool_calls_used
        record.status = TaskStatus.SUCCEEDED
        record.finished_at = time.time()
        record.result = result
        receipt.outcome = "SUCCEEDED"
        receipt.finished_at = record.finished_at
        receipt.steps_used = record.steps_used
        receipt.tool_calls_used = record.tool_calls_used
        self._append_receipt(record, receipt)
        self._audit.record(
            {
                "event": "task_succeeded",
                "task_id": record.task_id,
                "trace_id": record.trace_id,
                "skill_id": record.skill_id,
                "task_type": record.task_type,
                "actor": record.submitted_by,
                "attempt": attempt,
                "steps": record.steps_used,
                "tool_calls": record.tool_calls_used,
                "reason_codes": result.reason_codes,
            }
        )
        self._finish_save(record)
        return record

    def _cancel_check_for(self, record: TaskRecord):
        """Cooperative cancellation source: the record's own flag plus, when a
        store is attached, the CURRENT stored flag (a cancel request that
        arrived after this claim). The same boundary doubles as the execution
        lease heartbeat (round-4): each step extends the claim's lease, so a
        live long-running task is never mistaken for a dead one and requeued
        onto another instance."""

        def check() -> bool:
            if record.cancel_requested:
                return True
            if self._store is not None:
                if hasattr(self._store, "renew_lease"):
                    try:
                        self._store.renew_lease(record.task_id, self._worker_id)
                    except Exception:  # noqa: BLE001 — heartbeat must not fail the task
                        pass
                current = self._store.get(record.task_id)
                return bool(current and current.cancel_requested)
            return False

        return check

    def _run_under_timeout(self, record: TaskRecord, budget: BudgetState) -> TaskResult:
        """Run the handler in a worker thread under the task's time budget.
        Raises TaskTimeout when the budget elapses. Python threads cannot be
        force-killed: a handler that ignores its budget keeps its thread busy
        until it finishes or the process recycles it (documented limitation),
        but the TASK fails on time regardless."""
        executor = self._pool or ThreadPoolExecutor(max_workers=1)
        own_pool = self._pool is None
        try:
            future = executor.submit(self._backend.execute, record.task_type, record.payload, budget)
            try:
                return future.result(timeout=record.budget.max_seconds)
            except FutureTimeoutError as error:
                raise TaskTimeout() from error
        finally:
            if own_pool:
                executor.shutdown(wait=False)

    def _finish_failed(self, record: TaskRecord, receipt: ExecutionReceipt, outcome: str, started: float) -> None:
        record.transition(TaskStatus.FAILED)
        record.finished_at = time.time()
        receipt.outcome = outcome  # type: ignore[assignment]
        receipt.finished_at = record.finished_at
        receipt.steps_used = record.steps_used
        receipt.tool_calls_used = record.tool_calls_used
        receipt.error_class = record.error_class
        receipt.failure_class = record.failure_class
        self._append_receipt(record, receipt)
        self._finish_save(record)

    # -- helpers -------------------------------------------------------------

    def _refuse(self, record: TaskRecord, trace_id: str, reason: str) -> TaskRecord:
        record.status = TaskStatus.REFUSED
        record.refusal_reason = reason[:200]
        record.finished_at = time.time()
        self._audit.record(
            {
                "event": "task_refused",
                "task_id": record.task_id,
                "trace_id": trace_id,
                "skill_id": record.skill_id,
                "actor": record.submitted_by,
                "reason": reason,
            }
        )
        self._save(record)
        return record

    def _append_receipt(self, record: TaskRecord, receipt: ExecutionReceipt) -> None:
        """Persist the receipt durably FIRST (round-4: receipts are rows with
        a UNIQUE (task_id, attempt) constraint — a concurrent or repeated
        append can never duplicate or lose one), then mirror it onto the
        in-memory record. The old path only mutated the record and relied on
        the next save()'s full-row write, which lost receipts when another
        instance saved the same task concurrently."""
        if self._store is not None and hasattr(self._store, "append_receipt"):
            self._store.append_receipt(record, receipt)
        record.receipts = [*record.receipts, receipt][-10:]

    def _save(self, record: TaskRecord) -> Optional[TaskRecord]:
        """Persist the current record state. Requires the record to already
        exist in the store (the API creates it before routing) — a missing
        record is a programming error and raises."""
        if self._store is not None:
            self._store.save(record)
        return record

    def _finish_save(self, record: TaskRecord) -> bool:
        """Executor finish-save guarded against lost claims (round-4): the
        row is updated only while it is still RUNNING under this worker's
        claim. If recovery has already requeued it (lease expired), the row
        is NOT overwritten — overwriting a requeued row with a terminal
        status would hide the retry and let two instances disagree about
        whether the idempotent task ran. The receipt is durable either way;
        the requeued attempt re-executes with its own receipt."""
        if self._store is None:
            return True
        saved = self._store.save_execution_result(record)
        if not saved:
            self._audit.record({
                "event": "task_finish_save_lost",
                "task_id": record.task_id,
                "trace_id": record.trace_id,
                "actor": record.submitted_by,
                "worker_id": self._worker_id,
                "outcome": record.status.value,
            })
        return saved

    def _schedule_retry_or_dead(self, record: TaskRecord) -> None:
        """FAILED → QUEUED with backoff (transient, attempts remain) or DEAD
        (permanent / attempts exhausted). Requires a store; without one the
        record stays FAILED (tests assert that).

        Round-4: with a durable store this is a CAS on the row (guarded on
        the FAILED state this worker just wrote), so a concurrent recovery
        can never reschedule the same attempt twice. The record is mirrored
        so callers/tests see the same transition."""
        if self._store is None:
            return
        now = self._now()
        if hasattr(self._store, "reschedule_after_failure"):
            # Round-4: the store owns the CAS decision (FAILED → QUEUED with
            # backoff, or DEAD) and mirrors the transition onto the record.
            if not self._store.reschedule_after_failure(record, now):
                self._audit.record({
                    "event": "task_reschedule_lost",
                    "task_id": record.task_id,
                    "trace_id": record.trace_id,
                    "actor": record.submitted_by,
                    "worker_id": self._worker_id,
                })
            return
        if record.attempts >= record.max_attempts or record.failure_class is FailureClass.PERMANENT:
            record.transition(TaskStatus.DEAD)
            if record.refusal_reason is None:
                record.refusal_reason = f"DEAD_LETTER_{record.failure_class.value if record.failure_class else 'FAILURE'}_{record.error_class or ''}"[:200]
        else:
            record.transition(TaskStatus.QUEUED)
            record.next_attempt_at = now + _retry_delay(record.attempts)
        self._save(record)


def _retry_delay(attempt: int) -> float:
    from .contracts import retry_delay_seconds

    return float(retry_delay_seconds(attempt))
