"""Shared test helpers — signed service requests against the Hermes API."""

from __future__ import annotations

import time
import uuid

from hermes.auth import CallerConfig, build_canonical_string, hmac_sha256_hex, sha256_hex

COMMERCE = CallerConfig(
    caller_id="svc-commerce",
    secret_id="key-2026-11",
    secret="test-secret-commerce-do-not-use",
    admin=False,
    enabled=True,
)
ADMIN = CallerConfig(
    caller_id="svc-ops-admin",
    secret_id="key-2026-11",
    secret="test-secret-admin-do-not-use",
    admin=True,
    enabled=True,
)
INTRUDER = CallerConfig(
    caller_id="svc-commerce",  # impersonates a real caller id…
    secret_id="key-2026-11",
    secret="attacker-secret",  # …but holds a secret it does not own
    admin=False,
    enabled=True,
)


OTHER = CallerConfig(
    caller_id="svc-other-tenant",
    secret_id="key-2026-11",
    secret="test-secret-other-do-not-use",
    admin=False,
    enabled=True,
)


def test_callers() -> dict[str, CallerConfig]:
    # INTRUDER is deliberately NOT registered: it impersonates svc-commerce
    # with a secret it does not own, so verification must reject it.
    return {c.caller_id: c for c in (COMMERCE, ADMIN, OTHER)}


def sign_headers(
    caller: CallerConfig,
    method: str,
    path: str,
    body: bytes,
    timestamp: int | None = None,
    nonce: str | None = None,
) -> dict[str, str]:
    timestamp = str(int(time.time())) if timestamp is None else str(timestamp)
    nonce = nonce or f"nonce-{uuid.uuid4().hex[:12]}"
    canonical = build_canonical_string(
        {
            "caller_id": caller.caller_id,
            "secret_id": caller.secret_id,
            "method": method,
            "path": path,
            "timestamp": timestamp,
            "body_hash": sha256_hex(body),
        }
    )
    signature = hmac_sha256_hex(caller.secret, canonical)
    return {
        "x-hermes-caller": caller.caller_id,
        "x-hermes-secret-id": caller.secret_id,
        "x-hermes-timestamp": timestamp,
        "x-hermes-nonce": nonce,
        "x-hermes-signature": signature,
    }


def submission_body(**overrides) -> dict:
    values = {
        "schema_version": "1.0",
        "task_type": "ORIENT_PRODUCT_FACTS",
        "skill_id": "msk-001",
        "purpose": "PLATFORM_HEALTH",
        "payload": {
            "question": "what is mudaala",
            "doc_refs": [{"ref": "masterplan-section-1", "excerpt": "Mudaala is a Ugandan commerce marketplace."}],
        },
        "idempotency_key": "idem-00000001",
    }
    values.update(overrides)
    return values


def signed_json_request(client, caller: CallerConfig, method: str, path: str, json_body: dict | None, **sign_kwargs):
    """Send a correctly signed request. Returns the TestClient response."""
    import json as _json

    body = _json.dumps(json_body).encode("utf-8") if json_body is not None else b""
    headers = sign_headers(caller, method, path, body, **sign_kwargs)
    return client.request(method, path, content=body, headers=headers)
