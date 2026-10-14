import assert from 'node:assert/strict'

const BASE = process.env.RATE_LIMIT_PROTOTYPE_URL ?? 'http://127.0.0.1:8787'

async function request(path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(new URL(path, BASE))
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

async function main() {
  const health = await fetch(new URL('/health', BASE))
  assert.equal(health.status, 200, 'prototype Worker starts')

  const concurrentKey = 'concurrent-' + crypto.randomUUID()
  const burst = await Promise.all(Array.from({ length: 250 }, () =>
    request('/consume?key=' + encodeURIComponent(concurrentKey) + '&max=5&windowMs=60000'),
  ))
  assert.equal(burst.filter((r) => r.status === 200 && r.body?.ok === true).length, 5, 'exactly the configured five attempts pass from a 250-request concurrent burst')
  assert.equal(burst.filter((r) => r.status === 200 && r.body?.ok === false).length, 245, 'all 245 excess concurrent attempts are rejected')
  assert.ok(burst.filter((r) => r.body?.ok === false).every((r) => r.body.retryAfterSeconds >= 1), 'rejections include a positive retry delay')

  const isolationKey = 'isolation-' + crypto.randomUUID()
  const isolation = await request('/consume?key=' + encodeURIComponent(isolationKey) + '&max=1&windowMs=60000')
  assert.equal(isolation.body?.ok, true, 'distinct logical keys do not share counters')

  const expiryKey = 'expiry-' + crypto.randomUUID()
  const first = await request('/consume?key=' + encodeURIComponent(expiryKey) + '&max=1&windowMs=40&now=100000')
  const blocked = await request('/consume?key=' + encodeURIComponent(expiryKey) + '&max=1&windowMs=40&now=100000')
  assert.equal(first.body?.ok, true, 'first request in a window passes')
  assert.equal(blocked.body?.ok, false, 'second request in the same window is rejected')
  const afterExpiry = await request('/consume?key=' + encodeURIComponent(expiryKey) + '&max=1&windowMs=40&now=100041')
  assert.equal(afterExpiry.body?.ok, true, 'expired events no longer count')

  const clearKey = 'clear-' + crypto.randomUUID()
  await request('/consume?key=' + encodeURIComponent(clearKey) + '&max=1&windowMs=60000')
  const clear = await request('/clear?key=' + encodeURIComponent(clearKey))
  const afterClear = await request('/consume?key=' + encodeURIComponent(clearKey) + '&max=1&windowMs=60000')
  assert.equal(clear.body?.cleared, true, 'clear operation succeeds')
  assert.equal(afterClear.body?.ok, true, 'clear removes the key budget')

  console.log('Rate-limit Durable Object prototype: 10 assertions passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
