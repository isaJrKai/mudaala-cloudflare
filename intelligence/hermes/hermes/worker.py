"""Hermes worker — persistent task execution loop.

The worker claims QUEUED tasks from the store (atomic claim), routes and
executes them, and handles retry/dead-letter scheduling. It also performs
recovery of stale RUNNING tasks (worker crash) and retention sweeps.

Reliability foundations implemented here:
- atomic claiming (single claim_next call per poll; Postgres store uses
  FOR UPDATE SKIP LOCKED so replicas cannot double-claim),
- retry with bounded backoff for TRANSIENT failures, DEAD for PERMANENT
  or attempts-exhausted (dead-letter, visible to admins),
- stale-RUNNING recovery sweep (crash of a worker re-queues its tasks),
- graceful shutdown (stop() finishes the current task, then exits),
- cooperative cancellation (the budget's cancel_check consults the store),
- structured observability (JSON log lines, metadata only).

DEPLOYMENT HONESTY: this loop makes a single process reliably executable,
but continuous availability still requires the owner's hosting (supervision,
restart policy, alerting) to be provisioned and TESTED — see the Hermes
README. Nothing here claims "always-on".
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Optional

from .contracts import TaskRecord, TaskStatus
from .router import TaskRouter
from .storage import TaskStore

logger = logging.getLogger("hermes.worker")


class HermesWorker:
    def __init__(
        self,
        store: TaskStore,
        router: TaskRouter,
        worker_id: str = "hermes-worker-0",
        poll_interval_seconds: float = 0.5,
        stale_running_seconds: float = 900,
        retention_seconds: float = 24 * 3600,
        log: Optional[logging.Logger] = None,
    ):
        self._store = store
        self._router = router
        self.worker_id = worker_id
        self._poll_interval = poll_interval_seconds
        self._stale_running = stale_running_seconds
        self._retention = retention_seconds
        self._log = log or logger
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._last_sweep = 0.0

    # -- lifecycle -----------------------------------------------------------

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name=self.worker_id, daemon=True)
        self._thread.start()
        self._log.info("worker started worker_id=%s", self.worker_id)

    def stop(self, timeout: float = 10.0) -> None:
        """Graceful shutdown: signal stop, finish the in-flight task, exit."""
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=timeout)
        self._thread = None
        self._log.info("worker stopped worker_id=%s", self.worker_id)

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    # -- loop ----------------------------------------------------------------

    def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._maintenance()
                task = self._store.claim_next(self.worker_id)
                if task is None:
                    self._stop_event.wait(self._poll_interval)
                    continue
                self._execute_claimed(task)
            except Exception as error:  # noqa: BLE001 — the loop must survive
                self._log.error("worker loop error class=%s", type(error).__name__)
                self._stop_event.wait(self._poll_interval)

    def _maintenance(self) -> None:
        now = time.time()
        if now - self._last_sweep < 30:
            return
        self._last_sweep = now
        recovered = self._store.recover_stale_running(self._stale_running, now)
        if recovered:
            self._log.warning("recovered stale running tasks count=%d", recovered)
        swept = self._store.sweep_retention(now)
        if swept:
            self._log.info("retention sweep removed records count=%d", swept)

    def _execute_claimed(self, task: TaskRecord) -> None:
        started = time.time()
        original_worker = self._router._worker_id
        self._router._worker_id = self.worker_id
        try:
            # The router consults the store during execution for cooperative
            # cancellation (budget.check_cancel between handler steps).
            self._router.execute(task)
        finally:
            self._router._worker_id = original_worker
        finished = self._store.get(task.task_id)
        outcome = finished.status.value if finished else "UNKNOWN"
        self._log.info(
            "task executed task_id=%s status=%s attempts=%d duration_ms=%d",
            task.task_id,
            outcome,
            finished.attempts if finished else -1,
            int((time.time() - started) * 1000),
        )

    # -- one-shot helpers (used by tests and the sync path) -------------------

    def run_once(self) -> Optional[str]:
        """Claim and execute at most one task. Returns its id, or None."""
        task = self._store.claim_next(self.worker_id)
        if task is None:
            return None
        self._execute_claimed(task)
        return task.task_id

    def recover(self) -> int:
        return self._store.recover_stale_running(self._stale_running)
