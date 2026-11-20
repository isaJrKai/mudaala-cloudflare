"""Contract tests — budget caps, lifecycle transitions, honesty invariants."""

import pytest
from pydantic import ValidationError

from hermes.errors import HermesError
from hermes.contracts import (
    JOB_BUDGET_CAPS,
    MAX_ATTEMPTS,
    TRANSITIONS,
    FailureClass,
    TaskBudget,
    TaskRecord,
    TaskStatus,
    TaskSubmission,
    classify_failure,
    retry_delay_seconds,
)


def base_submission(**overrides):
    values = {
        "schema_version": "1.0",
        "task_type": "ORIENT_PRODUCT_FACTS",
        "skill_id": "msk-001",
        "purpose": "PLATFORM_HEALTH",
        "payload": {"question": "what is mudaala"},
        "idempotency_key": "idem-00000001",
    }
    values.update(overrides)
    return values


def test_budget_caps_are_enforced_by_the_contract():
    assert JOB_BUDGET_CAPS["max_steps"] == 12
    with pytest.raises(ValidationError):
        TaskBudget(max_steps=JOB_BUDGET_CAPS["max_steps"] + 1)
    with pytest.raises(ValidationError):
        TaskBudget(max_seconds=JOB_BUDGET_CAPS["max_seconds"] + 1)
    with pytest.raises(ValidationError):
        TaskBudget(max_tool_calls=JOB_BUDGET_CAPS["max_tool_calls"] + 1)


def test_model_token_spend_is_locked_at_zero_until_a_provider_is_reviewed():
    with pytest.raises(ValidationError):
        TaskBudget(max_model_tokens=1)
    assert TaskBudget().max_model_tokens == 0


def test_skill_id_format_is_enforced():
    with pytest.raises(ValidationError):
        TaskSubmission(**base_submission(skill_id="msk-9999"))
    with pytest.raises(ValidationError):
        TaskSubmission(**base_submission(skill_id="skill-one"))


def test_submission_is_strict_no_extra_fields_no_identity():
    """extra='forbid': unknown fields — including a client-supplied identity —
    are rejected at parse time."""
    with pytest.raises(ValidationError):
        TaskSubmission(**base_submission(submitted_by="forged-identity"))
    with pytest.raises(ValidationError):
        TaskSubmission(**base_submission(unexpected="value"))


def test_task_type_is_strictly_shaped():
    with pytest.raises(ValidationError):
        TaskSubmission(**base_submission(task_type="lowercase type"))
    with pytest.raises(ValidationError):
        TaskSubmission(**base_submission(task_type="x" * 65))


def test_payload_bounds_are_runtime_enforced_not_annotation_only():
    # Payload bound violations surface as stable HermesError codes (they are
    # runtime boundary failures, not type errors).
    with pytest.raises(HermesError):
        TaskSubmission(**base_submission(payload={"blob": "x" * (17 * 1024)}))  # > 16 KiB
    with pytest.raises(HermesError):
        TaskSubmission(**base_submission(payload={"a": {"b": {"c": {"d": {"e": {"f": {"g": 1}}}}}}}))  # depth 7
    with pytest.raises(HermesError):
        TaskSubmission(**base_submission(payload={"list": [1] * 201}))  # > 200 values
    with pytest.raises(HermesError):
        TaskSubmission(**base_submission(payload={"long": "y" * 2001}))  # > 2000 chars


def test_owner_is_a_verified_caller_shape():
    submission = TaskSubmission(**base_submission())
    with pytest.raises(ValidationError):
        TaskRecord.from_submission(submission, owner="bad owner with spaces!")
    record = TaskRecord.from_submission(submission, owner="svc-commerce")
    assert record.submitted_by == "svc-commerce"
    assert record.payload == submission.payload


def test_lifecycle_transitions_are_exactly_the_documented_set():
    assert TaskStatus.VALIDATED in TRANSITIONS[TaskStatus.SUBMITTED]
    assert TaskStatus.QUEUED in TRANSITIONS[TaskStatus.VALIDATED]
    assert TaskStatus.RUNNING in TRANSITIONS[TaskStatus.QUEUED]
    assert TaskStatus.SUCCEEDED in TRANSITIONS[TaskStatus.RUNNING]
    assert TaskStatus.FAILED in TRANSITIONS[TaskStatus.RUNNING]
    assert TaskStatus.CANCELLED in TRANSITIONS[TaskStatus.QUEUED]
    assert TaskStatus.QUEUED in TRANSITIONS[TaskStatus.FAILED]  # retry
    assert TaskStatus.DEAD in TRANSITIONS[TaskStatus.FAILED]
    assert len(TRANSITIONS[TaskStatus.SUCCEEDED]) == 0
    # Illegal jumps throw.
    record = TaskRecord.from_submission(TaskSubmission(**base_submission()), owner="svc-commerce")
    with pytest.raises(ValueError):
        record.transition(TaskStatus.RUNNING)  # SUBMITTED → RUNNING is not legal


def test_failure_classification_drives_retry_policy():
    assert classify_failure("TaskTimeout") is FailureClass.TRANSIENT
    assert classify_failure("WorkerRecovery") is FailureClass.TRANSIENT
    assert classify_failure("BudgetExceeded") is FailureClass.PERMANENT
    assert classify_failure("ValueError") is FailureClass.PERMANENT


def test_retry_backoff_is_bounded():
    for attempt in range(10):
        delay = retry_delay_seconds(attempt)
        assert 0 < delay <= 60 * 1.25 + 1


def test_attempts_are_capped_by_the_contract():
    assert MAX_ATTEMPTS == 5
    submission = TaskSubmission(**base_submission())
    record = TaskRecord.from_submission(submission, owner="svc-commerce")
    with pytest.raises(ValidationError):
        record.max_attempts = MAX_ATTEMPTS + 1
