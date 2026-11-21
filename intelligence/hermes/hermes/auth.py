"""Hermes service-to-service authentication (HMAC, mirrors the gateway).

Scheme (same canonical form as `intelligence/gateway/src/auth.ts`, ADR-0002):

    canonical  = callerId \\n secretId \\n METHOD \\n /path \\n timestampSeconds \\n sha256Hex(body)
    signature  = hex(HMAC-SHA256(secret, canonical))

Headers: x-hermes-caller, x-hermes-secret-id, x-hermes-timestamp,
x-hermes-nonce, x-hermes-signature, optional x-hermes-trace-id.

Caller identity is ONLY ever derived from this verified signature. The
request body carries no identity — `submitted_by` is not accepted from
clients; the verified caller id becomes the task owner (tenant boundary).

Registry: the HERMES_CALLERS env var (JSON map keyed by callerId):
    { "<callerId>": { "secret_id": "...", "secret": "...", "admin": false,
                      "enabled": true } }
Secrets are provisioned by the operator, never committed. `admin: true`
grants the explicitly-authorised administrator operations (cross-owner
reads, dead-letter management) — it is a separate, auditable capability.

Nonce replay protection uses a caller-scoped, TTL-bounded nonce cache
(in-process for single-replica deployments; the durable Postgres store
implements the same consume atomically across replicas via a unique
insert — see postgres_store.py).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from dataclasses import dataclass
from typing import Callable, Optional, Protocol

CLOCK_SKEW_SECONDS = 90
NONCE_TTL_SECONDS = 180
DEFAULT_NONCE_TTL_SECONDS = 180

CALLER_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@-]{0,31}$")
NONCE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@:-]{1,63}$")
SIGNATURE_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")
TIMESTAMP_PATTERN = re.compile(r"^\d{1,13}$")

AUTH_HEADER_NAMES = (
    "x-hermes-caller",
    "x-hermes-secret-id",
    "x-hermes-timestamp",
    "x-hermes-nonce",
    "x-hermes-signature",
)


@dataclass(frozen=True)
class CallerConfig:
    caller_id: str
    secret_id: str
    secret: str
    admin: bool = False
    enabled: bool = True


@dataclass(frozen=True)
class CallerPrincipal:
    """The verified identity. Constructed ONLY after successful signature
    verification — never from request fields."""

    caller_id: str
    admin: bool

    @property
    def is_admin(self) -> bool:
        return self.admin


class NonceStore(Protocol):
    """Atomic check-and-record; returns True when the nonce was already used."""

    def consume(self, nonce: str, caller_id: str, ttl_seconds: int) -> bool: ...


class InMemoryNonceStore:
    """Single-process nonce store. Thread-safe: the check-and-set happens
    under one lock, so two concurrent requests can never both pass."""

    def __init__(self, now: Optional[Callable[[], float]] = None) -> None:
        import threading

        self._lock = threading.Lock()
        self._entries: dict[str, float] = {}
        self._now = now or time.time

    def consume(self, nonce: str, caller_id: str, ttl_seconds: int) -> bool:
        key = f"{caller_id}\x00{nonce}"
        now = self._now()
        with self._lock:
            # GC expired entries (bounded storage).
            for k, expires_at in list(self._entries.items()):
                if expires_at <= now:
                    del self._entries[k]
            expires_at = self._entries.get(key)
            if expires_at is not None and expires_at > now:
                return True
            self._entries[key] = now + ttl_seconds
            return False


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hmac_sha256_hex(secret: str, message: str) -> str:
    return hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def timing_safe_equal_hex(a: str, b: str) -> bool:
    return hmac.compare_digest(a.lower().encode("utf-8"), b.lower().encode("utf-8"))


def build_canonical_string(parts: dict) -> str:
    return "\n".join(
        [parts["caller_id"], parts["secret_id"], parts["method"], parts["path"], parts["timestamp"], parts["body_hash"]]
    )


def verify_service_auth(
    method: str,
    path: str,
    body: bytes,
    headers: "dict[str, str]",
    callers: "dict[str, CallerConfig]",
    now_seconds: Optional[int] = None,
    nonces: Optional[NonceStore] = None,
) -> "tuple[CallerPrincipal | None, str | None]":
    """Verify HMAC service auth. Returns (principal, None) on success or
    (None, error_code) on failure. Error codes match the stable envelope
    (AUTH_MISSING / AUTH_BAD_SIGNATURE / AUTH_CLOCK_SKEW / AUTH_REPLAY)."""

    now_seconds = int(time.time()) if now_seconds is None else now_seconds

    values = {name: headers.get(name) for name in AUTH_HEADER_NAMES}
    missing = [name for name, value in values.items() if not value]
    if missing:
        return None, "AUTH_MISSING"

    caller_id = values["x-hermes-caller"]
    secret_id = values["x-hermes-secret-id"]
    timestamp = values["x-hermes-timestamp"]
    nonce = values["x-hermes-nonce"]
    signature = values["x-hermes-signature"]

    # Malformed values fail closed, exactly like missing ones. Values are
    # never echoed back (no log/header injection surface).
    if (
        not CALLER_ID_PATTERN.match(caller_id)
        or not CALLER_ID_PATTERN.match(secret_id)
        or not TIMESTAMP_PATTERN.match(timestamp)
        or not NONCE_PATTERN.match(nonce)
        or not SIGNATURE_PATTERN.match(signature)
    ):
        return None, "AUTH_MISSING"

    caller = callers.get(caller_id)
    if caller is None or not caller.enabled:
        return None, "AUTH_BAD_SIGNATURE"
    if caller.secret_id != secret_id:
        return None, "AUTH_BAD_SIGNATURE"

    ts = int(timestamp)
    if abs(now_seconds - ts) > CLOCK_SKEW_SECONDS:
        return None, "AUTH_CLOCK_SKEW"

    canonical = build_canonical_string(
        {
            "caller_id": caller_id,
            "secret_id": secret_id,
            "method": method.upper(),
            "path": path,
            "timestamp": timestamp,
            "body_hash": sha256_hex(body),
        }
    )
    expected = hmac_sha256_hex(caller.secret, canonical)
    if not timing_safe_equal_hex(expected, signature):
        return None, "AUTH_BAD_SIGNATURE"

    if nonces is not None and nonces.consume(nonce, caller_id, NONCE_TTL_SECONDS):
        return None, "AUTH_REPLAY"

    return CallerPrincipal(caller_id=caller_id, admin=caller.admin), None


def parse_caller_registry(raw: Optional[str]) -> "dict[str, CallerConfig]":
    """Parse the HERMES_CALLERS registry. Invalid shapes fail LOUDLY (raise)
    so a misconfigured deployment never starts with implicit trust."""
    if not raw:
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("HERMES_CALLERS must be a JSON object")
    callers: dict[str, CallerConfig] = {}
    for caller_id, entry in parsed.items():
        if not isinstance(entry, dict):
            raise ValueError(f"caller {caller_id} entry must be an object")
        if not CALLER_ID_PATTERN.match(caller_id):
            raise ValueError(f"caller id {caller_id} does not match the safe caller-id pattern")
        secret_id = entry.get("secret_id")
        secret = entry.get("secret")
        if not isinstance(secret_id, str) or not isinstance(secret, str):
            raise ValueError(f"caller {caller_id} is missing secret_id/secret")
        callers[caller_id] = CallerConfig(
            caller_id=caller_id,
            secret_id=secret_id,
            secret=secret,
            admin=bool(entry.get("admin", False)),
            enabled=entry.get("enabled", True) is not False,
        )
    return callers
