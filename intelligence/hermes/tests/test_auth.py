"""Service authentication tests — HMAC verification and identity derivation.

These are the negative tests demanded by the remediation: unauthenticated
access, forged identities, replays, malformed headers and clock skew must all
fail closed with stable error codes."""

import json
import time

import pytest

from hermes.auth import (
    CallerConfig,
    InMemoryNonceStore,
    parse_caller_registry,
    verify_service_auth,
)
from tests.helpers import ADMIN, COMMERCE, INTRUDER, sign_headers, test_callers

PATH = "/v1/tasks"
BODY = b'{"schema_version": "1.0"}'


def verify(caller: CallerConfig, **overrides):
    headers = overrides.pop("headers", None) or sign_headers(caller, "POST", PATH, BODY, **overrides)
    principal, failure = verify_service_auth(
        method="POST",
        path=PATH,
        body=BODY,
        headers=headers,
        callers=test_callers(),
        now_seconds=overrides.pop("now_seconds", None) or int(time.time()),
        nonces=InMemoryNonceStore(),
    )
    return principal, failure


def test_correctly_signed_request_yields_the_verified_principal():
    principal, failure = verify(COMMERCE)
    assert failure is None
    assert principal is not None
    assert principal.caller_id == "svc-commerce"
    assert principal.is_admin is False


def test_wrong_secret_fails_signature_verification():
    principal, failure = verify(INTRUDER)
    assert principal is None
    assert failure == "AUTH_BAD_SIGNATURE"


def test_tampered_body_fails_signature_verification():
    headers = sign_headers(COMMERCE, "POST", PATH, BODY)
    principal, failure = verify_service_auth(
        method="POST", path=PATH, body=b'{"tampered": true}', headers=headers, callers=test_callers()
    )
    assert principal is None
    assert failure == "AUTH_BAD_SIGNATURE"


def test_stale_timestamp_fails_clock_skew():
    principal, failure = verify(COMMERCE, timestamp=int(time.time()) - 1000)
    assert principal is None
    assert failure == "AUTH_CLOCK_SKEW"


def test_missing_headers_fail_closed():
    principal, failure = verify_service_auth(method="POST", path=PATH, body=BODY, headers={}, callers=test_callers())
    assert principal is None
    assert failure == "AUTH_MISSING"


def test_malformed_nonce_fails_without_echo():
    headers = sign_headers(COMMERCE, "POST", PATH, BODY, nonce="x" * 65)
    principal, failure = verify_service_auth(
        method="POST", path=PATH, body=BODY, headers=headers, callers=test_callers()
    )
    assert principal is None
    assert failure == "AUTH_MISSING"


def test_unknown_caller_fails_closed():
    principal, failure = verify(CallerConfig(caller_id="ghost", secret_id="k", secret="s"))
    assert principal is None
    assert failure == "AUTH_BAD_SIGNATURE"


def test_nonce_replay_is_rejected():
    store = InMemoryNonceStore()
    headers = sign_headers(COMMERCE, "POST", PATH, BODY, nonce="nonce-fixed-0001")
    first_principal, first_failure = verify_service_auth(
        method="POST", path=PATH, body=BODY, headers=dict(headers), callers=test_callers(), nonces=store
    )
    assert first_failure is None and first_principal is not None
    second_principal, second_failure = verify_service_auth(
        method="POST", path=PATH, body=BODY, headers=dict(headers), callers=test_callers(), nonces=store
    )
    assert second_principal is None
    assert second_failure == "AUTH_REPLAY"


def test_expired_nonces_are_consumable_again():
    clock = {"now": 1_000.0}
    store = InMemoryNonceStore(now=lambda: clock["now"])
    assert store.consume("n-1", COMMERCE.caller_id, 10) is False
    assert store.consume("n-1", COMMERCE.caller_id, 10) is True
    clock["now"] += 11
    assert store.consume("n-1", COMMERCE.caller_id, 10) is False  # expired → free again


def test_nonce_stores_are_caller_scoped():
    store = InMemoryNonceStore()
    # The same nonce string for two different callers never collides.
    assert store.consume("shared-nonce", COMMERCE.caller_id, 60) is False
    assert store.consume("shared-nonce", ADMIN.caller_id, 60) is False


def test_registry_parsing_and_validation():
    raw = json.dumps(
        {
            "svc-commerce": {"secret_id": "k", "secret": "s", "admin": False, "enabled": True},
            "svc-ops-admin": {"secret_id": "k2", "secret": "s2", "admin": True},
        }
    )
    callers = parse_caller_registry(raw)
    assert callers["svc-ops-admin"].admin is True
    assert callers["svc-commerce"].admin is False
    with pytest.raises(ValueError):
        parse_caller_registry("not json")
    with pytest.raises(ValueError):
        parse_caller_registry(json.dumps({"bad caller!": {"secret_id": "k", "secret": "s"}}))
    assert parse_caller_registry(None) == {}


def test_identity_cannot_come_from_the_request_body():
    """The submission contract rejects any client-supplied identity field."""
    from pydantic import ValidationError

    from hermes.contracts import TaskSubmission

    values = {
        "schema_version": "1.0",
        "task_type": "ORIENT_PRODUCT_FACTS",
        "skill_id": "msk-001",
        "purpose": "PLATFORM_HEALTH",
        "payload": {},
        "idempotency_key": "idem-00000001",
    }
    with pytest.raises(ValidationError):
        TaskSubmission(**{**values, "submitted_by": "someone-else"})


def test_admin_capability_is_explicit():
    principal, failure = verify(ADMIN)
    assert failure is None
    assert principal.is_admin is True
