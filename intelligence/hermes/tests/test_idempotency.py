"""Idempotency correctness tests — same payload replays, different payload
conflicts, concurrency safety, retention policy."""

import json
import threading

import pytest
from fastapi.testclient import TestClient

from hermes.auth import InMemoryNonceStore
from hermes.contracts import TaskRecord, TaskSubmission, TaskStatus
from hermes.server import create_app
from hermes.storage import IdempotencyConflict, MemoryTaskStore, canonical_payload
from tests.helpers import COMMERCE, signed_json_request, submission_body, test_callers


def make_record(**overrides) -> TaskRecord:
    submission = TaskSubmission(**submission_body(**overrides))
    return TaskRecord.from_submission(submission, owner="svc-commerce", trace_id="hr-idem-12345678")


def test_same_key_same_payload_returns_the_original():
    store = MemoryTaskStore()
    record = make_record()
    first, replay1 = store.create(record, canonical_payload(record.payload))
    second, replay2 = store.create(make_record(), canonical_payload(record.payload))
    assert replay1 is False and replay2 is True
    assert second.task_id == first.task_id


def test_same_key_reordered_payload_keys_is_a_replay_not_a_conflict():
    store = MemoryTaskStore()
    record = make_record(payload={"alpha": 1, "beta": [1, 2]})
    first, _ = store.create(record, canonical_payload(record.payload))
    reordered = make_record(payload={"beta": [1, 2], "alpha": 1})
    second, replay = store.create(reordered, canonical_payload(reordered.payload))
    assert replay is True
    assert second.task_id == first.task_id


def test_same_key_different_payload_conflicts():
    store = MemoryTaskStore()
    record = make_record()
    store.create(record, canonical_payload(record.payload))
    different = make_record(payload={"question": "different"})
    with pytest.raises(IdempotencyConflict):
        store.create(different, canonical_payload(different.payload))


def test_concurrent_creates_cannot_duplicate():
    store = MemoryTaskStore()
    canonical = canonical_payload({"question": "q"})
    results: list[tuple[str, bool]] = []
    errors: list[Exception] = []
    barrier = threading.Barrier(8)

    def worker():
        record = make_record()
        barrier.wait()
        try:
            created, replay = store.create(record, canonical)
            results.append((created.task_id, replay))
        except Exception as error:  # noqa: BLE001 — collected below
            errors.append(error)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    assert len({task_id for task_id, _ in results}) == 1
    assert sum(1 for _, replay in results if replay) == 7


def test_http_idempotency_same_payload_replays_and_conflicts_on_difference():
    store = MemoryTaskStore()
    app = create_app(store=store, callers=test_callers(), nonces=InMemoryNonceStore(), run_worker=False)
    client = TestClient(app)
    first = signed_json_request(client, COMMERCE, "POST", "/v1/tasks", submission_body(idempotency_key="idem-http-0001"))
    assert first.status_code == 200
    replay = signed_json_request(client, COMMERCE, "POST", "/v1/tasks", submission_body(idempotency_key="idem-http-0001"))
    assert replay.json()["task_id"] == first.json()["task_id"]
    conflict = signed_json_request(
        client, COMMERCE, "POST", "/v1/tasks", submission_body(idempotency_key="idem-http-0001", payload={"question": "changed"})
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_retention_sweeps_expired_finished_records_and_frees_keys():
    clock = {"now": 1_000.0}
    store = MemoryTaskStore(retention_seconds=100, now=lambda: clock["now"])
    record = make_record()
    created, _ = store.create(record, canonical_payload(record.payload))
    # Walk the real lifecycle: SUBMITTED → VALIDATED → QUEUED → RUNNING → SUCCEEDED.
    created.transition(TaskStatus.VALIDATED)
    created.transition(TaskStatus.QUEUED)
    created.transition(TaskStatus.RUNNING)
    created.transition(TaskStatus.SUCCEEDED)
    created.finished_at = clock["now"]
    store.save(created)
    clock["now"] += 101
    assert store.sweep_retention() == 1
    assert store.get(created.task_id) is None
    # The key is free: a fresh submission is a NEW task, not a stale replay.
    fresh, replay = store.create(make_record(), canonical_payload(record.payload))
    assert replay is False and fresh.task_id != created.task_id


def test_dead_records_survive_retention_until_admin_resolution():
    clock = {"now": 2_000.0}
    store = MemoryTaskStore(retention_seconds=100, now=lambda: clock["now"])
    record = make_record()
    created, _ = store.create(record, canonical_payload(record.payload))
    created.transition(TaskStatus.FAILED)  # validation/execution failure first
    created.transition(TaskStatus.DEAD)
    created.finished_at = clock["now"]
    store.save(created)
    clock["now"] += 10_000
    store.sweep_retention()
    assert store.get(created.task_id) is not None
    assert store.list_dead()[0].task_id == created.task_id
