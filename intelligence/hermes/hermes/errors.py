"""Hermes stable error envelope.

Every error a client can receive is one of the codes below, rendered as::

    {"error": {"code": ..., "message": ..., "trace_id": ..., "retryable": bool}}

Internal exception details, stack traces, database errors and secrets are
never included in responses; they go to the structured log only.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

HERMES_ERROR_CODES = [
    "AUTH_MISSING",
    "AUTH_BAD_SIGNATURE",
    "AUTH_CLOCK_SKEW",
    "AUTH_REPLAY",
    "SCOPE_DENIED",
    "PAYLOAD_TOO_LARGE",
    "PAYLOAD_INVALID",
    "TASK_NOT_FOUND",
    "TASK_CONFLICT",
    "IDEMPOTENCY_CONFLICT",
    "INTERNAL_ERROR",
]

STATUS_FOR_CODE = {
    "AUTH_MISSING": 401,
    "AUTH_BAD_SIGNATURE": 401,
    "AUTH_CLOCK_SKEW": 401,
    "AUTH_REPLAY": 409,
    "SCOPE_DENIED": 403,
    "PAYLOAD_TOO_LARGE": 413,
    "PAYLOAD_INVALID": 400,
    "TASK_NOT_FOUND": 404,
    "TASK_CONFLICT": 409,
    "IDEMPOTENCY_CONFLICT": 409,
    "INTERNAL_ERROR": 500,
}


class HermesError(Exception):
    """A stable, client-safe error. `message` must never contain secrets or
    internal details — it is returned verbatim."""

    def __init__(self, code: str, message: str, retryable: bool = False):
        if code not in STATUS_FOR_CODE:
            raise ValueError(f"unknown Hermes error code {code}")
        super().__init__(message)
        self.code = code
        self.message = message[:256]
        self.retryable = retryable


def error_response(code: str, message: str, trace_id: str, retryable: bool = False) -> JSONResponse:
    body = {"error": {"code": code, "message": message[:256], "trace_id": trace_id, "retryable": retryable}}
    return JSONResponse(
        body,
        status_code=STATUS_FOR_CODE[code],
        headers={"x-hermes-trace-id": trace_id or "", "cache-control": "no-store"},
    )


def install_error_handlers(app: FastAPI) -> None:
    """Register fail-closed exception handlers: HermesError renders its stable
    envelope; everything else is a generic 500 with no internal detail."""

    @app.exception_handler(HermesError)
    async def _hermes_error(request: Request, exc: HermesError) -> JSONResponse:  # noqa: ANN202
        trace_id = request.headers.get("x-hermes-trace-id", "")[:128] or "hr-internal"
        return error_response(exc.code, exc.message, trace_id, exc.retryable)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:  # noqa: ANN202
        trace_id = request.headers.get("x-hermes-trace-id", "")[:128] or "hr-internal"
        # Log server-side with the class name only; respond generically.
        import logging

        logging.getLogger("hermes.server").exception(
            "unhandled error class=%s trace_id=%s", type(exc).__name__, trace_id
        )
        return error_response("INTERNAL_ERROR", "internal error", trace_id, retryable=True)
