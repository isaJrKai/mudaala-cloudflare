/**
 * Intelligence gateway — worker entry point.
 *
 * Request pipeline for /v1/*:
 *   1. kill switch (INTELLIGENCE_GATEWAY_DISABLED) → 503 MODULE_DISABLED
 *   2. Content-Length fast-fail (a hint only — never the real protection)
 *   3. payload cap ENFORCED WHILE STREAMING the body → 413 PAYLOAD_TOO_LARGE
 *      (measured in UTF-8 bytes; oversized streams are cancelled, not buffered)
 *   4. HMAC service auth (verifyServiceAuth, over the exact request bytes)
 *   5. nonce replay — ONE atomic check-and-record (limiter DO)
 *   6. per-caller rate limit (limiter DO)
 *   7. route match + scope check → 404/403
 *   8. strict UTF-8 decode + JSON parse → 400 PAYLOAD_INVALID
 *   9. handler dispatch under a 5 s deadline → envelope or envelope error
 *
 * Health/version endpoints carry no data and require no auth. Error responses
 * never echo internal details: validation failures are generic, unexpected
 * failures return MODULE_INTERNAL with a stable message (details go to the
 * structured log, which carries trace id, caller id, route and outcome only —
 * never request bodies).
 */

import { ZodError } from 'zod'
import { verifyServiceAuth, parseCallerRegistry, scopeAllowed } from './auth'
import { createDoLimiter, createDoNonceCache, InMemoryLimiter, InMemoryNonceCache } from './limiter'
import { createDefaultEnv, routeFor, ROUTES, UPSTREAM_DEADLINE_MS, MAX_PAYLOAD_BYTES, type GatewayEnv } from './handlers'
import type { GatewayErrorCode } from '../../contracts/envelope'

const WORKER_VERSION = '0.1.0'
const NONCE_TTL_SECONDS = 180

function buildEnv(env: Env): GatewayEnv {
  const base = createDefaultEnv()
  const hasDoBinding = typeof (env as { INTELLIGENCE_LIMITER?: unknown }).INTELLIGENCE_LIMITER === 'object'
  return {
    ...base,
    callers: parseCallerRegistry(env.INTELLIGENCE_CALLERS),
    limiter: hasDoBinding ? createDoLimiter(env.INTELLIGENCE_LIMITER) : new InMemoryLimiter(),
    nonces: hasDoBinding ? createDoNonceCache(env.INTELLIGENCE_LIMITER) : new InMemoryNonceCache(),
    version: env.GATEWAY_VERSION ?? WORKER_VERSION,
  }
}

function errorResponse(code: GatewayErrorCode, message: string, traceId: string, status: number, retryable = false): Response {
  const body = {
    error: { code, message: message.slice(0, 256), trace_id: traceId, retryable },
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-mudaala-trace-id': traceId,
      'cache-control': 'no-store',
    },
  })
}

function statusForError(code: GatewayErrorCode): number {
  switch (code) {
    case 'AUTH_MISSING':
    case 'AUTH_BAD_SIGNATURE':
    case 'AUTH_CLOCK_SKEW':
      return 401
    case 'AUTH_REPLAY':
    case 'IDEMPOTENCY_CONFLICT':
      return 409
    case 'SCOPE_DENIED':
      return 403
    case 'PAYLOAD_TOO_LARGE':
      return 413
    case 'PAYLOAD_INVALID':
      return 400
    case 'RATE_LIMITED':
      return 429
    case 'MODULE_DISABLED':
    case 'JOB_STORE_UNAVAILABLE':
      return 503
    case 'MODULE_TIMEOUT':
      return 504
    case 'MODULE_INTERNAL':
      return 500
    default:
      return 500
  }
}

function logGatewayEvent(traceId: string, route: string, outcome: string, extra: Record<string, string | number> = {}): void {
  // Metadata only — never request bodies, never auth material.
  console.log(JSON.stringify({ evt: 'gateway', trace_id: traceId, route, outcome, ...extra }))
}

function newTraceId(): string {
  return `gw-${crypto.randomUUID()}`
}

/**
 * Stream the request body under a hard byte cap. Oversized requests are
 * rejected the moment the cap is exceeded: the reader is cancelled and the
 * remaining stream is never buffered. Malformed/incomplete streams surface
 * as STREAM_ERROR instead of throwing into the pipeline.
 */
async function readBodyCapped(
  request: Request,
  capBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: 'TOO_LARGE' | 'STREAM_ERROR' }> {
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > capBytes) {
        await reader.cancel('payload too large') // stop buffering immediately
        return { ok: false, reason: 'TOO_LARGE' }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, reason: 'STREAM_ERROR' }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, bytes }
}

export async function handleRequest(request: Request, env: Env, envOverrides?: Partial<GatewayEnv>): Promise<Response> {
  const gatewayEnv: GatewayEnv = { ...buildEnv(env), ...envOverrides }
  const url = new URL(request.url)
  const traceId = request.headers.get('x-mudaala-trace-id')?.slice(0, 128) || newTraceId()
  const routeLabel = `${request.method} ${url.pathname}`

  if (url.pathname === '/healthz' || url.pathname === '/version') {
    const body =
      url.pathname === '/healthz'
        ? { ok: true, service: 'mudaala-intelligence-gateway', version: gatewayEnv.version }
        : { service: 'mudaala-intelligence-gateway', version: gatewayEnv.version, v1_routes: Object.keys(ROUTES) }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  }

  // 1. Kill switch — a hard, explicit disable.
  if ((env.INTELLIGENCE_GATEWAY_DISABLED ?? '').trim().toLowerCase() === 'true') {
    return errorResponse('MODULE_DISABLED', 'gateway disabled by kill switch', traceId, 503)
  }

  // 2. Content-Length fast-fail. A hint only: chunked/missing/misleading
  // headers are all handled by the streaming cap in step 3.
  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader !== null) {
    const declared = Number.parseInt(contentLengthHeader, 10)
    if (Number.isFinite(declared) && declared > MAX_PAYLOAD_BYTES) {
      logGatewayEvent(traceId, routeLabel, 'rejected', { code: 'PAYLOAD_TOO_LARGE' })
      return errorResponse('PAYLOAD_TOO_LARGE', `payload exceeds ${MAX_PAYLOAD_BYTES} bytes`, traceId, 413)
    }
  }

  // 3. Read the body ONCE, capped, as raw bytes (UTF-8 bytes — never string
  // length, which counts UTF-16 code units). The signature is computed over
  // these exact bytes, so no decode/re-encode drift can break it.
  const bodyResult = await readBodyCapped(request, MAX_PAYLOAD_BYTES)
  if (!bodyResult.ok) {
    if (bodyResult.reason === 'TOO_LARGE') {
      logGatewayEvent(traceId, routeLabel, 'rejected', { code: 'PAYLOAD_TOO_LARGE' })
      return errorResponse('PAYLOAD_TOO_LARGE', `payload exceeds ${MAX_PAYLOAD_BYTES} bytes`, traceId, 413)
    }
    return errorResponse('PAYLOAD_INVALID', 'request stream failed before completion', traceId, 400)
  }
  const bodyBytes = bodyResult.bytes

  // 4. Service auth over the exact bytes.
  const auth = await verifyServiceAuth({
    request,
    bodyBytes,
    callers: gatewayEnv.callers,
    nowSeconds: gatewayEnv.nowSeconds(),
  })
  if (!auth.ok) {
    return errorResponse(auth.code, auth.message, traceId, statusForError(auth.code))
  }

  // 5. Nonce replay — ONE atomic check-and-record per (caller, nonce).
  // The increment-1 seen()/record() split had a TOCTOU window; consume()
  // closes it (see limiter.ts / do.ts).
  if (await gatewayEnv.nonces.consume(auth.nonce, auth.caller.callerId, NONCE_TTL_SECONDS)) {
    return errorResponse('AUTH_REPLAY', 'nonce already used', traceId, 409)
  }

  // 6. Rate limit per caller.
  const allowed = await gatewayEnv.limiter.check(`caller:${auth.caller.callerId}`, auth.caller.rateLimitPerMinute)
  if (!allowed) {
    return errorResponse('RATE_LIMITED', 'per-caller rate limit exceeded', traceId, 429, true)
  }

  // 7. Route + scope.
  const route = routeFor(url.pathname, request.method)
  if (!route) {
    return errorResponse('PAYLOAD_INVALID', `no route for ${request.method} ${url.pathname}`, traceId, 404)
  }
  if (route.scope && !scopeAllowed(auth.caller, route.scope)) {
    return errorResponse('SCOPE_DENIED', `caller lacks scope ${route.scope}`, traceId, 403)
  }

  // 8. Strict UTF-8 decode + JSON parse. Malformed bytes are rejected before
  // any engine sees them.
  let body: unknown
  try {
    if (bodyBytes.length === 0) {
      body = {}
    } else {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes))
    }
  } catch {
    return errorResponse('PAYLOAD_INVALID', 'body is not valid UTF-8 JSON', traceId, 400)
  }

  // 9. Dispatch under the upstream deadline.
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = (await Promise.race([
      route.handler(body, { traceId, callerId: auth.caller.callerId, env: gatewayEnv }),
      new Promise<never>((_, reject) => {
        deadlineTimer = setTimeout(() => reject(new Error('upstream deadline')), UPSTREAM_DEADLINE_MS)
      }),
    ])) as unknown
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-mudaala-trace-id': traceId,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof ZodError) {
      // Generic message: schema details are never echoed to the caller.
      return errorResponse('PAYLOAD_INVALID', 'request failed schema validation', traceId, 400)
    }
    const message = error instanceof Error ? error.message : 'module failure'
    if (message === 'upstream deadline') {
      return errorResponse('MODULE_TIMEOUT', 'module exceeded its deadline', traceId, 504, true)
    }
    if (message === 'PAYLOAD_TOO_LARGE') {
      return errorResponse('PAYLOAD_TOO_LARGE', 'payload exceeds the store cap', traceId, 413)
    }
    if (message === 'IDEMPOTENCY_CONFLICT') {
      return errorResponse('IDEMPOTENCY_CONFLICT', 'idempotency key already used with a different payload', traceId, 409)
    }
    // Unexpected failure: stable generic response, details only in the log.
    logGatewayEvent(traceId, routeLabel, 'error', {
      code: 'MODULE_INTERNAL',
      error_class: error instanceof Error ? error.name : 'unknown',
    })
    return errorResponse('MODULE_INTERNAL', 'internal module failure', traceId, 500, true)
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer)
  }
}

/** Worker entry (used by wrangler; tests call handleRequest directly). */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  },
}
