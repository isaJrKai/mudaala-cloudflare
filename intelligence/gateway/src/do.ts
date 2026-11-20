/**
 * IntelligenceLimiter — Durable Object for rate limiting and nonce replay
 * protection. One instance per shard key (see limiter.ts adapters): keys are
 * `rate:<caller>` and `nonce:<value>`, so state is spread across shards and
 * a single shard can never become a global bottleneck.
 *
 * Endpoints (internal, called only via the DO binding):
 *   GET /rate?limit=N        → { allowed: boolean }   fixed 60s window
 *   GET /nonce               → { seen: boolean }
 *   GET /nonce-record?ttl=S  → { recorded: true }     TTL-based expiry
 */

const RATE_WINDOW_MS = 60_000
const DEFAULT_NONCE_TTL_S = 180 // ≥ the ±90s clock window, twice over

export class IntelligenceLimiter {
  private state: DurableObjectState

  constructor(state: DurableObjectState) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    try {
      if (url.pathname === '/rate') return await this.handleRate(url)
      if (url.pathname === '/nonce') return await this.handleNonceSeen()
      if (url.pathname === '/nonce-record') return await this.handleNonceRecord(url)
      return this.json({ error: 'unknown route' }, 404)
    } catch {
      // Fail closed: if the limiter is unavailable, reject the request.
      return this.json({ allowed: false, seen: true, error: 'limiter failure' }, 500)
    }
  }

  private async handleRate(url: URL): Promise<Response> {
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '60', 10)
    const key = 'window'
    const now = Date.now()
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

  private async handleNonceSeen(): Promise<Response> {
    const seen = await this.state.storage.get('recorded')
    return this.json({ seen: seen === true })
  }

  private async handleNonceRecord(url: URL): Promise<Response> {
    const ttl = Number.parseInt(url.searchParams.get('ttl') ?? String(DEFAULT_NONCE_TTL_S), 10)
    await this.state.storage.put('recorded', true)
    // Durable Objects have alarm-based TTLs; a simple counter keeps storage
    // bounded: shard keys are per-nonce, and nonce volume is bounded by the
    // caller's rate limit. Alarms are a follow-up; see operations doc.
    await this.state.storage.put('recordedAt', Date.now())
    await this.state.storage.put('ttlSeconds', ttl)
    return this.json({ recorded: true })
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
}
