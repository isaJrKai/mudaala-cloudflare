/**
 * SQL migration tests — fresh installation, repeatable re-execution,
 * constraints and views, against a DISPOSABLE embedded PostgreSQL.
 *
 * The database is spawned via dev-postgres.mjs (embedded-postgres binaries,
 * no docker, no production access) and migrated with the same runner CI
 * uses (apply-migrations.mjs). If HERMES_TEST_DATABASE_URL is provided
 * (e.g. a CI service container), that instance is used instead.
 */
import { describe, expect, afterAll, beforeAll, test } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import pg from 'pg'

const REPO = new URL('../../', import.meta.url).pathname

let pgProcess: Subprocess<'ignore', 'pipe', 'ignore'> | null = null
let databaseUrl: string | null = null

async function startDisposablePostgres(): Promise<string> {
  const proc = spawn(['bun', 'run', 'intelligence/jobs/dev-postgres.mjs', '--start'], {
    cwd: REPO,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  pgProcess = proc
  // Collect stderr on its own task — awaiting it inside the stdout loop
  // would block forever on a silent pipe.
  let stderrText = ''
  const stderrCollector = (async () => {
    try {
      for await (const chunk of proc.stderr) stderrText += new TextDecoder().decode(chunk)
    } catch {
      // stream closed
    }
  })()
  const decoder = new TextDecoder()
  const reader = proc.stdout.getReader()
  let buffer = ''
  const deadline = Date.now() + 60_000
  for (;;) {
    if (Date.now() > deadline) throw new Error(`embedded postgres did not report its URL in time. stderr: ${stderrText.slice(-500)}`)
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    const lineStart = buffer.indexOf('{')
    const lineEnd = buffer.indexOf('}', lineStart)
    if (lineStart !== -1 && lineEnd !== -1) {
      const parsed = JSON.parse(buffer.slice(lineStart, lineEnd + 1))
      return parsed.database_url as string
    }
    if (done) throw new Error(`embedded postgres exited before reporting its URL. stderr: ${stderrText.slice(-500)}`)
    await new Promise((r) => setTimeout(r, 100))
  }
  // unreachable — keeps pgProcess assignment below honest
  throw new Error('unreachable')
}

beforeAll(async () => {
  databaseUrl = process.env.HERMES_TEST_DATABASE_URL ?? (await startDisposablePostgres())
}, 90_000)

afterAll(async () => {
  if (pgProcess) {
    pgProcess.kill()
    await pgProcess.exited
  }
})

async function applyMigrations(url: string): Promise<string[]> {
  const proc = spawn(['bun', 'run', 'intelligence/jobs/apply-migrations.mjs', url], {
    cwd: REPO,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(`migration runner failed: ${await new Response(proc.stderr).text()}`)
  return out
}

describe('intelligence SQL migrations (disposable PostgreSQL)', () => {
  test('fresh installation creates the full schema and is repeatable', async () => {
    expect(databaseUrl).toBeTruthy()
    const client = new pg.Client({ connectionString: databaseUrl! })
    await client.connect()
    try {
      // Fresh: no intelligence objects exist before the first run.
      const before = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'intelligence'",
      )
      expect(before.rows.length).toBe(0)

      await applyMigrations(databaseUrl!)
      const tables = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'intelligence' ORDER BY table_name",
      )
      const names = tables.rows.map((r) => r.table_name as string)
      expect(names).toEqual(expect.arrayContaining(['jobs', 'event_outbox', 'hermes_tasks', 'hermes_nonces', 'migrations']))

      // Repeatable: a second full run applies nothing new and succeeds.
      await applyMigrations(databaseUrl!)
      const migrations = await client.query('SELECT name FROM intelligence.migrations ORDER BY name')
      expect(migrations.rows.length).toBeGreaterThanOrEqual(3)

      // The dead_letters view (formerly invalid `CREATE VIEW IF NOT EXISTS`) works.
      const view = await client.query('SELECT count(*)::int AS n FROM intelligence.dead_letters')
      expect(view.rows[0].n).toBe(0)
    } finally {
      await client.end()
    }
  })

  test('job idempotency is enforced by the database across connections', async () => {
    await applyMigrations(databaseUrl!) // idempotent re-application
    const client = new pg.Client({ connectionString: databaseUrl! })
    await client.connect()
    try {
      const insert = (submitter: string, kind: string, key: string) =>
        client.query(
          `INSERT INTO intelligence.jobs (kind, submitter, idempotency_key, payload, payload_canonical)
           VALUES ($1, $2, $3, '{"suite":"fixtures"}'::jsonb, '{"suite":"fixtures"}')`,
          [kind, submitter, key],
        )
      await insert('svc-a', 'EVAL_BENCHMARK_RUN', 'schema-test-key-1')
      let conflictFired = false
      try {
        await insert('svc-a', 'EVAL_BENCHMARK_RUN', 'schema-test-key-1')
      } catch {
        conflictFired = true
      }
      expect(conflictFired).toBe(true)
      // A different submitter with the same key is a DIFFERENT job.
      await insert('svc-b', 'EVAL_BENCHMARK_RUN', 'schema-test-key-1')
      // Payload conflicts are detectable via payload_canonical comparison in code.
      const rows = await client.query(
        "SELECT payload_canonical FROM intelligence.jobs WHERE submitter = 'svc-a' AND idempotency_key = 'schema-test-key-1'",
      )
      expect(rows.rows[0].payload_canonical).toBe('{"suite":"fixtures"}')
    } finally {
      await client.end()
    }
  })

  test('hermes task tables enforce the lifecycle contract and tenant columns', async () => {
    await applyMigrations(databaseUrl!) // idempotent re-application
    const client = new pg.Client({ connectionString: databaseUrl! })
    await client.connect()
    try {
      // Status CHECK covers the full remediation lifecycle.
      const check = await client.query(
        "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'hermes_tasks_status_check'",
      )
      expect(check.rows.length).toBe(1)
      const def = check.rows[0].def as string
      for (const status of ['SUBMITTED', 'VALIDATED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUSED', 'DEAD']) {
        expect(def).toContain(status)
      }
      // The owner column is NOT NULL — the tenant boundary is structural.
      const column = await client.query(
        "SELECT is_nullable FROM information_schema.columns WHERE table_schema='intelligence' AND table_name='hermes_tasks' AND column_name='submitted_by'",
      )
      expect(column.rows[0].is_nullable).toBe('NO')
      // Row-level security policies exist (defense in depth on tenant isolation).
      const policies = await client.query(
        "SELECT polname FROM pg_policy WHERE polrelid = 'intelligence.hermes_tasks'::regclass",
      )
      const polnames = policies.rows.map((r) => r.polname as string)
      expect(polnames).toContain('hermes_tasks_owner_access')
      expect(polnames).toContain('hermes_tasks_admin_access')
      // Nonce replay table is caller-scoped by primary key.
      const pk = await client.query(
        "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'hermes_nonces_pk'",
      )
      expect(pk.rows[0].def).toContain('PRIMARY KEY (caller_id, nonce)')
    } finally {
      await client.end()
    }
  })
})
