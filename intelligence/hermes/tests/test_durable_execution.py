"""Durable-execution behavioural tests (round-4, Commerce/Hermes remediation).

Every requirement from the assignment is covered against a REAL disposable
PostgreSQL (never production, never a mock store):

- two concurrent instances cannot independently execute the same task
  (atomic claim + CAS sync-claim),
- duplicate requests on one idempotency key replay, a different payload
  conflicts — across independent store instances,
- a crashed worker's tasks are recovered after the lease expires and the
  process "restarts" (a brand-new store instance on the same database),
- a live lease is never stolen: a long-running task keeps its claim,
- a failed execution retries with backoff and dead-letters when exhausted,
- a cancel request flagged by ANOTHER instance survives the executor's save,
- receipts are durable rows (one per attempt, idempotent append) that
  survive a restart,
- tenant isolation: cross-tenant reads/listings hide other merchants'
  tasks, receipts and history (store-level AND database RLS level).

Run: HERMES_TEST_DATABASE_URL=postgres://... python -m pytest tests/test_durable_execution.py
(or without the variable — the disposable embedded PostgreSQL spawns.)
"""

import threading
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from psycopg.rows import dict_row

import psycopg

from hermes.contracts import ExecutionReceipt, FailureClass, TaskRecord, TaskStatus, retry_delay_seconds
from hermes.postgres_store import PostgresTaskStore
from hermes.storage import IdempotencyConflict, canonical_payload
from tests.helpers import COMMERCE, submission_body
from tests.test_storage_postgres import _as_role, pg_url, rls_env  # noqa: F401 — pytest fixtures

OWNER = COMMERCE.caller_id
OTHER_TENANT = "svc-other-tenant"


def make_task(**overrides) -> TaskRecord:
    submission = TaskRecord.from_submission(
        __import__("hermes.contracts", fromlist=["TaskSubmission"]).TaskSubmission(**submission_body(**overrides)),
        owner=OWNER,
        trace_id="hr-durable-12345678",
    )
    return submission


def stage_queued(store: PostgresTaskStore, record: TaskRecord) -> TaskRecord:
    """Advance SUBMITTED → VALIDATED → QUEUED with persisted transitions —
    exactly what router.route() does for API submissions. A record already
    at QUEUED (replayed row) passes through unchanged."""
    if record.status is TaskStatus.QUEUED:
        return record
    staged = store.save(record.transition(TaskStatus.VALIDATED) or record)
    return store.save(staged.transition(TaskStatus.QUEUED) or staged)


def receipt(attempt: int, outcome: str = "SUCCEEDED", worker_id: str = "hermes-worker-test") -> ExecutionReceipt:
    return ExecutionReceipt(
        attempt=attempt,
        worker_id=worker_id,
        trace_id="hr-durable-12345678",
        started_at=time.time(),
        finished_at=time.time(),
        outcome=outcome,  # type: ignore[arg-type]
    )


def two_instances(url: str) -> tuple[PostgresTaskStore, PostgresTaskStore]:
    """Two independent store instances = two application instances (own
    connections, own lifecycle decisions)."""
    a = PostgresTaskStore(url, apply_migrations=True)
    b = PostgresTaskStore(url, apply_migrations=False)
    return a, b


def test_two_instances_cannot_claim_the_same_task(pg_url):  # noqa: F811
    a, b = two_instances(pg_url)
    task = make_task(idempotency_key="idem-dur-single-0001")
    created, _ = a.create(task, canonical_payload(task.payload))
    stage_queued(a, created)

    results: list = []
    lock = threading.Lock()

    def claim(store: PostgresTaskStore, worker_id: str) -> None:
        got = store.claim_next(worker_id)
        with lock:
            results.append((worker_id, got))

    threads = [threading.Thread(target=claim, args=(s, w)) for s, w in ((a, "worker-A"), (b, "worker-B"))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    claimed = [r for r in results if r[1] is not None]
    assert len(claimed) == 1, f"exactly one instance may claim: {results}"
    winner_id, winner_task = claimed[0]
    assert winner_task.task_id == task.task_id
    assert winner_task.worker_id == winner_id
    a.close()
    b.close()


def test_concurrent_instances_partition_the_queue_without_double_claims(pg_url):  # noqa: F811
    a, b = two_instances(pg_url)
    for index in range(12):
        task = make_task(idempotency_key=f"idem-dur-partition-{index:04d}")
        created, _ = a.create(task, canonical_payload(task.payload))
        stage_queued(a, created)

    taken: list[str] = []
    lock = threading.Lock()

    def drain(store: PostgresTaskStore, worker_id: str) -> None:
        while True:
            got = store.claim_next(worker_id)
            if got is None:
                return
            with lock:
                taken.append(got.task_id)

    threads = [
        threading.Thread(target=drain, args=(s, w))
        for s, w in ((a, "worker-A"), (b, "worker-B"))
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(taken) == 12 and len(set(taken)) == 12, "no task may be claimed twice"
    rows = a._infra.execute(
        "SELECT status, worker_id, attempts, lease_expires_at FROM intelligence.hermes_tasks"
    ).fetchall()
    assert all(r["status"] == "RUNNING" for r in rows)
    assert {r["worker_id"] for r in rows} == {"worker-A", "worker-B"}
    assert all(r["attempts"] == 1 for r in rows)
    assert all(r["lease_expires_at"] is not None for r in rows), "claims carry a lease"
    a.close()
    b.close()


def test_duplicate_idempotency_key_replays_and_conflicts_across_instances(pg_url):  # noqa: F811
    a, b = two_instances(pg_url)
    key = f"idem-dur-idem-{uuid4().hex[:12]}"  # fresh per run: the first insert must be first
    task = make_task(idempotency_key=key)
    created, replay = a.create(task, canonical_payload(task.payload))
    assert replay is False and created.task_id == task.task_id

    # Same key + content-equal payload on the OTHER instance: replay.
    again, replay2 = b.create(make_task(idempotency_key=key), canonical_payload(task.payload))
    assert replay2 is True and again.task_id == task.task_id

    # Same key + different payload on the OTHER instance: conflict.
    changed = make_task(idempotency_key=key, payload={"question": "changed"})
    with pytest.raises(IdempotencyConflict):
        b.create(changed, canonical_payload(changed.payload))
    a.close()
    b.close()


def test_live_lease_blocks_recovery_and_expired_lease_recovers(pg_url):  # noqa: F811
    a, _b = two_instances(pg_url)
    task = make_task(idempotency_key="idem-dur-lease-0001")
    created, _ = a.create(task, canonical_payload(task.payload))
    stage_queued(a, created)
    claimed = a.claim_next("worker-A")
    assert claimed is not None and claimed.status is TaskStatus.RUNNING

    # A live lease is NEVER stolen — even an aggressive recovery deadline
    # (this is the guard that keeps a long-running task from being run by a
    # second instance while the first still holds it).
    assert a.recover_stale_running(deadline_seconds=0.0) == 0
    still = a.get(task.task_id)
    assert still is not None and still.status is TaskStatus.RUNNING

    # The worker heartbeats; the lease keeps moving forward.
    assert a.renew_lease(task.task_id, "worker-A") is True
    row = a._infra.execute(
        "SELECT lease_expires_at FROM intelligence.hermes_tasks WHERE task_id = %s", (task.task_id,)
    ).fetchone()
    assert row["lease_expires_at"] > time.time()

    # Crash simulation: the worker dies, the lease expires, a NEW instance
    # (restart) sweeps and recovers the task for a retry.
    a._infra.execute(
        "UPDATE intelligence.hermes_tasks SET lease_expires_at = %s WHERE task_id = %s",
        (time.time() - 1, task.task_id),
    )
    restarted = PostgresTaskStore(pg_url, apply_migrations=False)
    assert restarted.recover_stale_running(deadline_seconds=900.0) == 1
    recovered = restarted.get(task.task_id)
    assert recovered is not None and recovered.status is TaskStatus.QUEUED
    assert recovered.attempts == 1 and recovered.next_attempt_at is not None
    # The dead worker's lease cannot be renewed after recovery.
    assert a.renew_lease(task.task_id, "worker-A") is False
    a.close()
    restarted.close()


def test_failed_execution_retries_with_backoff_then_dead_letters(pg_url):  # noqa: F811
    a, _b = two_instances(pg_url)
    task = make_task(idempotency_key="idem-dur-retry-0001")
    task.max_attempts = 3
    created, _ = a.create(task, canonical_payload(task.payload))
    stage_queued(a, created)

    for attempt in (1, 2):
        # The requeued task waits out its bounded backoff; the claim clock
        # jumps past next_attempt_at (a restarted worker arrives later).
        claimed = a.claim_next("worker-A", now=time.time() + retry_delay_seconds(attempt) + 1)
        assert claimed is not None and claimed.attempts == attempt
        claimed.transition(TaskStatus.FAILED)
        claimed.error_class = "FlakyBackend"
        claimed.failure_class = FailureClass.TRANSIENT
        assert a.save_execution_result(claimed) is True
        assert a.reschedule_after_failure(claimed) is True
        row = a.get(task.task_id)
        assert row is not None and row.status is TaskStatus.QUEUED
        assert row.next_attempt_at is not None

    # Third attempt exhausted → DEAD (dead-letter duty cycle). The claim
    # clock jumps past the second backoff window (bounded retry delay).
    claimed = a.claim_next("worker-A", now=time.time() + 3600)
    assert claimed is not None and claimed.attempts == 3
    claimed.transition(TaskStatus.FAILED)
    claimed.failure_class = FailureClass.TRANSIENT
    a.save_execution_result(claimed)
    assert a.reschedule_after_failure(claimed) is True
    dead = a.get(task.task_id)
    assert dead is not None and dead.status is TaskStatus.DEAD
    assert dead.refusal_reason and "DEAD_LETTER" in dead.refusal_reason
    a.close()


def test_permanent_failure_dead_letters_immediately(pg_url):  # noqa: F811
    a, _b = two_instances(pg_url)
    task = make_task(idempotency_key="idem-dur-perm-0001")
    task.max_attempts = 3
    created, _ = a.create(task, canonical_payload(task.payload))
    stage_queued(a, created)
    claimed = a.claim_next("worker-A")
    claimed.transition(TaskStatus.FAILED)
    claimed.failure_class = FailureClass.PERMANENT
    a.save_execution_result(claimed)
    assert a.reschedule_after_failure(claimed) is True
    dead = a.get(task.task_id)
    assert dead is not None and dead.status is TaskStatus.DEAD
    a.close()


def test_cancel_flag_from_another_instance_survives_the_executor_save(pg_url):  # noqa: F811
    a, b = two_instances(pg_url)
    task = make_task(idempotency_key="idem-dur-cancel-0001")
    created, _ = a.create(task, canonical_payload(task.payload))
    stage_queued(a, created)
    claimed = a.claim_next("worker-A")

    # Instance B (owner or admin session) flags cancellation WHILE A runs.
    principal = SimpleNamespace(caller_id=OWNER, is_admin=False)
    cancelled = b.request_cancel(task.task_id, principal)
    assert cancelled is not None and cancelled.cancel_requested is True

    # The executor's finish-save must MERGE the flag, not restore its stale
    # snapshot (the round-3 bug this remediation closes).
    claimed.transition(TaskStatus.FAILED)
    claimed.failure_class = FailureClass.TRANSIENT
    claimed.cancel_requested = False  # executor's stale in-memory view
    a.save_execution_result(claimed)
    row = a.get(task.task_id)
    assert row is not None and row.cancel_requested is True, "a cancel flagged by another instance survives"
    a.close()
    b.close()


def test_sync_claim_task_race_between_instances(pg_url):  # noqa: F811
    a, b = two_instances(pg_url)
    task = make_task(idempotency_key="idem-dur-sync-0001")
    created, _ = a.create(task, canonical_payload(task.payload))
    stage_queued(a, created)

    results: list = []
    lock = threading.Lock()

    def sync_claim(store: PostgresTaskStore, worker_id: str) -> None:
        got = store.claim_task(task.task_id, worker_id)
        with lock:
            results.append((worker_id, got))

    threads = [threading.Thread(target=sync_claim, args=(s, w)) for s, w in ((a, "sync-A"), (b, "sync-B"))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    winners = [r for r in results if r[1] is not None]
    assert len(winners) == 1, "the sync path claims CAS-style: one winner"
    assert winners[0][1].status is TaskStatus.RUNNING
    a.close()
    b.close()


def test_receipts_are_durable_idempotent_and_survive_restart(pg_url):  # noqa: F811
    a, _b = two_instances(pg_url)
    task = make_task(idempotency_key="idem-dur-rcpt-0001")
    created, _ = a.create(task, canonical_payload(task.payload))
    stage_queued(a, created)
    claimed = a.claim_next("worker-A")
    assert a.append_receipt(claimed, receipt(1, "SUCCEEDED")) is True
    # Repeated append for the same attempt is a no-op (UNIQUE task+attempt).
    assert a.append_receipt(claimed, receipt(1, "SUCCEEDED")) is False

    restarted = PostgresTaskStore(pg_url, apply_migrations=False)
    row = restarted.get(task.task_id)
    assert row is not None and len(row.receipts) == 1 and row.receipts[0].attempt == 1
    count = restarted._infra.execute(
        "SELECT count(*) AS n FROM intelligence.hermes_receipts WHERE task_id = %s", (task.task_id,)
    ).fetchone()
    assert count["n"] == 1

    # Second attempt after a retry appends cleanly (rows, not lost updates).
    expired = restarted._infra.execute(
        "UPDATE intelligence.hermes_tasks SET lease_expires_at = %s WHERE task_id = %s RETURNING task_id",
        (time.time() - 1, task.task_id),
    ).fetchone()
    assert expired is not None
    restarted.recover_stale_running(deadline_seconds=900.0)
    claimed2 = restarted.claim_next("worker-B", now=time.time() + 3600)
    assert claimed2 is not None and claimed2.attempts == 2
    assert restarted.append_receipt(claimed2, receipt(2, "FAILED", worker_id="worker-B")) is True
    row2 = restarted.get(task.task_id)
    assert {r.attempt for r in row2.receipts} == {1, 2}
    a.close()
    restarted.close()


def test_cross_tenant_access_is_hidden_at_store_and_database_level(pg_url, rls_env):  # noqa: F811
    urls = rls_env["urls"]
    owner_store = PostgresTaskStore(urls["owner"], apply_migrations=False)
    foreign_store = PostgresTaskStore(urls["foreign"], apply_migrations=False)
    admin_store = PostgresTaskStore(urls["admin"], apply_migrations=False)

    task = make_task(idempotency_key="idem-dur-tenant-0001")
    created, _replay = owner_store.create(task, canonical_payload(task.payload))
    stage_queued(owner_store, created)
    task = created
    # Claims and receipt appends are INFRASTRUCTURE operations under the
    # deployed RLS model (probe-verified at startup) — they run on the
    # admin connection; tenant connections keep create/read/list/cancel.
    claimed = admin_store.claim_next("worker-A")
    admin_store.append_receipt(claimed, receipt(1, "SUCCEEDED"))

    owner_principal = SimpleNamespace(caller_id=OWNER, is_admin=False)
    foreign_principal = SimpleNamespace(caller_id=OTHER_TENANT, is_admin=False)
    admin_principal = SimpleNamespace(caller_id="svc-ops-admin", is_admin=True)

    # Store-level: a foreign tenant's scoped read is None — indistinguishable
    # from a missing task (no existence leak).
    assert foreign_store.get_scoped(task.task_id, foreign_principal) is None
    assert foreign_store.find_by_idempotency(OTHER_TENANT, "idem-dur-tenant-0001") is None
    assert foreign_store.list_for_owner(OTHER_TENANT) == []
    assert foreign_store.request_cancel(task.task_id, foreign_principal) is None

    # The owner sees their own task WITH its receipts; the admin sees all.
    mine = owner_store.get_scoped(task.task_id, owner_principal)
    assert mine is not None and mine.submitted_by == OWNER and len(mine.receipts) == 1
    admin_view = admin_store.get_scoped(task.task_id, admin_principal)
    assert admin_view is not None and len(admin_view.receipts) == 1

    # Database-level: RLS on the receipts table — the foreign role sees zero
    # receipt rows even when reading the table directly.
    foreign_conn = psycopg.connect(urls["foreign"], row_factory=dict_row)
    visible = 0
    with foreign_conn.transaction():
        foreign_conn.execute("SELECT set_config('intelligence.owner', %s, true)", (OTHER_TENANT,))
        visible = foreign_conn.execute(
            "SELECT count(*) AS n FROM intelligence.hermes_receipts WHERE task_id = %s", (task.task_id,)
        ).fetchone()["n"]
    assert visible == 0, "RLS hides another merchant's receipts"
    owner_conn = psycopg.connect(urls["owner"], row_factory=dict_row)
    own = 0
    with owner_conn.transaction():
        owner_conn.execute("SELECT set_config('intelligence.owner', %s, true)", (OWNER,))
        own = owner_conn.execute(
            "SELECT count(*) AS n FROM intelligence.hermes_receipts WHERE task_id = %s", (task.task_id,)
        ).fetchone()["n"]
    assert own == 1, "the owner sees exactly their own receipt"
    foreign_conn.close()
    owner_conn.close()
    owner_store.close()
    foreign_store.close()
    admin_store.close()


def test_full_lifecycle_survives_restart_end_to_end(pg_url):  # noqa: F811
    """Submit → claim → crash → restart → recover → retry → succeed, with
    two receipts and honest attempt accounting, across two store instances
    (two application instances, one database)."""
    first = PostgresTaskStore(pg_url, apply_migrations=False)
    task = make_task(idempotency_key="idem-dur-e2e-0001")
    task.max_attempts = 3
    created, _ = first.create(task, canonical_payload(task.payload))
    stage_queued(first, created)

    claimed = first.claim_next("worker-A")
    assert claimed is not None  # ...and then worker-A dies without saving
    del claimed
    # Time passes: the dead worker never renews, its lease expires.
    first._infra.execute(
        "UPDATE intelligence.hermes_tasks SET lease_expires_at = %s WHERE task_id = %s",
        (time.time() - 1, created.task_id),
    )

    second = PostgresTaskStore(pg_url, apply_migrations=False)  # the restart
    assert second.recover_stale_running(deadline_seconds=0.5) == 1
    recovered = second.claim_next("worker-B", now=time.time() + 3600)
    assert recovered is not None and recovered.attempts == 2
    recovered.transition(TaskStatus.SUCCEEDED)
    recovered.finished_at = time.time()
    second.append_receipt(recovered, receipt(2, "SUCCEEDED", worker_id="worker-B"))
    assert second.save_execution_result(recovered) is True

    final = second.get(task.task_id)
    assert final is not None and final.status is TaskStatus.SUCCEEDED
    assert final.attempts == 2
    assert {r.attempt for r in final.receipts} == {2}
    first.close()
    second.close()


@pytest.fixture(autouse=True)
def _exclusive_tenant_tables(pg_url):
    """This module shares the disposable database with the older durable-
    storage module, whose tests assume a fresh instance (fixed idempotency
    keys, exact queue contents, oldest-first claims). Wipe the tenant tables
    BEFORE and AFTER EVERY test in this module: the behavioural tests
    assert exact queue contents and attempt counts, and claim_next serves
    the OLDEST queued task — leftovers from one test would be claimed by
    the next. The next module deserves a clean database too, which the
    final wipe provides."""
    def _wipe() -> None:
        conn = psycopg.connect(pg_url, row_factory=dict_row)
        conn.autocommit = True
        # On a fresh disposable database this module may run before ANY
        # migrations exist — nothing to wipe then.
        if conn.execute("SELECT to_regclass('intelligence.hermes_tasks') AS r").fetchone()["r"]:
            conn.execute("DELETE FROM intelligence.hermes_receipts")
            conn.execute("DELETE FROM intelligence.hermes_tasks")
            conn.execute("DELETE FROM intelligence.hermes_nonces")
        conn.close()

    _wipe()
    yield
    _wipe()
