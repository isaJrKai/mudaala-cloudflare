/**
 * Intelligence gateway — worker entry point.
 *
 * Request pipeline for /v1/*:
 *   1. kill switch (INTELLIGENCE_GATEWAY_DISABLED) → 503 MODULE_DISABLED
 *   2. payload cap (32 KiB) → 413 PAYLOAD_TOO_LARGE
 *   3. HMAC service auth (verifyServiceAuth)
 *   4. nonce replay check (limiter DO)
 *   5. per-caller rate limit (limiter DO)
 *   6. route match + scope check → 404/403
 *   7. JSON parse → 400 PAYLOAD_INVALID
 *   8. handler dispatch under a 5 s deadline → envelope or envelope error
 *
 * Health/version endpoints carry no data and require no auth. Response logs
 * carry trace id, caller id, route and outcome only — never request bodies.
 */

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
    case 'SCOPE_DENIED':
    case 'AUTH_CLOCK_SKEW':
      return 401
    case 'AUTH_REPLAY':
      return 409
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
    default:
      return 500
  }
}

function newTraceId(): string {
  return `gw-${crypto.randomUUID()}`
}

export async function handleRequest(request: Request, env: Env, envOverrides?: Partial<GatewayEnv>): Promise<Response> {
  const gatewayEnv: GatewayEnv = { ...buildEnv(env), ...envOverrides }
  const url = new URL(request.url)
  const traceId = request.headers.get('x-mudaala-trace-id')?.slice(0, 128) || newTraceId()

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

  // 2. Payload cap.
  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10)
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return errorResponse('PAYLOAD_TOO_LARGE', `payload exceeds ${MAX_PAYLOAD_BYTES} bytes`, traceId, 413)
  }

  // 3. Service auth (reads the body).
  const bodyText = await request.text()
  if (bodyText.length > MAX_PAYLOAD_BYTES) {
    return errorResponse('PAYLOAD_TOO_LARGE', `payload exceeds ${MAX_PAYLOAD_BYTES} bytes`, traceId, 413)
  }
  const auth = await verifyServiceAuth({
    request,
    bodyText,
    callers: gatewayEnv.callers,
    nowSeconds: gatewayEnv.nowSeconds(),
  })
  if (!auth.ok) {
    return errorResponse(auth.code, auth.message, traceId, statusForError(auth.code))
  }

  // 4. Nonce replay check + record.
  if (await gatewayEnv.nonces.seen(auth.nonce)) {
    return errorResponse('AUTH_REPLAY', 'nonce already used', traceId, 409)
  }
  await gatewayEnv.nonces.record(auth.nonce, NONCE_TTL_SECONDS)

  // 5. Rate limit per caller.
  const allowed = await gatewayEnv.limiter.check(`caller:${auth.caller.callerId}`, auth.caller.rateLimitPerMinute)
  if (!allowed) {
    return errorResponse('RATE_LIMITED', 'per-caller rate limit exceeded', traceId, 429, true)
  }

  // 6. Route + scope.
  const route = routeFor(url.pathname, request.method)
  if (!route) {
    return errorResponse('PAYLOAD_INVALID', `no route for ${request.method} ${url.pathname}`, traceId, 404)
  }
  if (route.scope && !scopeAllowed(auth.caller, route.scope)) {
    return errorResponse('SCOPE_DENIED', `caller lacks scope ${route.scope}`, traceId, 403)
  }

  // 7. JSON parse.
  let body: unknown
  try {
    body = bodyText.length === 0 ? {} : JSON.parse(bodyText)
  } catch {
    return errorResponse('PAYLOAD_INVALID', 'body is not valid JSON', traceId, 400)
  }

  // 8. Dispatch under the upstream deadline.
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
    const message = error instanceof Error ? error.message : 'module failure'
    if (message === 'upstream deadline') {
      return errorResponse('MODULE_TIMEOUT', 'module exceeded its deadline', traceId, 504, true)
    }
    return errorResponse('PAYLOAD_INVALID', `invalid request: ${message.slice(0, 200)}`, traceId, 400)
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
