"""Hermes control-plane HTTP skeleton (FastAPI).

Endpoints:
- GET  /healthz            — liveness, no data
- GET  /version            — service version + registered skills
- POST /v1/tasks           — submit + synchronously route a task (v0)
- GET  /v1/tasks/{id}      — read a task record (submitter-scoped reads are a
                             deployment concern; v0 store is in-memory staging)

DEPLOYMENT HONESTY: this server is the shape of the always-on control plane,
not the proof of it. Master plan §5.2 requires minimum live capacity, process
supervision, restart recovery, persistent state, health checks, alerting and a
tested failover procedure before Hermes is declared continuously available.
Modal wiring (app.py) is a follow-up once the owner provisions the workspace.

Hermes NEVER holds production database credentials: task payloads arrive via
the gateway/submitter, and results are recommendations, not mutations.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import __version__
from .backends import ScriptedBackend
from .budget import InMemoryAuditLog
from .contracts import TaskRecord, TaskStatus, TaskSubmission
from .router import TaskRouter
from .skills import SkillRegistry

DEFAULT_SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"


class TaskStore:
    """In-memory staging store keyed by idempotency key + task id."""

    def __init__(self) -> None:
        self._by_id: dict[str, TaskRecord] = {}
        self._idem: dict[str, str] = {}

    def create(self, submission: TaskSubmission) -> tuple[TaskRecord, bool]:
        key = f"{submission.submitted_by}:{submission.idempotency_key}"
        existing = self._idem.get(key)
        if existing:
            return self._by_id[existing], True
        record = TaskRecord.from_submission(submission)
        self._by_id[record.task_id] = record
        self._idem[key] = record.task_id
        return record, False

    def get(self, task_id: str) -> Optional[TaskRecord]:
        return self._by_id.get(task_id)


def create_app(skills_dir: Optional[Path] = None) -> FastAPI:
    app = FastAPI(title="Mudaala Hermes Control Plane", version=__version__, docs_url=None, redoc_url=None)
    resolved_skills = skills_dir or DEFAULT_SKILLS_DIR
    registry = SkillRegistry(resolved_skills)
    backend = ScriptedBackend()
    audit = InMemoryAuditLog()
    router = TaskRouter(registry, backend, audit)
    store = TaskStore()

    app.state.registry = registry
    app.state.backend = backend
    app.state.audit = audit
    app.state.router = router
    app.state.store = store

    class TaskResponse(BaseModel):
        task_id: str
        status: str
        refusal_reason: Optional[str] = None

    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True, "service": "mudaala-hermes", "version": __version__}

    @app.get("/version")
    def version() -> dict:
        return {
            "service": "mudaala-hermes",
            "version": __version__,
            "skills": registry.ids(),
            "backend": backend.name,
        }

    @app.post("/v1/tasks", response_model=TaskResponse)
    def submit_task(submission: TaskSubmission) -> TaskResponse:
        record, replay = store.create(submission)
        if replay:
            return TaskResponse(task_id=record.task_id, status=record.status.value)
        router.route(submission, record)
        return TaskResponse(task_id=record.task_id, status=record.status.value, refusal_reason=record.refusal_reason)

    @app.get("/v1/tasks/{task_id}", response_model=TaskRecord)
    def read_task(task_id: str) -> TaskRecord:
        record = store.get(task_id)
        if record is None:
            raise HTTPException(status_code=404, detail="unknown task")
        if record.status is TaskStatus.QUEUED:
            raise HTTPException(status_code=409, detail="task not started")
        return record

    return app


app = create_app()
