/**
 * Rate limiting and nonce replay cache.
 *
 * Production uses the INTELLIGENCE_LIMITER Durable Object (do.ts); tests use
 * InMemoryLimiter / InMemoryNonceCache. Both implement the same interfaces so
 * the router is runtime-agnostic.
 *
 * Replay protection remediation: the nonce interface is a single atomic
 * `consume` — check-and-record in one call. The increment-1 `seen()`/`record()`
 * split allowed two concurrent requests to both pass the check (TOCTOU); that
 * interface no longer exists.
 */

export interface RateLimiter {
  /** Returns true when the request is allowed under the per-minute limit. */
  check(key: string, limitPerMinute: number): Promise<boolean>
}

export interface NonceCache {
  /**
   * Atomically check-and-record one nonce for one caller. Returns true when
   * the nonce was already consumed (replay — reject). Concurrent consumes of
   * the same (caller, nonce) pair: exactly one call ever observes false.
   */
  consume(nonce: string, callerId: string, ttlSeconds: number): Promise<boolean>
}

/** Fixed-window per-minute limiter, in-memory (tests / local dev). */
export class InMemoryLimiter implements RateLimiter {
  private windows = new Map<string, { count: number; windowStart: number }>()

  constructor(private nowMs: () => number = () => Date.now()) {}

  async check(key: string, limitPerMinute: number): Promise<boolean> {
    const now = this.nowMs()
    const windowStart = Math.floor(now / 60_000) * 60_000
    const entry = this.windows.get(key)
    if (!entry || entry.windowStart !== windowStart) {
      this.windows.set(key, { count: 1, windowStart })
      return true
    }
    if (entry.count >= limitPerMinute) return false
    entry.count++
    return true
  }
}

/**
 * In-memory nonce cache with atomic consume. The check-and-set happens in
 * one synchronous block (no await between), so concurrent consumers on the
 * JS single thread cannot both observe "fresh".
 */
export class InMemoryNonceCache implements NonceCache {
  private entries = new Map<string, number>()

  constructor(private nowMs: () => number = () => Date.now()) {}

  async consume(nonce: string, callerId: string, ttlSeconds: number): Promise<boolean> {
    this.gc()
    const key = `${callerId}\u0000${nonce}`
    const now = this.nowMs()
    const expiresAt = this.entries.get(key)
    if (expiresAt !== undefined && expiresAt > now) return true
    // Decision block — synchronous until the claim is recorded.
    this.entries.set(key, now + ttlSeconds * 1000)
    return false
  }

  private gc(): void {
    const now = this.nowMs()
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key)
    }
  }
}

/**
 * DO-backed adapters. The DO shards by key name; one DO instance handles the
 * rate window per caller, and exactly one DO instance owns each nonce record
 * (`n:<callerId>:<nonce>` — caller isolation: different callers never share a
 * nonce shard, so one caller cannot pre-burn another caller's nonces). The
 * consume decision is atomic inside the DO (see do.ts).
 */
export function createDoLimiter(namespace: DurableObjectNamespace): RateLimiter {
  return {
    async check(key: string, limitPerMinute: number): Promise<boolean> {
      const id = namespace.idFromName(`rate:${key}`)
      const stub = namespace.get(id)
      const response = await stub.fetch(`https://limiter.internal/rate?limit=${limitPerMinute}`)
      const result = (await response.json()) as { allowed: boolean }
      return result.allowed
    },
  }
}

export function createDoNonceCache(namespace: DurableObjectNamespace): NonceCache {
  return {
    async consume(nonce: string, callerId: string, ttlSeconds: number): Promise<boolean> {
      const id = namespace.idFromName(`n:${callerId}:${nonce}`)
      const stub = namespace.get(id)
      const response = await stub.fetch(`https://limiter.internal/consume?ttl=${ttlSeconds}`, { method: 'POST' })
      const result = (await response.json()) as { seen: boolean }
      return result.seen
    },
  }
}
