"""Worker tests — claim/execute loop, recovery, graceful shutdown, DLQ."""

import time

from fastapi.testclient import TestClient

from hermes.auth import InMemoryNonceStore
from hermes.backends import ScriptedBackend
from hermes.budget import InMemoryAuditLog
from hermes.contracts import TaskRecord, TaskStatus, TaskSubmission
from hermes.server import create_app
from hermes.skills import SkillRegistry
from hermes.storage import MemoryTaskStore, canonical_payload
from hermes.worker import HermesWorker
from tests.helpers import COMMERCE, submission_body, test_callers
from pathlib import Path

SKILLS = Path(__file__).resolve().parent.parent / "skills"


def make_worker(store=None, handler=None):
    from hermes.router import TaskRouter

    store = store or MemoryTaskStore()
    backend = ScriptedBackend()
    if handler is not None:
        backend.register("ORIENT_PRODUCT_FACTS", handler)
    else:
        from hermes.handlers import orient_product_facts

        backend.register("ORIENT_PRODUCT_FACTS", orient_product_facts)
    router = TaskRouter(SkillRegistry(SKILLS), backend, InMemoryAuditLog(), store=store)
    return HermesWorker(store, router, worker_id="worker-test"), store, router


def staged_task(store, router, **overrides) -> TaskRecord:
    submission = TaskSubmission(**submission_body(**overrides))
    record = TaskRecord.from_submission(submission, owner=COMMERCE.caller_id, trace_id="hr-worker-12345678")
    store.create(record, canonical_payload(submission.payload))
    return router.route(record)


def test_worker_claims_and_completes_queued_tasks():
    worker, store, router = make_worker()
    record = staged_task(store, router)
    assert record.status is TaskStatus.QUEUED
    done_id = worker.run_once()
    assert done_id == record.task_id
    done = store.get(record.task_id)
    assert done.status is TaskStatus.SUCCEEDED
    assert done.worker_id == "worker-test"


def test_worker_loop_executes_submitted_tasks_and_stops_gracefully():
    worker, store, router = make_worker()
    worker.start()
    try:
        record = staged_task(store, router)
        deadline = time.time() + 5
        while time.time() < deadline:
            current = store.get(record.task_id)
            if current is not None and current.status in (TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.DEAD):
                break
            time.sleep(0.05)
        assert store.get(record.task_id).status is TaskStatus.SUCCEEDED
    finally:
        worker.stop(timeout=5)
    assert worker.is_running() is False


def test_worker_recovers_stale_running_tasks():
    worker, store, router = make_worker()
    record = staged_task(store, router)
    # Simulate a crashed worker: the task is RUNNING from long ago.
    claimed = store.claim_next("dead-worker-0", now=time.time() - 10_000)
    assert claimed is not None and claimed.status is TaskStatus.RUNNING
    recovered = worker.recover()
    assert recovered == 1
    recovered_record = store.get(record.task_id)
    assert recovered_record.status is TaskStatus.QUEUED  # requeued for retry
    assert recovered_record.attempts == 1


def test_permanent_failures_reach_the_dead_letter_queue_through_the_worker():
    worker, store, router = make_worker(handler=lambda p, b: (_ for _ in ()).throw(ValueError("permanent")))
    record = staged_task(store, router)
    done_id = worker.run_once()
    assert done_id == record.task_id
    dead = store.list_dead()
    assert len(dead) == 1
    assert dead[0].task_id == record.task_id
    assert dead[0].status is TaskStatus.DEAD


def test_worker_mode_app_executes_tasks_asynchronously():
    store = MemoryTaskStore()
    app = create_app(store=store, callers=test_callers(), nonces=InMemoryNonceStore(), run_worker=True)
    # Start the worker the way the lifespan does (TestClient doesn't run it here).
    app.state.worker.start()
    try:
        from tests.helpers import signed_json_request

        response = signed_json_request(TestClient(app), COMMERCE, "POST", "/v1/tasks", submission_body(idempotency_key="idem-async-0001"))
        assert response.status_code == 200
        task_id = response.json()["task_id"]
        assert response.json()["status"] == "QUEUED"  # async: returns before execution
        deadline = time.time() + 5
        while time.time() < deadline:
            current = store.get(task_id)
            if current is not None and current.status is TaskStatus.SUCCEEDED:
                break
            time.sleep(0.05)
        assert store.get(task_id).status is TaskStatus.SUCCEEDED
    finally:
        app.state.worker.stop(timeout=5)
