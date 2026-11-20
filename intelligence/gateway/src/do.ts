/**
 * IntelligenceLimiter — Durable Object for rate limiting and nonce replay
 * protection. One instance per shard key (see limiter.ts adapters):
 *   rate:<callerId>      → fixed-window rate limiter
 *   n:<callerId>:<nonce> → the replay record of exactly one nonce
 *
 * CONCURRENCY (increment-1 remediation): checking a nonce and recording it is
 * now ONE atomic operation. The increment-1 split (`/nonce` check, then
 * `/nonce-record`) allowed two concurrent requests to both pass the check
 * before either recorded — a replay window. The DO runtime serialises
 * requests to a single object (input gates), and the consume handler makes
 * its decision in one synchronous block guarded by an in-memory claim map, so
 * two concurrent consumes can never both succeed, in production or in tests.
 *
 * STORAGE BOUNDS: every consume arms an alarm at the record's expiry;
 * alarm() deletes the shard's storage, so a nonce record never outlives its
 * TTL and the namespace cannot grow without bound. Expired records are also
 * treated as absent when seen (safe overwrite either way).
 *
 * Endpoints (internal, called only via the DO binding):
 *   GET  /rate?limit=N    → { allowed: boolean }   fixed 60s window
 *   POST /consume?ttl=S   → { seen: boolean }      atomic check-and-record
 */

const RATE_WINDOW_MS = 60_000
const DEFAULT_NONCE_TTL_S = 180 // ≥ the ±90s clock window, twice over
const MIN_NONCE_TTL_S = 10
const MAX_NONCE_TTL_S = 3_600
const RECORD_KEY = 'record'

interface NonceRecord {
  expiresAtMs: number
}

export class IntelligenceLimiter {
  private state: DurableObjectState
  /** Sync claim map: storageKey → expiresAtMs for in-flight/known records. */
  private claimed = new Map<string, number>()

  constructor(state: DurableObjectState, private nowMs: () => number = () => Date.now()) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    try {
      if (url.pathname === '/rate') return await this.handleRate(url)
      if (url.pathname === '/consume') return await this.handleConsume(url)
      return this.json({ error: 'unknown route' }, 404)
    } catch {
      // Fail closed: if the limiter is unavailable, reject the request.
      return this.json({ allowed: false, seen: true, error: 'limiter failure' }, 500)
    }
  }

  private async handleRate(url: URL): Promise<Response> {
    const parsed = Number.parseInt(url.searchParams.get('limit') ?? '60', 10)
    // Malformed or out-of-range limits clamp to the safe window; never NaN.
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 10_000) : 60
    const key = 'window'
    const now = this.nowMs()
    const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS
    const entry = (await this.state.storage.get<{ count: number; windowStart: number }>(key)) ?? {
      count: 0,
      windowStart,
    }
    if (entry.windowStart !== windowStart) {
      await this.state.storage.put(key, { count: 1, windowStart })
      return this.json({ allowed: true })
    }
    if (entry.count >= limit) return this.json({ allowed: false })
    await this.state.storage.put(key, { count: entry.count + 1, windowStart })
    return this.json({ allowed: true })
  }

  /**
   * Atomic nonce check-and-record. The reject/accept decision is made in ONE
   * synchronous block (the claim map is updated before any await), so two
   * concurrent consumes on the same object cannot both admit the nonce. The
   * claim map also covers the window between the storage read and write for
   * interleaved test harnesses; real DO input gates serialise requests on
   * top of this.
   */
  private async handleConsume(url: URL): Promise<Response> {
    const ttlRaw = Number.parseInt(url.searchParams.get('ttl') ?? String(DEFAULT_NONCE_TTL_S), 10)
    const ttl = Number.isFinite(ttlRaw)
      ? Math.min(Math.max(ttlRaw, MIN_NONCE_TTL_S), MAX_NONCE_TTL_S)
      : DEFAULT_NONCE_TTL_S
    const now = this.nowMs()

    // Sync pre-check: a concurrent consume already claimed this record.
    const claimedExpiry = this.claimed.get(RECORD_KEY)
    if (claimedExpiry !== undefined && claimedExpiry > now) return this.json({ seen: true })

    const stored = await this.state.storage.get<NonceRecord>(RECORD_KEY)
    const now2 = this.nowMs()
    // ---- decision block: synchronous until the claim is recorded ----
    // Re-check the claim map AFTER the await: another interleaved consume may
    // have claimed the record while this request was suspended. From here to
    // the claim write there is no await, so exactly one caller decides "fresh".
    const claimedAfter = this.claimed.get(RECORD_KEY)
    if (stored && stored.expiresAtMs > now2) {
      this.claimed.set(RECORD_KEY, stored.expiresAtMs)
      return this.json({ seen: true })
    }
    if (claimedAfter !== undefined && claimedAfter > now2) {
      return this.json({ seen: true })
    }
    // Expired (or absent) record: safe to overwrite with a fresh TTL.
    const expiresAtMs = now2 + ttl * 1000
    this.claimed.set(RECORD_KEY, expiresAtMs)
    await this.state.storage.put(RECORD_KEY, { expiresAtMs })
    await this.state.storage.setAlarm(expiresAtMs)
    return this.json({ seen: false })
  }

  /**
   * Alarm fired at the record's expiry: delete the shard's storage so the
   * nonce namespace cannot grow without bound. If the record outlived the
   * alarm (refresh), the next consume re-arms the alarm.
   */
  async alarm(): Promise<void> {
    const stored = await this.state.storage.get<NonceRecord>(RECORD_KEY)
    if (!stored || stored.expiresAtMs <= this.nowMs()) {
      await this.state.storage.deleteAll()
      this.claimed.clear()
    }
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
}
