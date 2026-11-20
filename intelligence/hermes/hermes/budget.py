"""Budget enforcement and the append-only audit log.

Budget is a safety control (master plan principle 12): a task that exceeds its
step/tool/time budget is REFUSED with a reason, never silently truncated.
The audit log records what Hermes did — actions and outcomes only, never task
payload contents (privacy rule, master plan §10).
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Optional, Protocol

from .contracts import BudgetExceeded


class BudgetState:
    """Mutable per-task budget tracker. The router consults it before every
    step and every tool call."""

    def __init__(self, max_steps: int, max_seconds: int, max_tool_calls: int):
        self.max_steps = max_steps
        self.max_seconds = max_seconds
        self.max_tool_calls = max_tool_calls
        self.steps_used = 0
        self.tool_calls_used = 0
        self._started = time.monotonic()

    def begin_step(self) -> None:
        if self.steps_used >= self.max_steps:
            raise BudgetExceeded("BUDGET_STEPS_EXCEEDED")
        self.steps_used += 1

    def begin_tool_call(self) -> None:
        if self.tool_calls_used >= self.max_tool_calls:
            raise BudgetExceeded("BUDGET_TOOL_CALLS_EXCEEDED")
        self.tool_calls_used += 1

    def check_time(self) -> None:
        elapsed = time.monotonic() - self._started
        if elapsed > self.max_seconds:
            raise BudgetExceeded("BUDGET_TIME_EXCEEDED")


class AuditSink(Protocol):
    def record(self, entry: dict[str, Any]) -> None: ...


class JsonlAuditLog:
    """Append-only JSONL audit log. Entries carry metadata (who/what/outcome),
    never payload contents. Creates the file lazily; writes are flushed."""

    def __init__(self, path: Optional[Path] = None):
        self._path = path
        if path is None:
            self._path = Path(tempfile.gettempdir()) / f"hermes-audit-{os.getpid()}-{int(time.time())}.jsonl"

    @property
    def path(self) -> Path:
        return self._path  # type: ignore[return-value]

    def record(self, entry: dict[str, Any]) -> None:
        line = json.dumps({"ts": time.time(), **entry}, sort_keys=True, default=str)
        with self._path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
            handle.flush()
            os.fsync(handle.fileno())


class InMemoryAuditLog:
    """Collects entries for tests."""

    def __init__(self) -> None:
        self.entries: list[dict[str, Any]] = []

    def record(self, entry: dict[str, Any]) -> None:
        self.entries.append({"ts": time.time(), **entry})
