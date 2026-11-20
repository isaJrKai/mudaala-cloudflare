"""Structured JSON logging for Hermes.

One line per event: timestamp, level, logger, message, and metadata fields
only. Task payloads, auth secrets and header values are NEVER logged —
callers pass metadata (task_id, trace_id, actor, counts).
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Optional


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in getattr(record, "meta", {}).items():
            entry[key] = value
        if record.exc_info:
            entry["error_class"] = type(record.exc_info[1]).__name__ if record.exc_info[1] else "unknown"
        return json.dumps(entry, ensure_ascii=False, default=str)


def configure_logging(level: int = logging.INFO, stream=None) -> None:
    """Idempotent: reconfiguration replaces the Hermes root handlers."""
    root = logging.getLogger("hermes")
    root.setLevel(level)
    for handler in list(root.handlers):
        root.removeHandler(handler)
    handler = logging.StreamHandler(stream if stream is not None else sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.propagate = False
