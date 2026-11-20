"""Router tests — governance flow, budget refusals, audit hygiene.

The router API (remediated): `route(record)` runs the governance chain
(SUBMITTED → VALIDATED → QUEUED or REFUSED); `execute(record)` runs one
attempt with receipts, failure classification and retry scheduling."""

from pathlib import Path

from hermes.backends import ScriptedBackend
from hermes.budget import InMemoryAuditLog
from hermes.contracts import TaskRecord, TaskResult, TaskStatus, TaskSubmission
from hermes.router import (
    REFUSAL_NO_HANDLER,
    REFUSAL_NO_SKILL,
    REFUSAL_TASK_TYPE_MISMATCH,
    REFUSAL_UNKNOWN_SKILL,
    TaskRouter,
)
from hermes.skills import SkillRegistry
from hermes.storage import MemoryTaskStore

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"


def make_submission(**overrides):
    values = {
        "schema_version": "1.0",
        "task_type": "ORIENT_PRODUCT_FACTS",
        "skill_id": "msk-001",
        "purpose": "PLATFORM_HEALTH",
        "payload": {"question": "what is mudaala"},
        "idempotency_key": "idem-00000001",
    }
    values.update(overrides)
    return TaskSubmission(**values)


def make_record(**overrides) -> TaskRecord:
    return TaskRecord.from_submission(make_submission(**overrides), owner="svc-commerce", trace_id="hr-test-00000001")


def make_router(handler=None, store=None):
    backend = ScriptedBackend()
    if handler is not None:
        backend.register("ORIENT_PRODUCT_FACTS", handler)
    audit = InMemoryAuditLog()
    router = TaskRouter(SkillRegistry(SKILLS_DIR), backend, audit, store=store)
    return router, backend, audit


def test_successful_task_walks_the_full_lifecycle_and_writes_a_receipt():
    router, _, audit = make_router(lambda p, b: TaskResult(summary="Grounded answer.", reason_codes=["SOURCE:doc"]))
    record = router.route(make_record())
    assert record.status is TaskStatus.QUEUED
    record = router.execute(record)
    assert record.status is TaskStatus.SUCCEEDED
    assert record.result is not None
    assert record.result.confidence is None  # no calibrated confidence in v0
    assert record.steps_used == 1
    assert record.attempts == 1
    assert len(record.receipts) == 1
    assert record.receipts[0].outcome == "SUCCEEDED"
    assert record.receipts[0].attempt == 1
    assert record.receipts[0].trace_id == "hr-test-00000001"
    assert audit.entries[0]["event"] == "task_succeeded"
    # Audit hygiene: payload contents never appear in the audit log.
    assert all("question" not in entry for entry in audit.entries)


def test_unknown_skill_is_refused_and_audited():
    router, _, audit = make_router(lambda p, b: TaskResult(summary="x"))
    record = router.route(make_record(skill_id="msk-999"))
    assert record.status is TaskStatus.REFUSED
    assert record.refusal_reason == REFUSAL_UNKNOWN_SKILL
    assert audit.entries[0]["event"] == "task_refused"


def test_task_type_not_declared_by_skill_is_refused():
    router, _, _ = make_router(lambda p, b: TaskResult(summary="x"))
    record = router.route(make_record(task_type="SOMETHING_ELSE"))
    assert record.status is TaskStatus.REFUSED
    assert record.refusal_reason == REFUSAL_TASK_TYPE_MISMATCH


def test_missing_backend_handler_is_refused():
    router, backend, _ = make_router()  # no handler registered — fail-closed default
    record = router.route(make_record())
    assert record.status is TaskStatus.REFUSED
    assert record.refusal_reason == REFUSAL_NO_HANDLER
    assert backend.handles("ORIENT_PRODUCT_FACTS") is False


def test_budget_steps_exhaustion_refuses_the_task():
    def greedy_handler(payload, budget):
        while True:
            budget.begin_step()

    router, _, _ = make_router(greedy_handler)
    record = router.route(make_record())
    record = router.execute(record)
    assert record.status is TaskStatus.REFUSED
    assert record.refusal_reason == "BUDGET_STEPS_EXCEEDED"
    assert record.steps_used == record.budget.max_steps


def test_handler_exception_becomes_audited_permanent_failure_dead_lettered_with_store():
    def broken_handler(payload, budget):
        raise RuntimeError("boom")

    store = MemoryTaskStore()
    router, _, audit = make_router(broken_handler, store=store)
    record = make_record()
    store.create(record, '{"q":1}')
    record = router.route(record)
    record = router.execute(record)
    assert record.status is TaskStatus.DEAD  # permanent failure → dead-letter
    assert record.error_class == "RuntimeError"
    assert record.failure_class is not None and record.failure_class.value == "PERMANENT"
    assert record.receipts[0].outcome == "FAILED"
    assert audit.entries[0]["event"] == "task_failed"
    # The store holds the dead record for the admin duty cycle.
    assert store.get(record.task_id).status is TaskStatus.DEAD


def test_transient_timeout_is_retried_then_dead_after_max_attempts():
    def slow_handler(payload, budget):
        import time

        time.sleep(1.5)  # exceeds the 1-second task budget

    store = MemoryTaskStore()
    router, _, _ = make_router(slow_handler, store=store)
    record = make_record()
    record.budget.max_seconds = 1
    record.max_attempts = 1
    store.create(record, '{}')
    record = router.route(record)
    record = router.execute(record)
    assert record.status is TaskStatus.DEAD  # transient, but attempts exhausted (max_attempts=1)
    assert record.error_class == "TaskTimeout"
    assert record.receipts[0].outcome == "TIMEOUT"
    assert record.failure_class.value == "TRANSIENT"


def test_permanent_failure_skips_retries_straight_to_dead():
    def failing_handler(payload, budget):
        raise ValueError("permanent")

    store = MemoryTaskStore()
    router, _, _ = make_router(failing_handler, store=store)
    record = make_record()
    record.max_attempts = 3
    store.create(record, '{}')
    record = router.route(record)
    record = router.execute(record)
    assert record.status is TaskStatus.DEAD
    assert record.attempts == 1  # no retry churn for permanent failures


def test_transient_failure_with_remaining_attempts_requeues():
    def transient_handler(payload, budget):
        raise TimeoutError("flaky backend")  # TimeoutError classifies TRANSIENT

    store = MemoryTaskStore()
    router, _, _ = make_router(transient_handler, store=store)
    record = make_record()
    record.max_attempts = 3
    store.create(record, '{}')
    record = router.route(record)
    record = router.execute(record)
    assert record.status is TaskStatus.QUEUED
    assert record.attempts == 1
    assert record.next_attempt_at is not None and record.next_attempt_at > record.created_at


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
    record = make_record(skill_id="msk-002")
    record = router.route(record)
    assert record.status is TaskStatus.REFUSED
    assert record.refusal_reason == REFUSAL_NO_SKILL


def test_routing_without_a_store_leaves_the_record_unsaved_but_valid():
    router, _, _ = make_router(lambda p, b: TaskResult(summary="x"))
    record = router.route(make_record())
    assert record.status is TaskStatus.QUEUED
    record = router.execute(record)
    assert record.status is TaskStatus.SUCCEEDED
