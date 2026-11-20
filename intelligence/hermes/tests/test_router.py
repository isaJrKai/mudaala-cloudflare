"""Router tests — governance flow, budget refusals, audit hygiene."""

from pathlib import Path

from hermes.backends import ScriptedBackend
from hermes.budget import BudgetExceeded, BudgetState, InMemoryAuditLog
from hermes.contracts import TaskRecord, TaskResult, TaskStatus, TaskSubmission
from hermes.router import (
    REFUSAL_NO_HANDLER,
    REFUSAL_NO_SKILL,
    REFUSAL_TASK_TYPE_MISMATCH,
    REFUSAL_UNKNOWN_SKILL,
    TaskRouter,
)
from hermes.skills import SkillRegistry

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"


def make_submission(**overrides):
    values = {
        "schema_version": "1.0",
        "task_type": "ORIENT_PRODUCT_FACTS",
        "skill_id": "msk-001",
        "purpose": "PLATFORM_HEALTH",
        "payload": {"question": "what is mudaala"},
        "idempotency_key": "idem-0001",
        "submitted_by": "tests",
    }
    values.update(overrides)
    return TaskSubmission(**values)


def make_router(handler=None):
    backend = ScriptedBackend()
    if handler is not None:
        backend.register("ORIENT_PRODUCT_FACTS", handler)
    audit = InMemoryAuditLog()
    router = TaskRouter(SkillRegistry(SKILLS_DIR), backend, audit)
    return router, backend, audit


def test_successful_task_goes_through_governance():
    def handler(payload, budget):
        # The router itself counts the execution as one step; multi-step
        # handlers call budget.begin_step() for each additional step.
        return TaskResult(summary="Grounded answer from approved docs.", reason_codes=["SOURCE:masterplan"])

    router, backend, audit = make_router(handler)
    submission = make_submission()
    record = router.route(submission, TaskRecord.from_submission(submission))
    assert record.status is TaskStatus.SUCCEEDED
    assert record.result is not None
    assert record.result.confidence is None  # no calibrated confidence in v0
    assert record.steps_used == 1
    assert audit.entries[0]["event"] == "task_succeeded"
    # Audit hygiene: payload contents never appear in the audit log.
    assert all("question" not in entry for entry in audit.entries)


def test_unknown_skill_is_refused_and_audited():
    router, _, audit = make_router(lambda p, b: TaskResult(summary="x"))
    submission = make_submission(skill_id="msk-999")
    record = router.route(submission, TaskRecord.from_submission(submission))
    assert record.status is TaskStatus.REFUSED
    assert record.refusal_reason == REFUSAL_UNKNOWN_SKILL
    assert audit.entries[0]["event"] == "task_refused"


def test_task_type_not_declared_by_skill_is_refused():
    router, _, _ = make_router(lambda p, b: TaskResult(summary="x"))
    submission = make_submission(task_type="SOMETHING_ELSE")
    record = router.route(submission, TaskRecord.from_submission(submission))
    assert record.status is TaskStatus.REFUSED
    assert record.refusal_reason == REFUSAL_TASK_TYPE_MISMATCH


def test_missing_backend_handler_is_refused():
    router, backend, _ = make_router()  # no handler registered — fail-closed default
    submission = make_submission()
    record = router.route(submission, TaskRecord.from_submission(submission))
    assert record.status is TaskStatus.REFUSED
    assert record.refusal_reason == REFUSAL_NO_HANDLER
    assert backend.handles("ORIENT_PRODUCT_FACTS") is False


def test_budget_steps_exhaustion_refuses_the_task():
    def greedy_handler(payload, budget):
        while True:
            budget.begin_step()

    router, _, _ = make_router(greedy_handler)
    submission = make_submission()
    record = router.route(submission, TaskRecord.from_submission(submission))
    assert record.status is TaskStatus.REFUSED
    assert record.refusal_reason == "BUDGET_STEPS_EXCEEDED"
    assert record.steps_used == record.budget.max_steps


def test_budget_state_raises_on_tool_and_step_overflow():
    budget = BudgetState(max_steps=1, max_seconds=60, max_tool_calls=1)
    budget.begin_step()
    with __import__("pytest").raises(BudgetExceeded):
        budget.begin_step()
    budget.begin_tool_call()
    with __import__("pytest").raises(BudgetExceeded):
        budget.begin_tool_call()


def test_handler_exception_becomes_audited_failure_not_a_crash():
    def broken_handler(payload, budget):
        raise RuntimeError("boom")

    router, _, audit = make_router(broken_handler)
    submission = make_submission()
    record = router.route(submission, TaskRecord.from_submission(submission))
    assert record.status is TaskStatus.FAILED
    assert audit.entries[0]["event"] == "task_failed"
    assert audit.entries[0]["error_class"] == "RuntimeError"


def test_draft_skill_status_is_not_routable(tmp_path):
    """A copy of msk-001 with status 'draft' must be refused (manifest-driven)."""
    import json
    import shutil

    source = SKILLS_DIR / "msk-001-product-policy-orientation"
    target = tmp_path / "msk-002-draft"
    target.mkdir()
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    manifest["id"] = "msk-002"
    manifest["status"] = "draft"
    (target / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    shutil.copy(source / "SKILL.md", target / "SKILL.md")

    registry = SkillRegistry(tmp_path)
    backend = ScriptedBackend()
    backend.register("ORIENT_PRODUCT_FACTS", lambda p, b: TaskResult(summary="x"))
    router = TaskRouter(registry, backend, InMemoryAuditLog())
    submission = make_submission(skill_id="msk-002")
    record = router.route(submission, TaskRecord.from_submission(submission))
    assert record.status is TaskStatus.REFUSED
    assert record.refusal_reason == REFUSAL_NO_SKILL
