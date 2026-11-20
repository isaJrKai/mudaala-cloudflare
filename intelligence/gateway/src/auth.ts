/**
 * Intelligence gateway — HMAC service authentication and caller registry.
 *
 * Scheme (ADR-0002): each caller has a caller id, secret id and shared secret
 * (stored in worker secrets, never Git). The signature authenticates the body:
 *
 *   canonical  = callerId \n secretId \n METHOD \n /path \n timestampSeconds \n sha256Hex(body)
 *   signature  = hex(HMAC-SHA256(secret, canonical))
 *
 * Headers: x-mudaala-caller, x-mudaala-secret-id, x-mudaala-timestamp,
 * x-mudaala-nonce, x-mudaala-signature (and optional x-mudaala-trace-id).
 *
 * Failure modes are stable error codes (see contracts/envelope.ts):
 * AUTH_MISSING, AUTH_BAD_SIGNATURE, AUTH_REPLAY, AUTH_CLOCK_SKEW, SCOPE_DENIED.
 * The nonce replay cache and per-caller rate limits live in the limiter DO.
 */

export interface CallerConfig {
  callerId: string
  secretId: string
  secret: string
  scopes: string[]
  /** Requests per minute; bounded by the DO limiter. */
  rateLimitPerMinute: number
  enabled: boolean
}

export type AuthFailureCode =
  | 'AUTH_MISSING'
  | 'AUTH_BAD_SIGNATURE'
  | 'AUTH_REPLAY'
  | 'AUTH_CLOCK_SKEW'
  | 'SCOPE_DENIED'

export interface AuthSuccess {
  ok: true
  caller: CallerConfig
  nonce: string
}

export interface AuthFailure {
  ok: false
  code: AuthFailureCode
  message: string
}

export const CLOCK_SKEW_SECONDS = 90

const AUTH_HEADER_NAMES = [
  'x-mudaala-caller',
  'x-mudaala-secret-id',
  'x-mudaala-timestamp',
  'x-mudaala-nonce',
  'x-mudaala-signature',
] as const

/** SHA-256 hex of a byte array (WebCrypto). */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** HMAC-SHA256 over the canonical string (WebCrypto, constant-time via compare below). */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
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

/** Constant-time equality for two same-length hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function buildCanonicalString(parts: {
  callerId: string
  secretId: string
  method: string
  path: string
  timestamp: string
  bodyHash: string
}): string {
  return [parts.callerId, parts.secretId, parts.method, parts.path, parts.timestamp, parts.bodyHash].join('\n')
}

/** Client-side signing helper — the commerce-plane client mirrors this exactly (golden test vector in auth.test.ts). */
export async function signRequest(parts: {
  secret: string
  callerId: string
  secretId: string
  method: string
  path: string
  timestamp: string
  body: string
  nonce: string
}): Promise<{ signature: string; bodyHash: string; headers: Record<string, string> }> {
  const bodyHash = await sha256Hex(new TextEncoder().encode(parts.body))
  const canonical = buildCanonicalString({
    callerId: parts.callerId,
    secretId: parts.secretId,
    method: parts.method,
    path: parts.path,
    timestamp: parts.timestamp,
    bodyHash,
  })
  const signature = await hmacSha256Hex(parts.secret, canonical)
  return {
    signature,
    bodyHash,
    headers: {
      'x-mudaala-caller': parts.callerId,
      'x-mudaala-secret-id': parts.secretId,
      'x-mudaala-timestamp': parts.timestamp,
      'x-mudaala-nonce': parts.nonce,
      'x-mudaala-signature': signature,
    },
  }
}

export interface VerifyInput {
  request: Request
  bodyText: string
  /** Registry keyed by callerId. */
  callers: Map<string, CallerConfig>
  /** Seconds; injected for tests. */
  nowSeconds: number
}

export async function verifyServiceAuth(input: VerifyInput): Promise<AuthSuccess | AuthFailure> {
  const headers = input.request.headers
  const missing = AUTH_HEADER_NAMES.filter((name) => !headers.get(name))
  if (missing.length > 0) {
    return { ok: false, code: 'AUTH_MISSING', message: `missing auth headers: ${missing.join(', ')}` }
  }
  const callerId = headers.get('x-mudaala-caller')!
  const secretId = headers.get('x-mudaala-secret-id')!
  const timestamp = headers.get('x-mudaala-timestamp')!
  const nonce = headers.get('x-mudaala-nonce')!
  const signature = headers.get('x-mudaala-signature')!

  const caller = input.callers.get(callerId)
  if (!caller || !caller.enabled) {
    return { ok: false, code: 'AUTH_BAD_SIGNATURE', message: 'unknown or disabled caller' }
  }
  if (caller.secretId !== secretId) {
    return { ok: false, code: 'AUTH_BAD_SIGNATURE', message: 'secret id mismatch' }
  }

  const ts = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(ts)) {
    return { ok: false, code: 'AUTH_CLOCK_SKEW', message: 'timestamp not an integer' }
  }
  if (Math.abs(input.nowSeconds - ts) > CLOCK_SKEW_SECONDS) {
    return { ok: false, code: 'AUTH_CLOCK_SKEW', message: 'timestamp outside the ±90s window' }
  }

  const url = new URL(input.request.url)
  const bodyHash = await sha256Hex(new TextEncoder().encode(input.bodyText))
  const canonical = buildCanonicalString({
    callerId,
    secretId,
    method: input.request.method,
    path: url.pathname,
    timestamp,
    bodyHash,
  })
  const expected = await hmacSha256Hex(caller.secret, canonical)
  if (!timingSafeEqualHex(expected, signature.toLowerCase())) {
    return { ok: false, code: 'AUTH_BAD_SIGNATURE', message: 'signature mismatch' }
  }

  return { ok: true, caller, nonce }
}

export function scopeAllowed(caller: CallerConfig, requiredScope: string): boolean {
  return caller.scopes.includes(requiredScope)
}

/**
 * Caller registry from the INTELLIGENCE_CALLERS env var (JSON map keyed by
 * callerId). Secrets themselves come from wrangler secrets; in this registry
 * the value IS the secret reference the operator provisioned. Format:
 * { "<callerId>": { "secretId": "...", "secret": "...", "scopes": ["search:rank"],
 *   "rateLimitPerMinute": 120, "enabled": true } }
 */
export function parseCallerRegistry(json: string | undefined): Map<string, CallerConfig> {
  const registry = new Map<string, CallerConfig>()
  if (!json) return registry
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('INTELLIGENCE_CALLERS is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('INTELLIGENCE_CALLERS must be a JSON object')
  }
  for (const [callerId, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue
    const value = raw as Record<string, unknown>
    if (typeof value.secretId !== 'string' || typeof value.secret !== 'string') {
      throw new Error(`caller ${callerId} is missing secretId/secret`)
    }
    registry.set(callerId, {
      callerId,
      secretId: value.secretId,
      secret: value.secret,
      scopes: Array.isArray(value.scopes) ? (value.scopes as string[]) : [],
      rateLimitPerMinute: typeof value.rateLimitPerMinute === 'number' ? value.rateLimitPerMinute : 60,
      enabled: value.enabled !== false,
    })
  }
  return registry
}
