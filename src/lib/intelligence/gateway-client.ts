/**
 * Mudaala commerce plane → Intelligence Gateway client.
 *
 * ARCHITECTURAL CONTRACT (master plan §11.1, implementation map §2):
 * - This is the ONLY commerce-plane coupling to the intelligence plane.
 * - Bounded by construction: hard timeout, one clock-skew retry, circuit
 *   breaker, and a total-failure posture of `null`.
 * - Every failure resolves to `ok: false`; callers MUST keep their existing
 *   local behaviour. The client never throws.
 * - The client is disabled unless fully configured (see env-flags.ts). MCI-27
 *   is optionally wired to the seller analytics route, but remains OFF unless
 *   `INTELLIGENCE_MCI27_ENABLED=true`; all other product routes stay local.
 *
 * Signing mirrors intelligence/gateway/src/auth.ts exactly; parity is pinned
 * by a golden vector test (same canonical string, same HMAC).
 */

import { intelligenceClientConfigured, type IntelligenceClientEnv } from './env-flags'

export const GATEWAY_CLIENT_VERSION = 'gateway-client-v0.1.0'

export interface GatewayClientOptions {
  /** Overrides for tests. */
  fetchImpl?: typeof fetch
  nowSeconds?: () => number
  breaker?: { failureThreshold: number; openMs: number }
  timeoutMs?: number
}

export interface GatewayClientConfig {
  url: string
  callerId: string
  secretId: string
  secret: string
}

export type GatewayCallResult<T> = {
  ok: true
  status: number
  envelope: T
} | {
  ok: false
  /** Always null-safe: callers treat this as "use local fallback". */
  reason:
    | 'CLIENT_DISABLED'
    | 'BREAKER_OPEN'
    | 'TIMEOUT'
    | 'GATEWAY_ERROR'
    | 'INVALID_RESPONSE'
    | 'NETWORK_ERROR'
}

interface BreakerState {
  failures: number
  openedAtMs: number | null
}

const FAILURE_THRESHOLD = 3
const BREAKER_OPEN_MS = 30_000
const DEFAULT_TIMEOUT_MS = 800

const CLOCK_SKEW_RETRY_CODES = new Set(['AUTH_CLOCK_SKEW'])

function generateNonce(): string {
  return `cw-${crypto.randomUUID()}`
}

function generateTraceId(): string {
  return `cw-${crypto.randomUUID()}`
}

/** Client-side HMAC signing — must stay byte-identical to the gateway. */
async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data) as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(message) as BufferSource)
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function signGatewayRequest(config: GatewayClientConfig, parts: { method: string; path: string; timestamp: string; body: string; nonce: string }): Promise<Record<string, string>> {
  const bodyHash = await sha256Hex(parts.body)
  const canonical = [config.callerId, config.secretId, parts.method, parts.path, parts.timestamp, bodyHash].join('\n')
  const signature = await hmacSha256Hex(config.secret, canonical)
  return {
    'content-type': 'application/json',
    'x-mudaala-caller': config.callerId,
    'x-mudaala-secret-id': config.secretId,
    'x-mudaala-timestamp': parts.timestamp,
    'x-mudaala-nonce': parts.nonce,
    'x-mudaala-signature': signature,
  }
}

export function clientConfigFromEnv(env: IntelligenceClientEnv): GatewayClientConfig | null {
  if (!intelligenceClientConfigured(env)) return null
  return {
    url: env.INTELLIGENCE_GATEWAY_URL!.trim(),
    callerId: env.INTELLIGENCE_GATEWAY_CALLER_ID!.trim(),
    secretId: env.INTELLIGENCE_GATEWAY_SECRET_ID!.trim(),
    secret: env.INTELLIGENCE_GATEWAY_SECRET!.trim(),
  }
}

/**
 * Create a client instance. Each instance owns its circuit breaker state;
 * the commerce plane should hold one instance (per isolate) and reuse it.
 */
export function createGatewayClient(config: GatewayClientConfig | null, options: GatewayClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
  const failureThreshold = options.breaker?.failureThreshold ?? FAILURE_THRESHOLD
  const openMs = options.breaker?.openMs ?? BREAKER_OPEN_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const breaker: BreakerState = { failures: 0, openedAtMs: null }

  function breakerOpen(nowMs: number): boolean {
    if (breaker.openedAtMs === null) return false
    if (nowMs - breaker.openedAtMs >= openMs) {
      // Half-open: allow one probe.
      breaker.openedAtMs = null
      breaker.failures = failureThreshold - 1
      return false
    }
    return true
  }

  function recordFailure(nowMs: number): void {
    breaker.failures++
    if (breaker.failures >= failureThreshold) {
      breaker.openedAtMs = nowMs
    }
  }

  async function attempt<T>(path: string, body: unknown, traceId: string, nonce: string): Promise<{ status: number; envelope: T | null; errorCode: string | null }> {
    const bodyText = JSON.stringify(body)
    const timestamp = String(nowSeconds())
    const headers = await signGatewayRequest(config!, {
      method: 'POST',
      path,
      timestamp,
      body: bodyText,
      nonce,
    })
    headers['x-mudaala-trace-id'] = traceId
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`${config!.url}${path}`, {
        method: 'POST',
        headers,
        body: bodyText,
        signal: controller.signal,
      })
      const json = (await response.json().catch(() => null)) as ({ error?: { code?: string } } & object) | null
      if (response.status >= 400) {
        const errorCode = json?.error?.code ?? null
        return { status: response.status, envelope: null, errorCode }
      }
      if (json === null || typeof json !== 'object') {
        return { status: response.status, envelope: null, errorCode: 'INVALID_RESPONSE' }
      }
      return { status: response.status, envelope: json as T, errorCode: null }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    version: GATEWAY_CLIENT_VERSION,
    isConfigured(): boolean {
      return config !== null
    },
    breakerState(): 'closed' | 'open' {
      return breaker.openedAtMs !== null ? 'open' : 'closed'
    },
    /**
     * Call a gateway endpoint. Resolves to a typed result; NEVER rejects and
     * NEVER returns a partial envelope. On anything unexpected the caller
     * gets ok:false and must fall back to local behaviour.
     */
    async call<T>(path: string, body: unknown): Promise<GatewayCallResult<T>> {
      if (config === null) return { ok: false, reason: 'CLIENT_DISABLED' }
      const nowMs = Date.now()
      if (breakerOpen(nowMs)) return { ok: false, reason: 'BREAKER_OPEN' }

      const traceId = generateTraceId()
      try {
        let response = await attempt<T>(path, body, traceId, generateNonce())

        // Exactly one retry, only for a clock-skew rejection, with a fresh
        // timestamp and nonce (bounded cost — never general retries).
        if (response.status >= 400 && response.errorCode !== null && CLOCK_SKEW_RETRY_CODES.has(response.errorCode)) {
          response = await attempt<T>(path, body, traceId, generateNonce())
        }

        if (response.status >= 400) {
          recordFailure(nowMs)
          return { ok: false, reason: 'GATEWAY_ERROR' }
        }
        if (response.envelope === null) {
          recordFailure(nowMs)
          return { ok: false, reason: 'INVALID_RESPONSE' }
        }
        breaker.failures = 0
        return { ok: true, status: response.status, envelope: response.envelope }
      } catch (error) {
        const isTimeout = error instanceof Error && error.name === 'AbortError'
        recordFailure(nowMs)
        return { ok: false, reason: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR' }
      }
    },
  }
}
