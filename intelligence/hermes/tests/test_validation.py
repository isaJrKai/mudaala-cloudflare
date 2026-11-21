"""Runtime validation tests — the boundary annotations can't provide."""

import json

from fastapi.testclient import TestClient

from hermes.auth import InMemoryNonceStore
from hermes.server import create_app
from hermes.storage import MemoryTaskStore
from hermes.validation import (
    TASK_PAYLOAD_MAX_DEPTH,
    TASK_PAYLOAD_MAX_VALUES,
    validate_payload,
    validate_task_id,
    validate_trace_id,
)
from hermes.errors import HermesError
from tests.helpers import COMMERCE, signed_json_request, submission_body, test_callers
import pytest


def make_client():
    app = create_app(store=MemoryTaskStore(), callers=test_callers(), nonces=InMemoryNonceStore(), run_worker=False)
    return TestClient(app)


def test_payload_byte_bound():
    with pytest.raises(HermesError):
        validate_payload({"blob": "x" * 17_000})
    validate_payload({"blob": "x" * 1_000})  # under the cap: fine


def test_payload_depth_and_value_bounds():
    deep = current = {}
    for _ in range(TASK_PAYLOAD_MAX_DEPTH + 2):
        current["child"] = {}
        current = current["child"]
    with pytest.raises(HermesError):
        validate_payload(deep)
    with pytest.raises(HermesError):
        validate_payload([1] * (TASK_PAYLOAD_MAX_VALUES + 1))


def test_payload_string_bound():
    with pytest.raises(HermesError):
        validate_payload({"long": "y" * 2001})


def test_http_body_cap_is_413_and_payload_cap_maps_to_413():
    client = make_client()
    # 40 KB body → transport cap.
    response = signed_json_request(client, COMMERCE, "POST", "/v1/tasks", submission_body(payload={"blob": "x" * 40_000}))
    assert response.status_code == 413
    # 17 KB payload inside a small body → contract cap, same envelope code.
    response = signed_json_request(client, COMMERCE, "POST", "/v1/tasks", submission_body(payload={"blob": "x" * 17_000}))
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_task_id_validation_rejects_everything_unsafe():
    for bad in ["", "task-XYZ!", "../../etc/passwd", "task-123", "x" * 300, "task-0123456789abcdefg"]:
        with pytest.raises(HermesError):
            validate_task_id(bad)
    assert validate_task_id("task-0123456789abcdef") == "task-0123456789abcdef"


def test_trace_id_validation_replaces_malformed_values():
    with pytest.raises(HermesError):
        validate_trace_id("bad id with spaces")
    with pytest.raises(HermesError):
        validate_trace_id("x" * 129)
    assert validate_trace_id("commerce-trace-12345678") == "commerce-trace-12345678"


def test_non_object_body_is_rejected():
    client = make_client()
    response = signed_json_request(client, COMMERCE, "POST", "/v1/tasks", ["not", "an", "object"])
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "PAYLOAD_INVALID"


def test_unsafe_metadata_is_not_trusted():
    """Extra fields anywhere in the submission envelope are rejected."""
    client = make_client()
    body = submission_body()
    body["admin_override"] = True
    response = signed_json_request(client, COMMERCE, "POST", "/v1/tasks", body)
    assert response.status_code == 400
