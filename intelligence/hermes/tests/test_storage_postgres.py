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
from uuid import uuid4

import psycopg
import pytest
from psycopg.rows import dict_row

from hermes.contracts import TaskRecord, TaskStatus, TaskSubmission
from hermes.postgres_store import PostgresAuditLog, PostgresNonceStore, PostgresTaskStore
from hermes.storage import IdempotencyConflict, canonical_payload
from tests.helpers import ADMIN, COMMERCE, signed_json_request, submission_body, test_callers


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
    assert {"jobs", "event_outbox", "hermes_tasks", "hermes_nonces", "hermes_audit", "migrations"} <= tables
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


# ============================================================================
# Round-2 remediation tests (reviewer findings 2, 3, 5): the RLS boundary is
# ENFORCED against real restricted roles, idempotent create is atomic across
# INDEPENDENT connections, and the audit trail is durable and append-only.
# ============================================================================


class _Principal:
    """Test principal mirroring hermes.auth.CallerPrincipal."""

    def __init__(self, caller_id: str, admin: bool = False):
        self.caller_id = caller_id
        self.admin = admin
        self.is_admin = admin


RLS_TEST_PASSWORD = "rls-test-password"


def _as_role(pg_url: str, role: str) -> str:
    head, _, tail = pg_url.partition("://")
    _, _, host = tail.partition("@")
    return f"{head}://{role}:{RLS_TEST_PASSWORD}@{host}"


@pytest.fixture(scope="module")
def rls_env(pg_url):
    """Restricted LOGIN roles mirroring the migration-005 role model.

    RLS binds only to roles it applies to — the test connection user (the
    disposable database's bootstrap superuser) bypasses it BY DESIGN, so the
    enforcement tests below run as dedicated login roles with exactly the
    grants migration 005 gives `intelligence_app` (owner/foreign) and the
    intelligence_admin membership the infrastructure/admin path requires.
    """
    # Ensure the migration head (tables, policies, 005 grants) exists before
    # granting — the fixture may run before any store-creating test.
    bootstrap = PostgresTaskStore(pg_url)  # apply_migrations=True, idempotent
    bootstrap.close()
    admin = psycopg.connect(pg_url, row_factory=dict_row)
    admin.autocommit = True
    roles = {"owner": "hermes_rls_owner", "foreign": "hermes_rls_foreign", "admin": "hermes_rls_admin"}
    for role in roles.values():
        try:
            admin.execute(f"CREATE ROLE {role} LOGIN PASSWORD '{RLS_TEST_PASSWORD}'")
        except psycopg.errors.DuplicateObject:
            admin.execute(f"ALTER ROLE {role} WITH LOGIN PASSWORD '{RLS_TEST_PASSWORD}'")
        # Exactly the migration-005 grants for an application role.
        admin.execute(f"GRANT USAGE ON SCHEMA intelligence TO {role}")
        admin.execute(f"GRANT SELECT, INSERT, UPDATE ON intelligence.hermes_tasks TO {role}")
        # Migration 006 extends the grant model: receipts are app-appendable.
        admin.execute(f"GRANT SELECT, INSERT ON intelligence.hermes_receipts TO {role}")
        admin.execute(f"GRANT SELECT, INSERT, DELETE ON intelligence.hermes_nonces TO {role}")
        admin.execute(f"GRANT SELECT, INSERT ON intelligence.hermes_audit TO {role}")
        admin.execute(f"GRANT SELECT ON intelligence.migrations TO {role}")
    # The administrator path: admin policy = intelligence_admin membership.
    admin.execute(f"GRANT intelligence_admin TO {roles['admin']}")
    try:
        yield {"urls": {name: _as_role(pg_url, role) for name, role in roles.items()}}
    finally:
        admin.close()


def test_rls_hides_rows_without_owner_context(pg_url, rls_env, store):
    """Finding 2, part 1: the policies GATE access — a restricted role sees
    zero rows without (and with a wrong) owner context, and rows only appear
    when the context matches, even though the rows demonstrably exist."""
    record = make_record(idempotency_key="idem-rls-seed-0001")
    store.create(record, canonical_payload(record.payload))

    restricted = psycopg.connect(rls_env["urls"]["foreign"], row_factory=dict_row)
    restricted.autocommit = True
    try:
        # No owner context at all.
        count = restricted.execute("SELECT count(*) AS n FROM intelligence.hermes_tasks").fetchone()["n"]
        assert count == 0
        # A WRONG owner context still hides the row.
        restricted.execute("SELECT set_config('intelligence.owner', 'svc-other-tenant', false)")
        count = restricted.execute("SELECT count(*) AS n FROM intelligence.hermes_tasks").fetchone()["n"]
        assert count == 0
        # The CORRECT owner context reveals it — the setting is the gate.
        restricted.execute("SELECT set_config('intelligence.owner', 'svc-commerce', false)")
        count = restricted.execute("SELECT count(*) AS n FROM intelligence.hermes_tasks").fetchone()["n"]
        assert count >= 1
    finally:
        restricted.close()


def test_rls_rejects_insert_without_owner_context(rls_env):
    """Finding 2, part 2: writes are gated too (WITH CHECK) — the INSERT the
    store issues would fail without its transaction-scoped owner context."""
    restricted = psycopg.connect(rls_env["urls"]["owner"])
    restricted.autocommit = True
    try:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            restricted.execute(
                "INSERT INTO intelligence.hermes_tasks "
                "(task_id, task_type, skill_id, purpose, submitted_by, budget, "
                "idempotency_key, payload, payload_canonical, created_at) "
                "VALUES ('task-rls-no-context', 'ORIENT_PRODUCT_FACTS', "
                "'msk-001-product-policy-orientation', 'test', 'svc-commerce', "
                "'{}', 'rls-no-context', '{}', '{}', 0)"
            )
    finally:
        restricted.close()


def test_wired_store_sets_transaction_scoped_owner_and_enforces_all_paths(pg_url, rls_env):
    """Finding 2, part 3: the store itself drives the owner context — its
    create/read/list work AS the restricted app role (proof the context is
    actually set), the context does not leak onto the session, and every
    infrastructure path (unscoped read, cross-tenant list, claims) returns
    nothing for the app role while the admin role's paths work."""
    owner_store = PostgresTaskStore(rls_env["urls"]["owner"], apply_migrations=False)
    foreign_store = PostgresTaskStore(rls_env["urls"]["foreign"], apply_migrations=False)
    admin_store = PostgresTaskStore(rls_env["urls"]["admin"], apply_migrations=False)
    try:
        record = make_record(idempotency_key="idem-rls-wired-0001")
        created, replay = owner_store.create(record, canonical_payload(record.payload))
        assert replay is False

        # Transaction-scoped: nothing persists on the session after commit.
        leaked = owner_store._conn.execute(
            "SELECT current_setting('intelligence.owner', true) AS owner"
        ).fetchone()["owner"]
        assert leaked in (None, "")

        # Tenant paths work as the restricted role (context set by the store).
        assert owner_store.get_scoped(created.task_id, _Principal("svc-commerce")) is not None
        # Earlier tests share this module database — membership, not equality.
        assert created.task_id in [t.task_id for t in owner_store.list_for_owner("svc-commerce")]

        # A different app role asked with the FOREIGN verified caller:
        # nothing — indistinguishable from a missing task, both in the app
        # query AND at the database layer. (RLS defends against missing or
        # wrong context and non-app roles; the app-layer filter carries the
        # verified identity, per the auth model.)
        assert foreign_store.get_scoped(created.task_id, _Principal("svc-other-tenant")) is None
        assert foreign_store.list_for_owner("svc-other-tenant") == []

        # Infrastructure paths on an RLS-bound app role return NOTHING:
        # worker claims and cross-tenant reads REQUIRE the admin role.
        assert owner_store.get(created.task_id) is None
        assert owner_store.list_all() == []
        assert owner_store.claim_next("rogue-worker") is None

        # The admin role holds intelligence_admin membership → full path.
        assert admin_store.get(created.task_id) is not None
        assert len(admin_store.list_all()) >= 1
        # Lifecycle walk runs on the infrastructure path (the app role cannot
        # drive it — claim/saves are admin-connection operations by wiring).
        validated = created.transition(TaskStatus.VALIDATED) or created
        queued = validated.transition(TaskStatus.QUEUED) or validated
        admin_store.save(queued)
        claimed = admin_store.claim_next("infra-worker")
        assert claimed is not None and claimed.task_id == created.task_id
    finally:
        owner_store.close()
        foreign_store.close()
        admin_store.close()


def test_idempotent_create_is_atomic_across_concurrent_stores(pg_url):
    """Finding 3: independent connections race on the same (owner, key) —
    the database constraint decides; the losers REPLAY the winner's task
    instead of receiving a uniqueness error. Every request succeeds; exactly
    one request creates; all return the same task id."""
    stores = [PostgresTaskStore(pg_url, apply_migrations=False) for _ in range(3)]
    try:
        for round_index in range(5):
            key = f"idem-atomic-{uuid4().hex[:12]}"
            canonical = canonical_payload({"question": f"q-{round_index}"})
            results: list = []
            errors: list = []
            barrier = threading.Barrier(3)

            def worker(store: PostgresTaskStore) -> None:
                record = make_record(idempotency_key=key)
                barrier.wait()
                try:
                    results.append(store.create(record, canonical))
                except Exception as error:  # noqa: BLE001
                    errors.append(error)

            threads = [threading.Thread(target=worker, args=(s,)) for s in stores]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            assert not errors, errors
            assert len({r[0].task_id for r in results}) == 1
            flags = [r[1] for r in results]
            assert flags.count(False) == 1  # exactly one creator
            assert flags.count(True) == 2  # the others replayed
    finally:
        for s in stores:
            s.close()


def test_payload_conflict_detected_across_stores(pg_url):
    """Finding 3, conflict variant: the loser of the race sees the winner's
    row and raises IdempotencyConflict — never a raw uniqueness error — and
    can still replay the original payload afterwards."""
    store_a = PostgresTaskStore(pg_url, apply_migrations=False)
    store_b = PostgresTaskStore(pg_url, apply_migrations=False)
    try:
        key = f"idem-conflict-{uuid4().hex[:12]}"
        original = make_record(idempotency_key=key, payload={"question": "original"})
        created, replay = store_a.create(original, canonical_payload(original.payload))
        assert replay is False
        changed = make_record(idempotency_key=key, payload={"question": "changed"})
        with pytest.raises(IdempotencyConflict):
            store_b.create(changed, canonical_payload(changed.payload))
        replayed, flag = store_b.create(original, canonical_payload(original.payload))
        assert flag is True and replayed.task_id == created.task_id
    finally:
        store_a.close()
        store_b.close()


def test_nonce_store_is_durable_across_restarts(pg_url):
    """Finding 5's infrastructure sibling: the wired nonce store persists —
    a nonce consumed by one process instance is a replay for the next."""
    first = PostgresNonceStore(pg_url)
    try:
        assert first.consume("nonce-durable-0001", "svc-commerce", 300) is False
    finally:
        first.close()
    second = PostgresNonceStore(pg_url)  # restarted process, fresh connection
    try:
        assert second.consume("nonce-durable-0001", "svc-commerce", 300) is True
    finally:
        second.close()


def test_audit_log_is_durable_and_append_only(pg_url, rls_env):
    """Finding 5: audit records survive a restart (new connection, same
    database), and application roles can append and read but CANNOT update
    or delete audit rows (append-only by grant, migration 005)."""
    log_a = PostgresAuditLog(pg_url)
    log_a.record({"event": "admin_requeue_task", "actor": "svc-ops-admin", "task_id": "task-audit-0001"})
    log_a.record({"event": "admin_list_tasks", "actor": "svc-ops-admin"})
    log_a.close()

    log_b = PostgresAuditLog(pg_url)  # restarted process
    try:
        events = [e["event"] for e in log_b.entries(limit=20)]
        assert "admin_requeue_task" in events
        assert "admin_list_tasks" in events
        by_actor = [e for e in log_b.entries(limit=20) if e["actor"] == "svc-ops-admin"]
        assert len(by_actor) >= 2
        assert all(e["details"].get("payload") is None for e in by_actor)
    finally:
        log_b.close()

    restricted = psycopg.connect(rls_env["urls"]["owner"])
    restricted.autocommit = True
    try:
        restricted.execute(
            "INSERT INTO intelligence.hermes_audit (ts, event, actor) VALUES (0, 'probe_entry', 'svc-commerce')"
        )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            restricted.execute("UPDATE intelligence.hermes_audit SET actor = 'tampered'")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            restricted.execute("DELETE FROM intelligence.hermes_audit")
    finally:
        restricted.close()


def test_create_app_wires_the_durable_stack_from_the_environment(pg_url, monkeypatch):
    """Finding 1, end to end: with HERMES_DATABASE_URL set, create_app() —
    with NO injected stores — runs the durable stack. A signed submission
    lands in PostgreSQL (readable by an independent raw connection) and the
    audit trail is written to the durable audit table."""
    from fastapi.testclient import TestClient

    from hermes.server import create_app

    monkeypatch.setenv("HERMES_DATABASE_URL", pg_url)
    monkeypatch.delenv("HERMES_ADMIN_DATABASE_URL", raising=False)
    app = create_app(callers=test_callers(), run_worker=False)
    assert app.state.storage_mode == "postgres"
    from hermes.postgres_store import PostgresAuditLog as _PAL
    from hermes.postgres_store import PostgresNonceStore as _PNS
    from hermes.postgres_store import PostgresTaskStore as _PTS

    assert isinstance(app.state.store, _PTS)
    assert isinstance(app.state.nonces, _PNS)
    assert isinstance(app.state.audit, _PAL)

    client = TestClient(app)
    body = submission_body(idempotency_key="idem-wired-app-0001")
    response = signed_json_request(client, COMMERCE, "POST", "/v1/tasks", body)
    assert response.status_code == 200
    assert response.json()["status"] == "SUCCEEDED"
    task_id = response.json()["task_id"]

    # Independent raw connection: the task is REALLY in PostgreSQL.
    raw = psycopg.connect(pg_url, row_factory=dict_row)
    raw.autocommit = True
    try:
        row = raw.execute(
            "SELECT submitted_by, status FROM intelligence.hermes_tasks WHERE task_id = %s",
            (task_id,),
        ).fetchone()
        assert row is not None and row["submitted_by"] == "svc-commerce" and row["status"] == "SUCCEEDED"
    finally:
        raw.close()

    # The audit trail landed in the durable table too.
    audit = PostgresAuditLog(pg_url)
    try:
        events = [e["event"] for e in audit.entries(limit=50)]
        assert "task_succeeded" in events
    finally:
        audit.close()


def test_admin_database_url_wires_the_infrastructure_role_separately(pg_url, rls_env, monkeypatch):
    """Finding 1+2 together: the tenant app role connection and the
    infrastructure/admin connection are wired separately, exactly as the
    deployment model prescribes — the app-role paths see tenant rows only,
    while the admin connection's role claims work."""
    from fastapi.testclient import TestClient

    from hermes.server import create_app

    monkeypatch.setenv("HERMES_DATABASE_URL", rls_env["urls"]["owner"])
    monkeypatch.setenv("HERMES_ADMIN_DATABASE_URL", rls_env["urls"]["admin"])
    app = create_app(callers=test_callers(), run_worker=False)
    assert app.state.storage_mode == "postgres"

    client = TestClient(app)
    body = submission_body(idempotency_key="idem-wired-split-0001")
    response = signed_json_request(client, COMMERCE, "POST", "/v1/tasks", body)
    assert response.status_code == 200
    task_id = response.json()["task_id"]

    # The admin path of the same app (separate connection, admin role).
    record = signed_json_request(client, ADMIN, "GET", f"/v1/tasks/{task_id}", None)
    assert record.status_code == 200
    assert record.json()["task_id"] == task_id


# ============================================================================
# Round-3 remediation tests: the connection/ownership model under restricted
# production-like roles — lifecycle saves carry owner context, the
# infrastructure capability is probed at startup, and worker mode without
# the required role fails startup instead of running silently idle.
# ============================================================================


def test_full_lifecycle_end_to_end_with_restricted_roles(pg_url, rls_env, monkeypatch):
    """Reviewer round-3 requirement: create → execute → save → read with
    restricted production-like roles. The app runs on the tenant app role
    with the infrastructure role wired separately; the whole synchronous
    lifecycle (create with owner context, route save, execute, success save,
    owner read) works and is visible at the database layer."""
    from fastapi.testclient import TestClient

    from hermes.server import create_app

    monkeypatch.setenv("HERMES_DATABASE_URL", rls_env["urls"]["owner"])
    monkeypatch.setenv("HERMES_ADMIN_DATABASE_URL", rls_env["urls"]["admin"])
    app = create_app(callers=test_callers(), run_worker=False)
    assert app.state.storage_mode == "postgres"
    assert app.state.infrastructure_capable is True

    client = TestClient(app)
    body = submission_body(idempotency_key="idem-r3-lifecycle-0001")
    response = signed_json_request(client, COMMERCE, "POST", "/v1/tasks", body)
    assert response.status_code == 200
    assert response.json()["status"] == "SUCCEEDED"  # create → route save → execute → save
    task_id = response.json()["task_id"]

    # READ as the verified owner (tenant connection, owner context).
    record = signed_json_request(client, COMMERCE, "GET", f"/v1/tasks/{task_id}", None)
    assert record.status_code == 200
    body_json = record.json()
    assert body_json["status"] == "SUCCEEDED"
    assert body_json["submitted_by"] == "svc-commerce"
    assert len(body_json["receipts"]) == 1

    # Independent raw connection: the lifecycle state is durable.
    raw = psycopg.connect(pg_url, row_factory=dict_row)
    raw.autocommit = True
    try:
        row = raw.execute(
            "SELECT status, worker_id, attempts, jsonb_array_length(receipts) AS receipts "
            "FROM intelligence.hermes_tasks WHERE task_id = %s",
            (task_id,),
        ).fetchone()
        assert row["status"] == "SUCCEEDED"
        assert row["attempts"] == 1 and row["receipts"] == 1
    finally:
        raw.close()


def test_sync_path_survives_tenant_only_restricted_wiring(pg_url, rls_env, monkeypatch):
    """Round-3 regression: with NO admin URL, the sync execution path
    (route save → execute → success save) runs on the RESTRICTED tenant
    connection. Lifecycle saves carry the record's owner context, so this
    works — against the previous behaviour it hit the RLS owner policy and
    the submission failed. Degraded infrastructure paths stay SAFE: the
    admin read of a foreign task is still hidden, and the capability probe
    announces exactly what is unavailable."""
    from fastapi.testclient import TestClient

    from hermes.server import create_app

    monkeypatch.setenv("HERMES_DATABASE_URL", rls_env["urls"]["owner"])
    monkeypatch.delenv("HERMES_ADMIN_DATABASE_URL", raising=False)
    app = create_app(callers=test_callers(), run_worker=False)
    assert app.state.storage_mode == "postgres"
    assert app.state.infrastructure_capable is False  # probed, announced

    client = TestClient(app)
    body = submission_body(idempotency_key="idem-r3-tenant-only-0001")
    response = signed_json_request(client, COMMERCE, "POST", "/v1/tasks", body)
    assert response.status_code == 200
    assert response.json()["status"] == "SUCCEEDED"
    task_id = response.json()["task_id"]

    record = signed_json_request(client, COMMERCE, "GET", f"/v1/tasks/{task_id}", None)
    assert record.status_code == 200 and record.json()["status"] == "SUCCEEDED"

    # Degraded-but-safe: the admin dead-letter list runs on a connection
    # that cannot see rows under RLS — an empty list, not an error or a leak.
    dead = signed_json_request(client, ADMIN, "GET", "/v1/admin/dead-letters", None)
    assert dead.status_code == 200 and dead.json() == []


def test_worker_mode_without_infrastructure_role_fails_startup(pg_url, rls_env, monkeypatch):
    """Round-3 requirement: worker mode enabled WITHOUT an
    infrastructure-capable role must fail startup LOUDLY — a worker on an
    RLS-bound role would log 'worker started' and then silently claim
    nothing forever."""
    from hermes.server import create_app

    monkeypatch.setenv("HERMES_DATABASE_URL", rls_env["urls"]["owner"])
    monkeypatch.delenv("HERMES_ADMIN_DATABASE_URL", raising=False)
    monkeypatch.setenv("HERMES_WORKER_MODE", "1")
    with pytest.raises(RuntimeError, match="infrastructure-capable"):
        create_app(callers=test_callers())


def test_worker_mode_with_admin_role_starts_and_executes(pg_url, rls_env, monkeypatch):
    """Round-3 requirement, happy path: worker mode with the
    intelligence_admin member wired as the infrastructure role starts, the
    worker really claims, and a submitted task completes end to end."""
    from fastapi.testclient import TestClient

    from hermes.server import create_app

    monkeypatch.setenv("HERMES_DATABASE_URL", rls_env["urls"]["owner"])
    monkeypatch.setenv("HERMES_ADMIN_DATABASE_URL", rls_env["urls"]["admin"])
    monkeypatch.setenv("HERMES_WORKER_MODE", "1")
    app = create_app(callers=test_callers())
    assert app.state.run_worker is True
    assert app.state.infrastructure_capable is True

    with TestClient(app) as client:  # lifespan starts the worker
        assert client.get("/version").json()["worker_running"] is True
        body = submission_body(idempotency_key="idem-r3-worker-0001")
        response = signed_json_request(client, COMMERCE, "POST", "/v1/tasks", body)
        assert response.status_code == 200
        assert response.json()["status"] == "QUEUED"  # worker mode: no sync execution
        task_id = response.json()["task_id"]

        # The background worker claims (infrastructure role) and executes.
        deadline = time.time() + 8
        status = None
        while time.time() < deadline:
            record = signed_json_request(client, COMMERCE, "GET", f"/v1/tasks/{task_id}", None)
            assert record.status_code == 200
            status = record.json()["status"]
            if status == "SUCCEEDED":
                break
            time.sleep(0.2)
        assert status == "SUCCEEDED"


def test_infrastructure_capability_probe_matches_roles(pg_url, rls_env):
    """Direct probe evidence: restricted app roles are NOT
    infrastructure-capable (FORCE RLS binds them), the intelligence_admin
    member and the bootstrap superuser ARE."""
    owner_store = PostgresTaskStore(rls_env["urls"]["owner"], apply_migrations=False)
    admin_store = PostgresTaskStore(rls_env["urls"]["admin"], apply_migrations=False)
    super_store = PostgresTaskStore(pg_url, apply_migrations=False)
    try:
        assert owner_store.infrastructure_capable is False
        assert admin_store.infrastructure_capable is True
        assert super_store.infrastructure_capable is True
    finally:
        owner_store.close()
        admin_store.close()
        super_store.close()
