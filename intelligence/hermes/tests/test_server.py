"""Control-plane server tests (FastAPI + httpx TestClient)."""

from pathlib import Path

from fastapi.testclient import TestClient

from hermes.backends import ScriptedBackend
from hermes.contracts import TaskResult
from hermes.server import create_app

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"


def make_client() -> TestClient:
    app = create_app(SKILLS_DIR)
    # Register one deterministic handler for the success-path tests. The
    # production control plane starts with an EMPTY backend (fail-closed):
    # executable task types arrive only through reviewed deployment code.
    app.state.backend.register(
        "ORIENT_PRODUCT_FACTS",
        lambda payload, budget: TaskResult(summary="Grounded from approved docs."),
    )
    return TestClient(app)


def submit(client: TestClient, **overrides):
    body = {
        "schema_version": "1.0",
        "task_type": "ORIENT_PRODUCT_FACTS",
        "skill_id": "msk-001",
        "purpose": "PLATFORM_HEALTH",
        "payload": {},
        "idempotency_key": "idem-server-0001",
        "submitted_by": "tests",
    }
    body.update(overrides)
    return client.post("/v1/tasks", json=body)


def test_healthz_and_version():
    client = make_client()
    health = client.get("/healthz").json()
    assert health == {"ok": True, "service": "mudaala-hermes", "version": "0.1.0"}
    version = client.get("/version").json()
    assert version["skills"] == ["msk-001", "msk-006"]
    assert version["backend"] == "scripted-v0"


def test_submit_and_read_task_roundtrip():
    client = make_client()
    response = submit(client)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "SUCCEEDED"

    record = client.get(f"/v1/tasks/{body['task_id']}").json()
    assert record["status"] == "SUCCEEDED"
    assert record["result"]["confidence"] is None
    assert record["steps_used"] >= 1


def test_idempotent_submission_returns_same_task_id():
    client = make_client()
    first = submit(client).json()
    second = submit(client).json()
    assert second["task_id"] == first["task_id"]
    assert second["status"] == "SUCCEEDED"


def test_unknown_skill_is_refused_through_the_api():
    client = make_client()
    response = submit(client, skill_id="msk-999")
    assert response.json()["status"] == "REFUSED"


def test_unknown_task_read_is_404():
    client = make_client()
    assert client.get("/v1/tasks/task-does-not-exist").status_code == 404


def test_submission_validation_errors_are_422():
    client = make_client()
    response = submit(client, skill_id="not-a-skill")
    assert response.status_code == 422
    response = submit(client, schema_version="2.0")
    assert response.status_code == 422


def test_default_backend_is_fail_closed():
    """Without registered handlers every valid task is REFUSED, never guessed."""
    app = create_app(SKILLS_DIR)
    client = TestClient(app)
    response = submit(client)
    assert response.json()["status"] == "REFUSED"
