"""Runtime payload validation — the boundary TypeScript/Python types can't
provide. Nothing is trusted because of an annotation: every task payload is
bounded here (bytes, depth, key count, string length) before it reaches a
handler, and identifiers are validated before they enter storage or logs."""

from __future__ import annotations

import json
import re

from .errors import HermesError

# Payload bounds (mirror JOB_BUDGET_CAPS payloadBytes / contract caps).
TASK_PAYLOAD_MAX_BYTES = 16 * 1024
TASK_PAYLOAD_MAX_DEPTH = 6
TASK_PAYLOAD_MAX_VALUES = 200
TASK_STRING_MAX_LENGTH = 2_000

TASK_ID_PATTERN = re.compile(r"^task-[0-9a-f]{16}$")
TRACE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")


def validate_payload(payload: object) -> None:
    """Validate a decoded task payload against the runtime bounds. Raises
    HermesError(PAYLOAD_TOO_LARGE / PAYLOAD_INVALID) — never leaks content."""

    try:
        encoded = json.dumps(payload, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        raise HermesError("PAYLOAD_INVALID", "payload is not valid JSON data")
    if len(encoded.encode("utf-8")) > TASK_PAYLOAD_MAX_BYTES:
        raise HermesError("PAYLOAD_TOO_LARGE", f"payload exceeds {TASK_PAYLOAD_MAX_BYTES} bytes")

    value_count = 0

    def walk(node: object, depth: int) -> None:
        nonlocal value_count
        if depth > TASK_PAYLOAD_MAX_DEPTH:
            raise HermesError("PAYLOAD_INVALID", f"payload nesting exceeds {TASK_PAYLOAD_MAX_DEPTH} levels")
        value_count += 1
        if value_count > TASK_PAYLOAD_MAX_VALUES:
            raise HermesError("PAYLOAD_INVALID", f"payload exceeds {TASK_PAYLOAD_MAX_VALUES} values")
        if isinstance(node, dict):
            for key, item in node.items():
                if not isinstance(key, str) or len(key) > 64:
                    raise HermesError("PAYLOAD_INVALID", "payload object keys must be strings of ≤64 chars")
                walk(item, depth + 1)
        elif isinstance(node, (list, tuple)):
            for item in node:
                walk(item, depth + 1)
        elif isinstance(node, str):
            if len(node) > TASK_STRING_MAX_LENGTH:
                raise HermesError("PAYLOAD_INVALID", f"payload strings are limited to {TASK_STRING_MAX_LENGTH} chars")

    walk(payload, 1)


def validate_task_id(task_id: str) -> str:
    """Validate a client-supplied task id (path parameter). Rejects anything
    that could confuse storage lookups or log output."""
    if not TASK_ID_PATTERN.match(task_id or ""):
        raise HermesError("TASK_NOT_FOUND", "unknown task")
    return task_id


def validate_trace_id(trace_id: str) -> str:
    if not TRACE_ID_PATTERN.match(trace_id or ""):
        # Malformed client trace ids are replaced, never echoed.
        raise HermesError("PAYLOAD_INVALID", "trace id must be 8–128 safe characters")
    return trace_id


def require_admin(principal) -> None:
    """Administrative operations are protected separately: only principals
    with the explicit admin capability may pass."""
    if principal is None or not getattr(principal, "is_admin", False):
        raise HermesError("SCOPE_DENIED", "administrator capability required")
