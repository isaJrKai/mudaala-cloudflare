"""Contract tests — budget caps and honesty invariants."""

import pytest
from pydantic import ValidationError

from hermes.contracts import JOB_BUDGET_CAPS, TaskBudget, TaskSubmission


def base_submission(**overrides):
    values = {
        "schema_version": "1.0",
        "task_type": "ORIENT_PRODUCT_FACTS",
        "skill_id": "msk-001",
        "purpose": "PLATFORM_HEALTH",
        "payload": {},
        "idempotency_key": "idem-0001",
        "submitted_by": "tests",
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


def test_model_token_spend_is_locked_at_zero_in_v0():
    """No LLM backend is wired in v0 — the contract makes silent spend impossible."""
    with pytest.raises(ValidationError):
        TaskBudget(max_model_tokens=1)
    assert TaskBudget().max_model_tokens == 0


def test_skill_id_format_is_enforced():
    with pytest.raises(ValidationError):
        TaskSubmission(**base_submission(skill_id="msk-9999"))
    with pytest.raises(ValidationError):
        TaskSubmission(**base_submission(skill_id="skill-one"))
