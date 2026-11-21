/**
 * Apply intelligence PostgreSQL migrations (reproducible, tracked).
 *
 * Applies `migrations/*.sql` in filename order, recording each applied file
 * in intelligence.migrations. Re-running is a no-op for already-applied
 * files — safe, repeatable migrations per the remediation requirements.
 *
 * Usage: DATABASE_URL=postgres://... bun run intelligence/jobs/apply-migrations.mjs
 * (or pass the URL as argv[2]). The target is ALWAYS a staging/disposable
 * database in this repo's workflows — never production (master plan §16).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, 'migrations')

const databaseUrl = process.argv[2] ?? process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL missing — pass it as argv[2] or via env')
  process.exit(1)
}

const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()

await client.query(`
  CREATE SCHEMA IF NOT EXISTS intelligence;
  CREATE TABLE IF NOT EXISTS intelligence.migrations (
    name        TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`)

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const { rows } = await client.query('SELECT name FROM intelligence.migrations')
const applied = new Set(rows.map((r) => r.name))

let appliedCount = 0
for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip (already applied): ${file}`)
    continue
  }
  const sql = readFileSync(join(migrationsDir, file), 'utf8')
  // Each migration applies atomically together with its tracking row.
  await client.query('BEGIN')
  try {
    await client.query(sql)
    await client.query('INSERT INTO intelligence.migrations (name) VALUES ($1)', [file])
    await client.query('COMMIT')
    appliedCount++
    console.log(`applied: ${file}`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

const verify = await client.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'intelligence' ORDER BY table_name
`)
console.log('intelligence tables:', verify.rows.map((r) => r.table_name).join(', '))
console.log(`migration run complete (${appliedCount} newly applied)`)
await client.end()
