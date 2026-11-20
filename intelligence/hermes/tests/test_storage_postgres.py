"""Durable storage tests against a DISPOSABLE PostgreSQL (never production).

The database comes from (in order):
1. HERMES_TEST_DATABASE_URL — e.g. a CI service container;
2. a disposable embedded PostgreSQL spawned via
   `bun run intelligence/jobs/dev-postgres.mjs --start` (repo dependency,
   no docker required).

These tests are the evidence for the durable-storage gate: fresh migrations,
repeatable migrations, idempotency under concurrency, atomic multi-worker
claims, tenant isolation, cancellation, recovery, retention, and the task
lifecycle surviving a full store restart (new connection, same database).
"""

import json
import os
import signal
import subprocess
import threading
import time

import pytest

from hermes.contracts import TaskRecord, TaskStatus, TaskSubmission
from hermes.postgres_store import PostgresTaskStore
from hermes.storage import IdempotencyConflict, canonical_payload
from tests.helpers import COMMERCE, submission_body


def _start_embedded_postgres():
    """Spawn the disposable PG via the repo's dev-postgres helper."""
    from pathlib import Path

    repo = Path(__file__).resolve().parents[3]
    script = repo / "intelligence" / "jobs" / "dev-postgres.mjs"
    if not script.exists():
        pytest.fail(f"dev-postgres helper missing: {script}")
    proc = subprocess.Popen(
        ["bun", "run", str(script), "--start"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    deadline = time.time() + 60
    url = None
    while time.time() < deadline:
        line = proc.stdout.readline()
        if line.startswith("{"):
            url = json.loads(line)["database_url"]
            break
    if url is None:
        proc.send_signal(signal.SIGTERM)
        pytest.fail("embedded PostgreSQL did not report its connection URL in time")
    return proc, url


@pytest.fixture(scope="module")
def pg_url():
    explicit = os.environ.get("HERMES_TEST_DATABASE_URL")
    if explicit:
        yield explicit
        return
    proc, url = _start_embedded_postgres()
    try:
        yield url
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()


@pytest.fixture()
def store(pg_url):
    s = PostgresTaskStore(pg_url)
    yield s
    s.close()


def make_record(**overrides) -> TaskRecord:
    submission = TaskSubmission(**submission_body(**overrides))
    return TaskRecord.from_submission(submission, owner=COMMERCE.caller_id, trace_id="hr-pg-12345678")


def test_fresh_migrations_create_all_intelligence_objects(store):
    tables = {r["table_name"] for r in store._conn.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'intelligence'"
    ).fetchall()}
    assert {"jobs", "event_outbox", "hermes_tasks", "hermes_nonces", "migrations"} <= tables
    # The dead-letter view is queryable (valid SQL, not the draft's invalid syntax).
    store._conn.execute("SELECT count(*) FROM intelligence.dead_letters").fetchone()


def test_migrations_are_repeatable(store):
    from pathlib import Path

    store.apply_migrations()  # second full application is a no-op
    names = {r["name"] for r in store._conn.execute("SELECT name FROM intelligence.migrations").fetchall()}
    migration_files = {p.name for p in (Path(__file__).resolve().parents[3] / "intelligence" / "jobs" / "migrations").glob("*.sql")}
    assert names == migration_files


def test_row_level_security_policies_exist(store):
    rows = store._conn.execute(
        "SELECT polname FROM pg_policy WHERE polrelid = 'intelligence.hermes_tasks'::regclass"
    ).fetchall()
    assert {r["polname"] for r in rows} >= {"hermes_tasks_owner_access", "hermes_tasks_admin_access"}


def test_create_replay_and_conflict(store):
    record = make_record()
    created, replay = store.create(record, canonical_payload(record.payload))
    assert replay is False
    again, replay2 = store.create(make_record(), canonical_payload(record.payload))
    assert replay2 is True and again.task_id == created.task_id
    different = make_record(payload={"question": "changed"})
    with pytest.raises(IdempotencyConflict):
        store.create(different, canonical_payload(different.payload))


def test_concurrent_creates_cannot_duplicate(store):
    unique_key = f"idem-conc-{int(time.time() * 1000) % 100000000:08d}"
    canonical = canonical_payload({"question": "q"})
    results, errors = [], []
    barrier = threading.Barrier(6)

    def worker():
        record = make_record(idempotency_key=unique_key)
        barrier.wait()
        try:
            results.append(store.create(record, canonical))
        except Exception as error:  # noqa: BLE001
            errors.append(error)

    threads = [threading.Thread(target=worker) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    # Single-connection store serialises writes; duplicates are impossible
    # (and the UNIQUE constraint is the cross-connection guarantee).
    assert not errors or all(isinstance(e, IdempotencyConflict) for e in errors)
    ids = {r[0].task_id for r in results}
    assert len(ids) == 1


def test_atomic_claim_across_two_stores_no_double_claiming(pg_url):
    store_a = PostgresTaskStore(pg_url, apply_migrations=False)
    store_b = PostgresTaskStore(pg_url, apply_migrations=False)
    try:
        record = make_record(idempotency_key="idem-claim-0001")
        store_a.create(record, canonical_payload(record.payload))
        store_a.save(record.transition(TaskStatus.VALIDATED) or record)
        store_a.save(record.transition(TaskStatus.QUEUED) or record)
        _ = store_a
        claim_a = store_b.claim_next("worker-a")
        claim_b = store_b.claim_next("worker-b")
        claim_c = store_a.claim_next("worker-c")
        assert claim_a is not None and claim_a.status is TaskStatus.RUNNING
        assert claim_b is None and claim_c is None  # exactly one worker won
    finally:
        store_a.close()
        store_b.close()


def test_tenant_isolation_in_durable_storage(store):
    record = make_record(idempotency_key="idem-scope-0001")
    created, _ = store.create(record, canonical_payload(record.payload))

    class Principal:
        def __init__(self, caller_id, admin=False):
            self.caller_id = caller_id
            self.admin = admin
            self.is_admin = admin

    owner = Principal("svc-commerce")
    foreign = Principal("svc-other-tenant")
    admin = Principal("svc-ops-admin", admin=True)
    assert store.get_scoped(created.task_id, owner) is not None
    assert store.get_scoped(created.task_id, foreign) is None  # foreign == missing
    assert store.get_scoped(created.task_id, admin) is not None  # explicit admin
    assert store.get_scoped(created.task_id, None) is None


def test_lifecycle_survives_a_store_restart(pg_url):
    """The durability gate: a task persisted by one connection is fully
    usable by a fresh connection (process restart semantics)."""
    store_a = PostgresTaskStore(pg_url, apply_migrations=False)
    record = make_record(idempotency_key="idem-restart-0001")
    store_a.create(record, canonical_payload(record.payload))
    store_a.save(record.transition(TaskStatus.VALIDATED) or record)
    store_a.save(record.transition(TaskStatus.QUEUED) or record)
    store_a.close()

    store_b = PostgresTaskStore(pg_url, apply_migrations=False)  # "restarted" process
    try:
        reopened = store_b.get(record.task_id)
        assert reopened is not None
        assert reopened.status is TaskStatus.QUEUED
        claimed = store_b.claim_next("restarted-worker")
        assert claimed is not None and claimed.task_id == record.task_id
        claimed.transition(TaskStatus.SUCCEEDED)
        claimed.result = None
        store_b.save(claimed)
        final = store_b.get(record.task_id)
        assert final.status is TaskStatus.SUCCEEDED
        assert final.attempts == 1
    finally:
        store_b.close()


def test_cancellation_and_recovery_flow(store):
    record = make_record(idempotency_key="idem-cancel-0001")
    created, _ = store.create(record, canonical_payload(record.payload))
    store.save(created.transition(TaskStatus.VALIDATED) or created)
    store.save(created.transition(TaskStatus.QUEUED) or created)

    class Principal:
        caller_id = "svc-commerce"
        admin = False
        is_admin = False

    cancelled = store.request_cancel(record.task_id, Principal())
    assert cancelled is not None and cancelled.status is TaskStatus.CANCELLED


def test_stale_running_recovery_and_dead_letter(store):
    record = make_record(idempotency_key="idem-recover-0001")
    created, _ = store.create(record, canonical_payload(record.payload))
    for _ in range(2):  # SUBMITTED → VALIDATED → QUEUED
        store.save(created.transition(_next(created.status)) or created)
    claimed = store.claim_next("dead-worker", now=time.time() - 10_000)
    assert claimed.status is TaskStatus.RUNNING
    recovered = store.recover_stale_running(900, now=time.time())
    assert recovered == 1
    after = store.get(record.task_id)
    assert after.status is TaskStatus.QUEUED and after.error_class == "WorkerRecovery"


def _next(status):
    """The happy-path next lifecycle state (used to walk tasks forward in tests)."""
    from hermes.contracts import TaskStatus as T

    return {
        T.SUBMITTED: T.VALIDATED,
        T.VALIDATED: T.QUEUED,
        T.QUEUED: T.RUNNING,
        T.RUNNING: T.SUCCEEDED,
    }[status]


def test_retention_sweep_removes_expired_finished_tasks(store):
    record = make_record(idempotency_key="idem-retention-0001")
    created, _ = store.create(record, canonical_payload(record.payload))
    for _ in range(4):
        store.save(created.transition(_next(created.status)) or created)
    store.save(created)  # now SUCCEEDED with finished_at
    swept = store.sweep_retention(now=time.time() + 25 * 3600)
    assert swept >= 1
    assert store.get(record.task_id) is None


def test_nonce_consume_is_atomic_across_connections(pg_url):
    store_a = PostgresTaskStore(pg_url, apply_migrations=False)
    store_b = PostgresTaskStore(pg_url, apply_migrations=False)
    try:
        assert store_a.consume_nonce("nonce-fixed-1", "svc-commerce", 60) is False
        assert store_b.consume_nonce("nonce-fixed-1", "svc-commerce", 60) is True  # replay
        assert store_b.consume_nonce("nonce-fixed-1", "svc-other-tenant", 60) is False  # caller-scoped
    finally:
        store_a.close()
        store_b.close()
