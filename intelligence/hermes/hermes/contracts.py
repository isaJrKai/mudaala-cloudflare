"""Mudaala Hermes — task and result contracts (pydantic, v0.2).

Mirrors the TypeScript job contract (`intelligence/contracts/jobs.ts`) and the
envelope rules (`intelligence/contracts/envelope.ts`). Hermes tasks are
bounded, purpose-declared, and never mutate commerce state: every result is a
recommendation that an authorised consumer must apply.

Remediation changes (increment-1 → remediation):
- Full task lifecycle: SUBMITTED → VALIDATED → QUEUED → RUNNING →
  SUCCEEDED / FAILED / CANCELLED, plus REFUSED (governance outcome, kept —
  refusing is a normal, audited behaviour) and DEAD (dead-letter).
- `submitted_by` is NO LONGER accepted from clients. Task ownership is the
  verified service identity (see hermes/auth.py); `TaskRecord.submitted_by`
  is the tenant boundary for every read/update/cancel.
- Execution receipts: one bounded receipt per attempt (attempt number, worker,
  timing, budget usage, outcome).
- Failure classification (TRANSIENT / PERMANENT) drives bounded retries and
  the dead-letter decision; cancellation is requestable at any live state.

Honesty invariants encoded here:
- `confidence` is None unless a backend explicitly provides a calibrated value.
- Budgets have hard caps; a task that would exceed them is REFUSED, not run.
- GPU/spend-bearing profiles require an explicit approval flag at the caller.
- Model-token spend stays 0 until a real provider is reviewed and wired.
"""

from __future__ import annotations

import time
import uuid
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .validation import TASK_PAYLOAD_MAX_BYTES, TASK_STRING_MAX_LENGTH, validate_payload

SCHEMA_VERSION = "1.0"

JOB_BUDGET_CAPS = {
    "max_steps": 12,
    "max_seconds": 600,
    "max_tool_calls": 10,
}

MAX_RECEIPTS = 10
MAX_ATTEMPTS = 5


class TaskStatus(str, Enum):
    SUBMITTED = "SUBMITTED"
    VALIDATED = "VALIDATED"
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    REFUSED = "REFUSED"
    DEAD = "DEAD"


TERMINAL_STATUSES = frozenset({TaskStatus.SUCCEEDED, TaskStatus.CANCELLED, TaskStatus.REFUSED, TaskStatus.DEAD})

# Legal lifecycle transitions; anything else is a contract violation.
TRANSITIONS: dict[TaskStatus, frozenset[TaskStatus]] = {
    TaskStatus.SUBMITTED: frozenset({TaskStatus.VALIDATED, TaskStatus.REFUSED, TaskStatus.FAILED, TaskStatus.CANCELLED}),
    TaskStatus.VALIDATED: frozenset({TaskStatus.QUEUED, TaskStatus.REFUSED, TaskStatus.CANCELLED}),
    TaskStatus.QUEUED: frozenset({TaskStatus.RUNNING, TaskStatus.CANCELLED}),
    TaskStatus.RUNNING: frozenset({TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELLED}),
    TaskStatus.FAILED: frozenset({TaskStatus.QUEUED, TaskStatus.DEAD, TaskStatus.CANCELLED}),
    TaskStatus.SUCCEEDED: frozenset(),
    TaskStatus.CANCELLED: frozenset(),
    TaskStatus.REFUSED: frozenset(),
    TaskStatus.DEAD: frozenset(),
}


def can_transition(current: TaskStatus, target: TaskStatus) -> bool:
    return target in TRANSITIONS[current]


def assert_transition(current: TaskStatus, target: TaskStatus) -> None:
    if not can_transition(current, target):
        raise ValueError(f"illegal task transition {current.value} -> {target.value}")


class FailureClass(str, Enum):
    TRANSIENT = "TRANSIENT"
    PERMANENT = "PERMANENT"


# Retry rules: TRANSIENT failures requeue with bounded backoff until
# max_attempts; PERMANENT failures go straight to DEAD (dead-letter).
TRANSIENT_ERROR_CLASSES = frozenset(
    {"TimeoutError", "TaskTimeout", "WorkerRecovery", "TransientBackendError"}
)
BUDGET_ERROR_CLASSES = frozenset({"BudgetExceeded"})


def classify_failure(error_class: str) -> FailureClass:
    if error_class in BUDGET_ERROR_CLASSES:
        return FailureClass.PERMANENT  # budget exhaustion is deterministic
    if error_class in TRANSIENT_ERROR_CLASSES:
        return FailureClass.TRANSIENT
    return FailureClass.PERMANENT


def retry_delay_seconds(attempt: int) -> int:
    """Bounded exponential backoff with jitter, seconds (mirrors jobs.ts)."""
    import random

    base = min(2**max(0, attempt), 60)
    return round(base + random.random() * 0.25 * base)


class TaskBudget(BaseModel):
    max_steps: int = Field(ge=1, le=JOB_BUDGET_CAPS["max_steps"], default=6)
    max_seconds: int = Field(ge=1, le=JOB_BUDGET_CAPS["max_seconds"], default=60)
    max_tool_calls: int = Field(ge=0, le=JOB_BUDGET_CAPS["max_tool_calls"], default=3)
    """Token/model spend is 0 in v0: no LLM calls are wired. The field exists
    so enabling a model backend later cannot silently start spend."""
    max_model_tokens: int = Field(ge=0, le=0, default=0)


class TaskResult(BaseModel):
    summary: str = Field(min_length=1, max_length=400)
    result_ref: Optional[str] = Field(default=None, max_length=256)
    """Reference to a stored artefact; payloads are not inlined into results."""
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    reason_codes: list[str] = Field(default_factory=list, max_length=16)
    warnings: list[str] = Field(default_factory=list, max_length=8)


class ExecutionReceipt(BaseModel):
    """One bounded receipt per execution attempt (observability, not payloads)."""

    attempt: int = Field(ge=1, le=MAX_ATTEMPTS)
    worker_id: str = Field(min_length=1, max_length=64)
    trace_id: str = Field(min_length=1, max_length=128)
    started_at: float
    finished_at: Optional[float] = None
    outcome: Literal["SUCCEEDED", "FAILED", "REFUSED", "TIMEOUT"]
    steps_used: int = Field(ge=0, default=0)
    tool_calls_used: int = Field(ge=0, default=0)
    error_class: Optional[str] = Field(default=None, max_length=64)
    failure_class: Optional[FailureClass] = None
    note: Optional[str] = Field(default=None, max_length=200)


class TaskSubmission(BaseModel):
    """A client-submitted task. NOTE: no identity field — the caller is the
    verified service principal; extra fields are rejected (strict schema)."""

    model_config = {"extra": "forbid"}

    schema_version: Literal["1.0"]
    task_type: str = Field(min_length=3, max_length=64, pattern=r"^[A-Z][A-Z0-9_]{2,63}$")
    skill_id: str = Field(pattern=r"^msk-\d{3}$")
    purpose: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = Field(min_length=8, max_length=128)
    budget: TaskBudget = Field(default_factory=TaskBudget)

    @model_validator(mode="after")
    def _bounds(self) -> "TaskSubmission":
        validate_payload(self.payload)
        encoded = len(self.model_dump_json(exclude={"payload"}).encode("utf-8"))
        if encoded + TASK_PAYLOAD_MAX_BYTES > 64 * 1024:
            raise ValueError("submission envelope exceeds the size cap")
        return self


class TaskRecord(BaseModel):
    model_config = {"validate_assignment": True}

    task_id: str
    schema_version: Literal["1.0"] = "1.0"
    task_type: str
    skill_id: str
    purpose: str
    """The VERIFIED owner (service identity) — the tenant boundary for all
    reads, updates and cancellations. Never client-supplied."""
    submitted_by: str = Field(min_length=1, max_length=32)
    status: TaskStatus
    budget: TaskBudget
    idempotency_key: str
    """The validated task payload — persisted so a worker can execute (and
    recover) the task after any restart. Bounded by the runtime validator;
    never copied into receipts, audit entries or responses."""
    payload: dict[str, Any] = Field(default_factory=dict)
    attempts: int = Field(ge=0, le=MAX_ATTEMPTS, default=0)
    max_attempts: int = Field(ge=1, le=MAX_ATTEMPTS, default=3)
    steps_used: int = 0
    tool_calls_used: int = 0
    created_at: float
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    next_attempt_at: Optional[float] = None
    trace_id: str = Field(default="", max_length=128)
    worker_id: Optional[str] = Field(default=None, max_length=64)
    result: Optional[TaskResult] = None
    refusal_reason: Optional[str] = Field(default=None, max_length=200)
    error_class: Optional[str] = Field(default=None, max_length=64)
    failure_class: Optional[FailureClass] = None
    cancel_requested: bool = False
    receipts: list[ExecutionReceipt] = Field(default_factory=list, max_length=MAX_RECEIPTS)

    @field_validator("submitted_by", mode="after")
    @classmethod
    def _owner_shape(cls, value: str) -> str:
        from .auth import CALLER_ID_PATTERN

        if not CALLER_ID_PATTERN.match(value):
            raise ValueError("task owner must be a verified caller id")
        return value

    @staticmethod
    def from_submission(submission: TaskSubmission, owner: str, trace_id: str = "") -> "TaskRecord":
        return TaskRecord(
            task_id=f"task-{uuid.uuid4().hex[:16]}",
            task_type=submission.task_type,
            skill_id=submission.skill_id,
            purpose=submission.purpose,
            submitted_by=owner,
            status=TaskStatus.SUBMITTED,
            budget=submission.budget,
            idempotency_key=submission.idempotency_key,
            payload=submission.payload,
            created_at=time.time(),
            trace_id=trace_id or f"hermes-{uuid.uuid4().hex[:12]}",
        )

    def transition(self, target: TaskStatus) -> None:
        assert_transition(self.status, target)
        self.status = target
        if target in TERMINAL_STATUSES and self.finished_at is None:
            self.finished_at = time.time()


class BudgetExceeded(RuntimeError):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class TaskCancelledCooperative(RuntimeError):
    """Raised by the budget's cancellation check when a running task was
    requested to cancel. Handlers that cooperate call `budget.check_cancel()`
    between steps; handlers that never check run to completion and keep their
    natural outcome (documented runtime limitation)."""

    def __init__(self, message: str = "TASK_CANCELLED"):
        super().__init__(message)


class TaskTimeout(TimeoutError):
    """The execution exceeded the task's time budget."""

    def __init__(self, message: str = "TASK_TIME_EXCEEDED"):
        super().__init__(message)
