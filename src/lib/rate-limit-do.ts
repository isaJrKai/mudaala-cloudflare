import { DurableObject } from 'cloudflare:workers'

export interface RateLimitVerdict {
  ok: boolean
  retryAfterSeconds: number
}

const MAX_WINDOW_MS = 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Prototype shared rate-limit shard.
 *
 * Multiple logical keys share a bounded number of SQLite-backed Durable
 * Objects. Each method performs its read/modify/write sequence synchronously
 * through SQLite, with no network await between checking and inserting.
 * Callers must pass a one-way hash of their logical key, never a phone,
 * address, OTP, or session token.
 */
export class RateLimitShard extends DurableObject {
  private cleanupAlarmEnsured = false

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS rate_limit_hits (key_hash TEXT NOT NULL, occurred_at INTEGER NOT NULL)',
    )
    this.ctx.storage.sql.exec(
      'CREATE INDEX IF NOT EXISTS rate_limit_hits_key_time ON rate_limit_hits (key_hash, occurred_at)',
    )
    this.ctx.storage.sql.exec(
      'CREATE INDEX IF NOT EXISTS rate_limit_hits_time ON rate_limit_hits (occurred_at)',
    )
  }

  async hit(keyHash: string, max: number, windowMs: number, now = Date.now()): Promise<RateLimitVerdict> {
    if (!/^[a-f0-9]{64}$/.test(keyHash)) throw new Error('Invalid rate-limit key digest')
    if (!Number.isSafeInteger(max) || max < 1 || max > 100_000) throw new Error('Invalid rate-limit maximum')
    if (!Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > MAX_WINDOW_MS) throw new Error('Invalid rate-limit window')
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid rate-limit timestamp')

    // Prune this key's expired events on the hot path. A daily alarm handles
    // global cleanup, avoiding a table-wide expiry scan on every request.
    this.ctx.storage.sql.exec(
      'DELETE FROM rate_limit_hits WHERE key_hash = ? AND occurred_at <= ?',
      keyHash,
      now - windowMs,
    )

    const row = this.ctx.storage.sql
      .exec<{ count: number; oldest: number | null }>(
        'SELECT COUNT(*) AS count, MIN(occurred_at) AS oldest FROM rate_limit_hits WHERE key_hash = ?',
        keyHash,
      )
      .one()

    if (row.count >= max) {
      const oldest = row.oldest ?? now
      await this.ensureCleanupAlarm()
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
      }
    }

    this.ctx.storage.sql.exec(
      'INSERT INTO rate_limit_hits (key_hash, occurred_at) VALUES (?, ?)',
      keyHash,
      now,
    )
    await this.ensureCleanupAlarm()
    return { ok: true, retryAfterSeconds: 0 }
  }

  async clear(keyHash: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(keyHash)) throw new Error('Invalid rate-limit key digest')
    this.ctx.storage.sql.exec('DELETE FROM rate_limit_hits WHERE key_hash = ?', keyHash)
    await this.ensureCleanupAlarm()
  }

  async alarm(): Promise<void> {
    this.ctx.storage.sql.exec(
      'DELETE FROM rate_limit_hits WHERE occurred_at <= ?',
      Date.now() - MAX_WINDOW_MS,
    )
    const remaining = this.ctx.storage.sql
      .exec<{ count: number }>('SELECT COUNT(*) AS count FROM rate_limit_hits')
      .one().count
    // Do not schedule perpetual daily alarms for a shard whose buckets have
    // all expired. The next request will schedule cleanup again if needed.
    if (remaining > 0) {
      await this.ctx.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS)
      this.cleanupAlarmEnsured = true
    } else {
      this.cleanupAlarmEnsured = false
    }
  }

  private async ensureCleanupAlarm(): Promise<void> {
    if (this.cleanupAlarmEnsured) return
    const alarm = await this.ctx.storage.getAlarm()
    if (alarm === null) await this.ctx.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS)
    this.cleanupAlarmEnsured = true
  }
}
