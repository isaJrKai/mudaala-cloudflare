"""Task router — the governance heart of Hermes.

Routing a task means, in order:
1. resolve the skill and require status `active`;
2. require the task type to be listed by the skill and handled by the backend;
3. run the backend under a fresh BudgetState;
4. audit the attempt (metadata only, never payloads);
5. return the TaskRecord (SUCCEEDED / FAILED / REFUSED with a reason).

A REFUSED task is a normal, auditable outcome — e.g. draft skill, unknown
task type, budget exhaustion. Refusal is the safety behaviour, not an error.
"""

from __future__ import annotations

import time
from typing import Any, Optional

from .backends import AgentBackend
from .budget import BudgetExceeded, BudgetState, AuditSink
from .contracts import TaskRecord, TaskResult, TaskStatus, TaskSubmission
from .skills import SkillRegistry

REFUSAL_NO_SKILL = "REFUSED_SKILL_NOT_ACTIVE"
REFUSAL_UNKNOWN_SKILL = "REFUSED_UNKNOWN_SKILL"
REFUSAL_TASK_TYPE_MISMATCH = "REFUSED_TASK_TYPE_NOT_IN_SKILL"
REFUSAL_NO_HANDLER = "REFUSED_NO_BACKEND_HANDLER"


class TaskRouter:
    def __init__(
        self,
        skills: SkillRegistry,
        backend: AgentBackend,
        audit: AuditSink,
        now: Optional[Any] = None,
    ):
        self._skills = skills
        self._backend = backend
        self._audit = audit
        self._now = now or time.time

    def route(self, submission: TaskSubmission, record: TaskRecord) -> TaskRecord:
        """Execute `record` (already created from `submission`). Returns the
        updated record with SUCCEEDED/FAILED/REFUSED and result/reason."""
        trace_id = f"hermes-{record.task_id}"

        # 1. Skill governance.
        try:
            skill = self._skills.get(submission.skill_id)
        except KeyError:
            return self._refuse(record, trace_id, REFUSAL_UNKNOWN_SKILL)
        if not self._skills.routable(submission.skill_id):
            return self._refuse(record, trace_id, REFUSAL_NO_SKILL)

        # 2. Task type must be declared by the skill AND handled by the backend.
        if submission.task_type not in skill.task_types:
            return self._refuse(record, trace_id, REFUSAL_TASK_TYPE_MISMATCH)
        if not self._backend.handles(submission.task_type):
            return self._refuse(record, trace_id, REFUSAL_NO_HANDLER)

        # 3. Execute under budget.
        budget = BudgetState(
            max_steps=record.budget.max_steps,
            max_seconds=record.budget.max_seconds,
            max_tool_calls=record.budget.max_tool_calls,
        )
        record.status = TaskStatus.RUNNING
        started = time.time()
        try:
            # The execution itself is one step; handlers may consume more.
            budget.begin_step()
            result = self._backend.execute(submission.task_type, submission.payload, budget)
        except BudgetExceeded as error:
            record.steps_used = budget.steps_used
            record.tool_calls_used = budget.tool_calls_used
            return self._refuse(record, trace_id, error.reason)
        except Exception as error:  # noqa: BLE001 — audited and surfaced, never silent
            self._audit.record(
                {
                    "event": "task_failed",
                    "task_id": record.task_id,
                    "trace_id": trace_id,
                    "skill_id": submission.skill_id,
                    "task_type": submission.task_type,
                    "actor": record.submitted_by,
                    "error_class": type(error).__name__,
                }
            )
            record.status = TaskStatus.FAILED
            record.steps_used = budget.steps_used
            record.tool_calls_used = budget.tool_calls_used
            record.finished_at = time.time()
            return record

        # 4. Budget usage is part of the record (observability).
        record.steps_used = budget.steps_used
        record.tool_calls_used = budget.tool_calls_used
        record.status = TaskStatus.SUCCEEDED
        record.result = result
        record.finished_at = time.time()
        _ = started  # latency is observable via created_at/finished_at

        # 5. Audit the outcome.
        self._audit.record(
            {
                "event": "task_succeeded",
                "task_id": record.task_id,
                "trace_id": trace_id,
                "skill_id": submission.skill_id,
                "task_type": submission.task_type,
                "actor": record.submitted_by,
                "steps": record.steps_used,
                "tool_calls": record.tool_calls_used,
                "reason_codes": result.reason_codes,
            }
        )
        return record

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
        return record
