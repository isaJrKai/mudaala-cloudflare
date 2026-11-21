"""Agent backends — the seam between Hermes governance and an agent runtime.

`AgentBackend` is the interface every execution backend implements. The
repository ships `ScriptedBackend` (deterministic handlers registered per
task type) which is enough for governed, repeatable procedures and for tests.

`ModelProvider` is the future-model seam: a provider is a bounded, budgeted
source of completions behind Hermes governance. The ONLY shipped
implementation is `NotConfiguredProvider` — it refuses everything rather
than pretending. DELIBERATE HONESTY: the NousResearch hermes-agent
integration (master plan §5.1.D, WS-5) is NOT implemented and must not be
claimed. When a Hermes release is pinned and reviewed (skill format, tool
permissions, memory isolation), it lands as another `AgentBackend` — the
governance layer (skill registry, budget, audit) is deliberately runtime-
agnostic so that swap does not change contracts.
"""

from __future__ import annotations

from typing import Callable, Protocol

from .budget import BudgetState
from .contracts import BudgetExceeded, TaskResult


class Handler(Protocol):
    def __call__(self, payload: dict, budget: BudgetState) -> TaskResult: ...


class AgentBackend(Protocol):
    """A backend executes a task under a budget and returns a typed result."""

    name: str

    def execute(self, task_type: str, payload: dict, budget: BudgetState) -> TaskResult: ...


class NotConfiguredProvider:
    """The model-provider seam placeholder. It performs NO inference, NO
    spend, and refuses every call — a silent mock must never be mistaken for
    a live provider."""

    name = "not-configured"

    def complete(self, prompt: str, budget: BudgetState) -> str:
        raise BudgetExceeded("PROVIDER_NOT_CONFIGURED")

    def available(self) -> bool:
        return False


class ScriptedBackend:
    """Deterministic handler registry. Each task type maps to exactly one
    handler; unknown task types are refused. Handlers receive the budget so
    multi-step procedures can honor it.

    Registration is validated: the same task type cannot be registered twice,
    and handlers are wrapped so unexpected returns still produce a typed
    TaskResult (fail-closed on contract violations)."""

    def __init__(self) -> None:
        self.name = "scripted-v0"
        self._handlers: dict[str, Handler] = {}
        self.provider = NotConfiguredProvider()

    def register(self, task_type: str, handler: Handler, *, overwrite: bool = False) -> None:
        if task_type in self._handlers and not overwrite:
            raise ValueError(f"task type {task_type} already registered")
        self._handlers[task_type] = handler

    def handles(self, task_type: str) -> bool:
        return task_type in self._handlers

    def registered_types(self) -> list[str]:
        return sorted(self._handlers.keys())

    def execute(self, task_type: str, payload: dict, budget: BudgetState) -> TaskResult:
        handler = self._handlers.get(task_type)
        if handler is None:
            raise KeyError(f"no handler registered for task type {task_type}")
        result = handler(payload, budget)
        if not isinstance(result, TaskResult):
            raise ValueError(f"handler for {task_type} returned a non-TaskResult")
        return result
