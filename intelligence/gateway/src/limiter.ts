/**
 * Rate limiting and nonce replay cache.
 *
 * Production uses the INTELLIGENCE_LIMITER Durable Object (do.ts); tests use
 * InMemoryLimiter. Both implement the same interfaces so the router is
 * runtime-agnostic.
 */

export interface RateLimiter {
  /** Returns true when the request is allowed under the per-minute limit. */
  check(key: string, limitPerMinute: number): Promise<boolean>
}

export interface NonceCache {
  /** Returns true if the nonce was already seen (replay). */
  seen(nonce: string): Promise<boolean>
  /** Records a nonce; entries expire after ttlSeconds. */
  record(nonce: string, ttlSeconds: number): Promise<void>
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

export class InMemoryNonceCache implements NonceCache {
  private entries = new Map<string, number>()

  constructor(private nowMs: () => number = () => Date.now()) {}

  async seen(nonce: string): Promise<boolean> {
    this.gc()
    return this.entries.has(nonce)
  }

  async record(nonce: string, ttlSeconds: number): Promise<void> {
    this.entries.set(nonce, this.nowMs() + ttlSeconds * 1000)
    this.gc()
  }

  private gc(): void {
    const now = this.nowMs()
    for (const [nonce, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(nonce)
    }
  }
}

/**
 * DO-backed adapters. The DO shards by key name; one DO instance handles both
 * rate windows and nonces for its shard, keeping the replay cache co-located
 * with the limiter decision (ADR-0002 §4).
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
    async seen(nonce: string): Promise<boolean> {
      const id = namespace.idFromName(`nonce:${nonce}`)
      const stub = namespace.get(id)
      const response = await stub.fetch('https://limiter.internal/nonce')
      const result = (await response.json()) as { seen: boolean }
      return result.seen
    },
    async record(nonce: string, ttlSeconds: number): Promise<void> {
      const id = namespace.idFromName(`nonce:${nonce}`)
      const stub = namespace.get(id)
      await stub.fetch(`https://limiter.internal/nonce-record?ttl=${ttlSeconds}`)
    },
  }
}
