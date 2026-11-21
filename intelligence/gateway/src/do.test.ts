/**
 * IntelligenceLimiter DO tests — atomic nonce consume, TTL expiry, alarm
 * cleanup, caller-safe rate limiting. Runs the real DO class against a fake
 * storage state (production semantics: the runtime serialises requests to
 * one object; the fake exercises the same synchronous decision block).
 */
import { describe, expect, test } from 'bun:test'
import { IntelligenceLimiter } from './do'

class FakeStorage {
  private map = new Map<string, unknown>()
  alarmAt: number | null = null
  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value)
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key)
  }
  async deleteAll(): Promise<void> {
    this.map.clear()
  }
  async list<T>(): Promise<Map<string, T>> {
    return new Map(this.map as Map<string, T>)
  }
  async setAlarm(time: number): Promise<void> {
    this.alarmAt = time
  }
}

function makeLimiter(nowMs: () => number) {
  const storage = new FakeStorage()
  const limiter = new IntelligenceLimiter({ storage } as never, nowMs)
  return { limiter, storage }
}

function consume(limiter: IntelligenceLimiter, ttl = 180): Promise<Response> {
  return limiter.fetch(new Request(`https://limiter.internal/consume?ttl=${ttl}`, { method: 'POST' }))
}

describe('IntelligenceLimiter atomic nonce consume', () => {
  test('first consume records; identical second consume is a replay', async () => {
    let now = 1_000_000
    const { limiter } = makeLimiter(() => now)
    expect(((await consume(limiter)) as Response).status).toBe(200)
    expect(await (await consume(limiter)).json()).toEqual({ seen: true })
    expect(await (await consume(limiter)).json()).toEqual({ seen: true })
    void now
  })

  test('two CONCURRENT consumes admit exactly one (the TOCTOU regression)', async () => {
    const { limiter } = makeLimiter(() => 1_000_000)
    const [a, b, c] = await Promise.all([consume(limiter), consume(limiter), consume(limiter)])
    const seen = await Promise.all([a.json(), b.json(), c.json()]) as Array<{ seen: boolean }>
    expect(seen.filter((r) => r.seen === false).length).toBe(1)
    expect(seen.filter((r) => r.seen === true).length).toBe(2)
  })

  test('expired records are safely overwritten and admit the nonce again', async () => {
    let now = 2_000_000
    const { limiter } = makeLimiter(() => now)
    expect(((await consume(limiter, 10)) as Response).status).toBe(200)
    expect(await (await consume(limiter, 10)).json()).toEqual({ seen: true })
    now += 11_000 // past the 10s TTL
    expect(await (await consume(limiter, 10)).json()).toEqual({ seen: false })
  })

  test('consume arms an alarm at expiry; alarm() clears storage (bounded growth)', async () => {
    let now = 3_000_000
    const { limiter, storage } = makeLimiter(() => now)
    await consume(limiter, 180)
    expect(storage.alarmAt).toBe(3_000_000 + 180_000)
    now += 180_001
    await limiter.alarm()
    const map = await storage.list()
    expect(map.size).toBe(0)
    // Post-cleanup the nonce is free again and the alarm re-arms on consume.
    expect(await (await consume(limiter, 180)).json()).toEqual({ seen: false })
    expect(storage.alarmAt).toBe(3_180_001 + 180_000)
  })

  test('ttl is clamped to the safe range', async () => {
    let now = 4_000_000
    const { limiter, storage } = makeLimiter(() => now)
    await limiter.fetch(new Request('https://limiter.internal/consume?ttl=99999999', { method: 'POST' }))
    expect(storage.alarmAt).toBe(4_000_000 + 3_600_000) // MAX_NONCE_TTL_S
    now += 3_600_001
    await limiter.fetch(new Request('https://limiter.internal/consume?ttl=banana', { method: 'POST' }))
    expect(await (await consume(limiter)).json()).toEqual({ seen: true }) // fresh record at clamped ttl
  })
})

describe('IntelligenceLimiter rate window', () => {
  test('malformed limit clamps to the safe default (60) instead of admitting all', async () => {
    const { limiter } = makeLimiter(() => 5_000_000)
    const statuses: boolean[] = []
    for (let i = 0; i < 61; i++) {
      const response = await limiter.fetch(new Request('https://limiter.internal/rate?limit=banana'))
      statuses.push(((await response.json()) as { allowed: boolean }).allowed)
    }
    expect(statuses.every((s) => s === true)).toBe(false)
    expect(statuses.filter((s) => s === false).length).toBeGreaterThan(0)
  })

  test('out-of-range limits clamp (1..10000)', async () => {
    const { limiter } = makeLimiter(() => 6_000_000)
    const deny = await (await limiter.fetch(new Request('https://limiter.internal/rate?limit=-5'))).json()
    expect(deny).toEqual({ allowed: true }) // first request still allowed at limit=1
    const second = await (await limiter.fetch(new Request('https://limiter.internal/rate?limit=-5'))).json()
    expect(second).toEqual({ allowed: false })
  })

  test('unknown route is 404 and failures fail closed', async () => {
    const { limiter } = makeLimiter(() => 7_000_000)
    expect((await limiter.fetch(new Request('https://limiter.internal/nope'))).status).toBe(404)
  })
})
