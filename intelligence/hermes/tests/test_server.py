"""Control-plane server tests (FastAPI + signed service requests).

Every /v1 request here is HMAC-signed (helpers.sign_headers) — the API has
no unauthenticated task surface. Health/ready/version carry no data and stay
open."""

import json
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from hermes.auth import InMemoryNonceStore
from hermes.server import create_app
from hermes.storage import MemoryTaskStore
from tests.helpers import ADMIN, COMMERCE, INTRUDER, OTHER, sign_headers, signed_json_request, submission_body, test_callers

SKILLS_DIR = None  # default repository skills


def make_client(**app_overrides) -> TestClient:
    app = create_app(
        store=MemoryTaskStore(),
        callers=test_callers(),
        nonces=InMemoryNonceStore(),
        run_worker=False,
        **app_overrides,
    )
    return TestClient(app)


def client_and_store(**app_overrides):
    store = MemoryTaskStore()
    app = create_app(store=store, callers=test_callers(), nonces=InMemoryNonceStore(), run_worker=False, **app_overrides)
    return TestClient(app), store


def submit(client: TestClient, caller=COMMERCE, nonce=None, **overrides):
    return signed_json_request(client, caller, "POST", "/v1/tasks", submission_body(**overrides), nonce=nonce)


def test_healthz_readyz_and_version_are_open_and_data_free():
    client, _ = client_and_store()
    health = client.get("/healthz").json()
    assert health == {"ok": True, "service": "mudaala-hermes", "version": "0.2.0"}
    ready = client.get("/readyz").json()
    assert ready["ok"] is True
    version = client.get("/version").json()
    assert version["skills"] == ["msk-001", "msk-006"]
    assert version["backend"] == "scripted-v0"
    # Increment-1 skills are REGISTERED (remediation 4C), deterministic only.
    assert version["registered_task_types"] == ["ORIENT_PRODUCT_FACTS", "RUN_SEARCH_RELEVANCE_EVAL"]


def test_submit_and_read_task_roundtrip_is_signed_and_scoped():
    client, _ = client_and_store()
    response = submit(client)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "SUCCEEDED"  # registered handler runs deterministically

    record = signed_json_request(client, COMMERCE, "GET", f"/v1/tasks/{body['task_id']}", None).json()
    assert record["status"] == "SUCCEEDED"
    assert record["submitted_by"] == "svc-commerce"  # verified owner, not client-supplied
    assert record["result"]["confidence"] is None
    assert len(record["receipts"]) == 1


def test_idempotent_submission_returns_same_task_id():
    client, _ = client_and_store()
    first = submit(client, nonce="nonce-idem-0001").json()
    second = submit(client, nonce="nonce-idem-0002").json()
    assert second["task_id"] == first["task_id"]
    assert second["status"] == "SUCCEEDED"


def test_unauthenticated_request_is_rejected_with_stable_envelope():
    client, _ = client_and_store()
    body = json.dumps(submission_body()).encode()
    response = client.post("/v1/tasks", content=body, headers={"content-type": "application/json"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_MISSING"
    assert response.headers.get("x-hermes-trace-id")


def test_forged_signature_is_rejected():
    client, _ = client_and_store()
    body = json.dumps(submission_body()).encode()
    headers = sign_headers(COMMERCE, "POST", "/v1/tasks", body)
    headers["x-hermes-signature"] = "0" * 64
    response = client.post("/v1/tasks", content=body, headers=headers)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_BAD_SIGNATURE"


def test_stale_timestamp_is_rejected():
    client, _ = client_and_store()
    response = signed_json_request(
        client, COMMERCE, "POST", "/v1/tasks", submission_body(), timestamp=int(time.time()) - 1000
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_CLOCK_SKEW"


def test_nonce_replay_is_rejected_through_the_api():
    client, _ = client_and_store()
    first = submit(client, nonce="nonce-replay-fixed")
    assert first.status_code == 200
    second = submit(client, nonce="nonce-replay-fixed")
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "AUTH_REPLAY"


def test_client_supplied_identity_is_rejected():
    client, _ = client_and_store()
    body = submission_body(submitted_by="someone-else")
    response = signed_json_request(client, COMMERCE, "POST", "/v1/tasks", body)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "PAYLOAD_INVALID"


def test_oversized_body_is_rejected_413():
    client, _ = client_and_store()
    body = json.dumps(submission_body(payload={"blob": "x" * 40_000})).encode()
    response = signed_json_request(client, COMMERCE, "POST", "/v1/tasks", json.loads(body))
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_oversized_payload_within_body_cap_is_rejected_413():
    client, _ = client_and_store()
    response = submit(client, payload={"blob": "x" * 17_000})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_deeply_nested_payload_is_rejected_400():
    client, _ = client_and_store()
    nested = {"a": {"b": {"c": {"d": {"e": {"f": {"g": 1}}}}}}}
    response = submit(client, payload=nested)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "PAYLOAD_INVALID"


def test_malformed_json_body_is_rejected_400():
    client, _ = client_and_store()
    headers = sign_headers(COMMERCE, "POST", "/v1/tasks", b"{not json")
    response = client.post("/v1/tasks", content=b"{not json", headers=headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "PAYLOAD_INVALID"


def test_schema_validation_errors_use_the_stable_envelope():
    client, _ = client_and_store()
    response = submit(client, skill_id="not-a-skill")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "PAYLOAD_INVALID"
    response = submit(client, schema_version="2.0")
    assert response.status_code == 400


def test_unknown_skill_is_refused_through_the_api():
    client, _ = client_and_store()
    response = submit(client, skill_id="msk-999")
    assert response.status_code == 200
    assert response.json()["status"] == "REFUSED"


def test_unknown_task_read_is_404():
    client, _ = client_and_store()
    response = signed_json_request(client, COMMERCE, "GET", "/v1/tasks/task-0123456789abcdef", None)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "TASK_NOT_FOUND"


def test_malformed_task_id_is_404_not_an_error_leak():
    client, _ = client_and_store()
    for bad in ["../../etc/passwd", "task-XYZ", "x" * 200]:
        response = signed_json_request(client, COMMERCE, "GET", f"/v1/tasks/{bad}", None)
        assert response.status_code == 404


def test_validation_failure_hides_schema_details():
    client, _ = client_and_store()
    response = submit(client, skill_id="not-a-skill")
    message = response.json()["error"]["message"]
    assert "skill_id" not in message  # no field-level schema echo


def test_default_backend_is_fail_closed_when_skill_registration_is_disabled():
    """Without registered handlers every valid task is REFUSED, never guessed.
    (Production registers the reviewed Increment-1 skills — see test_healthz.)"""
    client, _ = client_and_store(register_default_skills=False)
    response = submit(client)
    assert response.json()["status"] == "REFUSED"
    assert response.json()["refusal_reason"] == "REFUSED_NO_BACKEND_HANDLER"


def test_owner_task_listing_is_scoped():
    client, _ = client_and_store()
    submit(client, idempotency_key="idem-list-0001")
    mine = signed_json_request(client, COMMERCE, "GET", "/v1/tasks", None).json()
    assert len(mine) == 1
    assert mine[0]["submitted_by"] == "svc-commerce"


# ---------------------------------------------------------------------------
# Round-2 remediation (reviewer finding 1): the durable stack is wired from
# the environment, with EXPLICIT configuration validation. Injection (used
# by the tests above) always wins over the environment.
# ---------------------------------------------------------------------------


def test_injected_store_reports_injected_storage_mode():
    client, _ = client_and_store()
    assert client.get("/version").json()["storage"] == "injected"


def test_missing_database_url_starts_ephemeral_and_announces_it(monkeypatch):
    """No HERMES_DATABASE_URL → Hermes still starts (the commerce plane must
    keep working without the intelligence infrastructure) — but honestly:
    memory-ephemeral mode, announced on /version."""
    monkeypatch.delenv("HERMES_DATABASE_URL", raising=False)
    app = create_app(callers=test_callers(), run_worker=False)
    client = TestClient(app)
    assert client.get("/version").json()["storage"] == "memory-ephemeral"
    response = submit(client)
    assert response.status_code == 200  # fully functional, state is ephemeral


def test_malformed_database_url_fails_startup(monkeypatch):
    """A malformed URL is a configuration error — never a silent degradation
    into memory state."""
    monkeypatch.setenv("HERMES_DATABASE_URL", "mysql://user:pass@localhost/db")
    with pytest.raises(RuntimeError, match="postgres://"):
        create_app(callers=test_callers(), run_worker=False)


def test_malformed_admin_database_url_fails_startup(monkeypatch):
    monkeypatch.setenv("HERMES_DATABASE_URL", "postgres://user:pass@127.0.0.1:9/db")
    monkeypatch.setenv("HERMES_ADMIN_DATABASE_URL", "not-a-database-url")
    with pytest.raises(RuntimeError, match="HERMES_ADMIN_DATABASE_URL"):
        create_app(callers=test_callers(), run_worker=False)


def test_unreachable_database_url_fails_startup_fast(monkeypatch):
    """A valid-looking URL pointing at a dead database also fails startup —
    the app must never come up believing it is durable when it is not."""
    monkeypatch.setenv("HERMES_DATABASE_URL", "postgres://postgres:postgres@127.0.0.1:9/hermes_test")
    with pytest.raises(RuntimeError, match="durable Hermes storage stack"):
        create_app(callers=test_callers(), run_worker=False)
