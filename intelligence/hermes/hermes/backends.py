"""Agent backends — the seam between Hermes governance and an agent runtime.

`AgentBackend` is the interface every execution backend implements. The v0
repository ships `ScriptedBackend` (deterministic handlers registered per
task type) which is enough for governed, repeatable procedures and for tests.

DELIBERATE HONESTY: the NousResearch hermes-agent integration (master plan
§5.1.D, WS-5) is NOT implemented here and must not be claimed. When a Hermes
release is pinned and reviewed (skill format, tool permissions, memory
isolation), it lands as another `AgentBackend` — the governance layer (skill
registry, budget, audit) is deliberately runtime-agnostic so that swap does
not change contracts.
"""

from __future__ import annotations

from typing import Callable, Protocol

from .budget import BudgetState
from .contracts import TaskResult

Handler = Callable[[dict, BudgetState], TaskResult]


class AgentBackend(Protocol):
    """A backend executes a task under a budget and returns a typed result."""

    name: str

    def execute(self, task_type: str, payload: dict, budget: BudgetState) -> TaskResult: ...


class ScriptedBackend:
    """Deterministic handler registry. Each task type maps to exactly one
    handler; unknown task types are refused. Handlers receive the budget so
    multi-step procedures can honor it."""

    def __init__(self) -> None:
        self.name = "scripted-v0"
        self._handlers: dict[str, Handler] = {}

    def register(self, task_type: str, handler: Handler) -> None:
        if task_type in self._handlers:
            raise ValueError(f"task type {task_type} already registered")
        self._handlers[task_type] = handler

    def handles(self, task_type: str) -> bool:
        return task_type in self._handlers

    def execute(self, task_type: str, payload: dict, budget: BudgetState) -> TaskResult:
        handler = self._handlers.get(task_type)
        if handler is None:
            raise KeyError(f"no handler registered for task type {task_type}")
        return handler(payload, budget)
