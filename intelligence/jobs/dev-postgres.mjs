/**
 * Disposable PostgreSQL for local tests — embedded-postgres binaries, no
 * docker, no production access. Used by intelligence/jobs/schema.test.ts and
 * by the Hermes Python tests (via the pytest fixture that spawns this script).
 *
 * Start (prints one JSON line: {"database_url": "...", "data_dir": "..."}):
 *   bun run intelligence/jobs/dev-postgres.mjs --start
 * Then SIGTERM the process to stop it cleanly (or --stop --data-dir <dir>).
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'

const args = process.argv.slice(2)

async function start() {
  const dataDir = mkdtempSync(join(tmpdir(), 'mudaala-pg-'))
  const port = 54300 + Math.floor(Math.random() * 2000)
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('intelligence_test')
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/intelligence_test`
  mkdirSync(dataDir, { recursive: true })

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    try {
      await pg.stop()
    } catch {
      // already down
    }
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      // best effort cleanup
    }
    process.exit(0)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)

  console.log(JSON.stringify({ database_url: url, data_dir: dataDir }))
  // Keep alive until signalled.
  setInterval(() => {}, 60_000)
}

async function stopByDataDir() {
  // A data-dir-only stop is not supported with the embedded client after a
  // fresh process start (postmaster.pid ownership); the parent must SIGTERM
  // the --start process. Documented in the usage header.
  console.error('use SIGTERM on the --start process to stop cleanly')
  process.exit(2)
}

if (args[0] === '--start') {
  await start()
} else if (args[0] === '--stop') {
  await stopByDataDir()
} else {
  console.error('usage: dev-postgres.mjs --start')
  process.exit(2)
}
