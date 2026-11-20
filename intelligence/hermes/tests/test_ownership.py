"""Tenant-isolation tests — one service identity must never access another
merchant's tasks without explicit administrator authorisation."""

import pytest
from fastapi.testclient import TestClient

from hermes.auth import InMemoryNonceStore
from hermes.contracts import TaskRecord, TaskSubmission
from hermes.server import create_app
from hermes.storage import MemoryTaskStore, canonical_payload
from tests.helpers import ADMIN, COMMERCE, OTHER, sign_headers, signed_json_request, submission_body, test_callers


def make_client(**overrides):
    app = create_app(
        store=MemoryTaskStore(), callers=test_callers(), nonces=InMemoryNonceStore(), run_worker=False, **overrides
    )
    return TestClient(app)


def owned_task_id(client) -> str:
    response = signed_json_request(client, COMMERCE, "POST", "/v1/tasks", submission_body(idempotency_key="idem-owned-0001"))
    assert response.status_code == 200
    return response.json()["task_id"]


def test_foreign_task_read_is_indistinguishable_from_missing():
    client = make_client()
    task_id = owned_task_id(client)
    response = signed_json_request(client, OTHER, "GET", f"/v1/tasks/{task_id}", None)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "TASK_NOT_FOUND"
    # No existence leak: an unknown task id looks exactly the same.
    missing = signed_json_request(client, OTHER, "GET", "/v1/tasks/task-0000000000000000", None)
    assert missing.status_code == 404
    assert missing.json() == response.json()


def test_foreign_cancellation_is_rejected():
    client = make_client()
    task_id = owned_task_id(client)
    response = signed_json_request(client, OTHER, "POST", f"/v1/tasks/{task_id}/cancel", None)
    assert response.status_code == 404
    # The owner can still read and use the task.
    assert signed_json_request(client, COMMERCE, "GET", f"/v1/tasks/{task_id}", None).status_code == 200


def test_owner_can_cancel_own_queued_task():
    """Sync-mode submissions execute immediately; a QUEUED task is staged the
    way worker-mode deployments leave them (created + routed, not yet claimed)."""
    store = MemoryTaskStore()
    app = create_app(store=store, callers=test_callers(), nonces=InMemoryNonceStore(), run_worker=False)
    client = TestClient(app)
    submission = TaskSubmission(**submission_body(idempotency_key="idem-cancel-0001"))
    record = TaskRecord.from_submission(submission, owner="svc-commerce", trace_id="hr-cancel-12345678")
    store.create(record, canonical_payload(submission.payload))
    app.state.router.route(record)  # SUBMITTED → VALIDATED → QUEUED
    task_id = record.task_id
    response = signed_json_request(client, COMMERCE, "POST", f"/v1/tasks/{task_id}/cancel", None)
    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"


def test_cancelling_a_terminal_task_conflicts():
    client = make_client()
    task_id = owned_task_id(client)  # ran synchronously → SUCCEEDED (terminal)
    response = signed_json_request(client, COMMERCE, "POST", f"/v1/tasks/{task_id}/cancel", None)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "TASK_CONFLICT"


def test_administrator_read_is_explicitly_authorised():
    client = make_client()
    task_id = owned_task_id(client)
    response = signed_json_request(client, ADMIN, "GET", f"/v1/tasks/{task_id}", None)
    assert response.status_code == 200
    assert response.json()["submitted_by"] == "svc-commerce"


def signed_get(client, caller, path_with_query: str, sign_path: str):
    """GET with a query string: the HMAC canonical string covers the PATH only
    (query params are intentionally outside it, mirroring the gateway)."""
    headers = sign_headers(caller, "GET", sign_path, b"")
    return client.get(path_with_query, headers=headers)


def test_admin_all_tenant_listing_requires_the_capability():
    client = make_client()
    owned_task_id(client)
    denied = signed_get(client, OTHER, "/v1/tasks?all=true", "/v1/tasks")
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "SCOPE_DENIED"
    allowed = signed_get(client, ADMIN, "/v1/tasks?all=true", "/v1/tasks")
    assert allowed.status_code == 200
    assert any(record["submitted_by"] == "svc-commerce" for record in allowed.json())


def test_admin_endpoints_are_protected_separately():
    client = make_client()
    for method, path in (("GET", "/v1/admin/dead-letters"), ("POST", "/v1/admin/tasks/task-0000000000000000/requeue")):
        response = signed_json_request(client, COMMERCE, method, path, None)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "SCOPE_DENIED"
    ok = signed_json_request(client, ADMIN, "GET", "/v1/admin/dead-letters", None)
    assert ok.status_code == 200


def test_owner_listing_never_shows_other_tenants():
    client = make_client()
    owned_task_id(client)
    foreign = signed_json_request(client, OTHER, "GET", "/v1/tasks", None).json()
    assert all(record["submitted_by"] == "svc-other-tenant" for record in foreign)
    assert foreign == []
