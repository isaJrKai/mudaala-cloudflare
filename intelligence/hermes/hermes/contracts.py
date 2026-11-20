"""Mudaala Hermes — task and result contracts (pydantic, v0).

Mirrors the TypeScript job contract (`intelligence/contracts/jobs.ts`) and the
envelope rules (`intelligence/contracts/envelope.ts`). Hermes tasks are
bounded, purpose-declared, and never mutate commerce state: every result is a
recommendation that an authorised consumer must apply.

Honesty invariants encoded here:
- `confidence` is None unless a backend explicitly provides a calibrated value.
- Budgets have hard caps; a task that would exceed them is REFUSED, not run.
- GPU/spend-bearing profiles require an explicit approval flag at the caller.
"""

from __future__ import annotations

import time
import uuid
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

SCHEMA_VERSION = "1.0"

JOB_BUDGET_CAPS = {
    "max_steps": 12,
    "max_seconds": 600,
    "max_tool_calls": 10,
}


class TaskStatus(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    REFUSED = "REFUSED"


class TaskBudget(BaseModel):
    max_steps: int = Field(ge=1, le=JOB_BUDGET_CAPS["max_steps"], default=6)
    max_seconds: int = Field(ge=1, le=JOB_BUDGET_CAPS["max_seconds"], default=60)
    max_tool_calls: int = Field(ge=0, le=JOB_BUDGET_CAPS["max_tool_calls"], default=3)
    """Token/model spend is 0 in v0: no LLM calls are wired. The field exists
    so enabling a model backend later cannot silently start spend."""
    max_model_tokens: int = Field(ge=0, le=0, default=0)


class TaskSubmission(BaseModel):
    schema_version: Literal["1.0"]
    task_type: str = Field(min_length=3, max_length=64)
    skill_id: str = Field(pattern=r"^msk-\d{3}$")
    purpose: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = Field(min_length=8, max_length=128)
    submitted_by: str = Field(min_length=1, max_length=64)
    budget: TaskBudget = Field(default_factory=TaskBudget)


class TaskResult(BaseModel):
    summary: str = Field(min_length=1, max_length=400)
    result_ref: Optional[str] = Field(default=None, max_length=256)
    """Reference to a stored artefact; payloads are not inlined into results."""
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    reason_codes: list[str] = Field(default_factory=list, max_length=16)
    warnings: list[str] = Field(default_factory=list, max_length=8)


class TaskRecord(BaseModel):
    task_id: str
    schema_version: Literal["1.0"] = "1.0"
    task_type: str
    skill_id: str
    purpose: str
    submitted_by: str
    status: TaskStatus
    budget: TaskBudget
    idempotency_key: str
    steps_used: int = 0
    tool_calls_used: int = 0
    created_at: float
    finished_at: Optional[float] = None
    result: Optional[TaskResult] = None
    refusal_reason: Optional[str] = Field(default=None, max_length=200)

    @staticmethod
    def from_submission(submission: TaskSubmission) -> "TaskRecord":
        return TaskRecord(
            task_id=f"task-{uuid.uuid4().hex[:16]}",
            task_type=submission.task_type,
            skill_id=submission.skill_id,
            purpose=submission.purpose,
            submitted_by=submission.submitted_by,
            status=TaskStatus.QUEUED,
            budget=submission.budget,
            idempotency_key=submission.idempotency_key,
            created_at=time.time(),
        )


class BudgetExceeded(RuntimeError):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason
