/**
 * Exercises the maintenance endpoint against the disposable CI database.
 * This deliberately runs only in CI; it never targets the production database.
 */
const BASE = process.env.APP_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const SECRET = process.env.CRON_SECRET

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function post(secret?: string) {
  return fetch(new URL('/api/cron/sweep', BASE), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      ...(secret ? { 'x-cron-secret': secret } : {}),
    },
  })
}

async function main() {
  assert(SECRET, 'CRON_SECRET must be provided by the disposable CI environment')

  const missing = await post()
  assert(missing.status === 403, `Missing secret should be rejected with 403, got ${missing.status}`)
  const wrong = await post('definitely-not-the-cron-secret')
  assert(wrong.status === 403, `Wrong secret should be rejected with 403, got ${wrong.status}`)

  const first = await post(SECRET)
  assert(first.status === 200, `Valid maintenance request should succeed, got ${first.status}: ${await first.text()}`)
  const firstBody = await first.json() as Record<string, unknown>
  for (const key of ['expired', 'expiringNotified', 'priceSnapshots']) {
    assert(typeof firstBody[key] === 'number' && Number.isInteger(firstBody[key]) && (firstBody[key] as number) >= 0,
      `Successful maintenance response must include a non-negative integer ${key}`)
  }

  // The sweep is designed to be safe to repeat: expired listings must not be
  // re-notified and daily snapshots must upsert rather than duplicate rows.
  const second = await post(SECRET)
  assert(second.status === 200, `Repeated maintenance request should remain safe, got ${second.status}: ${await second.text()}`)
  const secondBody = await second.json() as Record<string, unknown>
  assert(secondBody.expired === 0, 'Second sweep should not expire the same listings twice')
  assert(secondBody.expiringNotified === 0, 'Second sweep should not notify the same listings twice')
  assert(secondBody.priceSnapshots === firstBody.priceSnapshots,
    'Repeated sweep should report the same number of idempotently upserted price snapshots')

  console.log('Cron sweep endpoint: missing/wrong secret rejected; valid sweep succeeded; repeated sweep remained idempotent.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
