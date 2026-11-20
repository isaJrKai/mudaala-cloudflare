/**
 * Gateway pipeline tests — the full request path with in-memory limiter and
 * nonce cache (production uses the Durable Object; the router is runtime-
 * agnostic by design, see limiter.ts).
 */
import { describe, expect, test } from 'bun:test'
import { handleRequest } from './index'
import { signRequest } from './auth'
import { InMemoryLimiter, InMemoryNonceCache } from './limiter'
import { MemoryJobStore } from './handlers'
import type { CallerConfig } from './auth'
import type { Env } from './types'

const CALLER: CallerConfig = {
  callerId: 'mudaala-commerce',
  secretId: 'key-2026-11',
  secret: 'test-secret-do-not-use-in-prod',
  scopes: ['search:understand', 'search:plan', 'search:rank', 'search:diversify', 'merchant:insights', 'jobs:submit', 'jobs:read'],
  rateLimitPerMinute: 5,
  enabled: true,
}

const NOW_SECONDS = 1_768_938_000

function testEnv(): { env: Env; overrides: Record<string, unknown> } {
  return {
    env: {} as Env,
    overrides: {
      callers: new Map([[CALLER.callerId, CALLER]]),
      limiter: new InMemoryLimiter(() => NOW_SECONDS * 1000),
      nonces: new InMemoryNonceCache(() => NOW_SECONDS * 1000),
      nowSeconds: () => NOW_SECONDS,
      nowMs: () => NOW_SECONDS * 1000,
    },
  }
}

async function post(path: string, body: unknown, options?: { nonce?: string; caller?: CallerConfig; env?: { env: Env; overrides: Record<string, unknown> } }): Promise<Response> {
  const ctx = options?.env ?? testEnv()
  const caller = options?.caller ?? CALLER
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body)
  const { headers } = await signRequest({
    secret: caller.secret,
    callerId: caller.callerId,
    secretId: caller.secretId,
    method: 'POST',
    path,
    timestamp: String(NOW_SECONDS),
    body: bodyText,
    nonce: options?.nonce ?? `nonce-${Math.random().toString(36).slice(2, 10)}`,
  })
  return handleRequest(new Request(`https://gateway.internal${path}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: bodyText }), ctx.env, ctx.overrides)
}

describe('health and kill switch', () => {
  test('healthz is open, carries no data, and reports version', async () => {
    const { env, overrides } = testEnv()
    const response = await handleRequest(new Request('https://gateway.internal/healthz'), env, overrides)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; service: string; version: string }
    expect(body.ok).toBe(true)
    expect(body.service).toBe('mudaala-intelligence-gateway')
    expect(body.version).toBe('0.1.0')
  })

  test('version lists the six v1 routes', async () => {
    const { env, overrides } = testEnv()
    const response = await handleRequest(new Request('https://gateway.internal/version'), env, overrides)
    const body = (await response.json()) as { v1_routes: string[] }
    expect(body.v1_routes.length).toBe(6)
    expect(body.v1_routes).toContain('/v1/search/understand')
    expect(body.v1_routes).toContain('/v1/jobs')
  })

  test('kill switch returns 503 MODULE_DISABLED and bypasses nothing', async () => {
    const { env, overrides } = testEnv()
    const response = await post('/v1/search/understand', { query: 'rice' }, { env: { env: { ...env, INTELLIGENCE_GATEWAY_DISABLED: 'true' }, overrides } })
    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('MODULE_DISABLED')
  })
})

describe('authenticated module dispatch', () => {
  test('MCI-01 understand returns a valid envelope', async () => {
    const response = await post('/v1/search/understand', { query: 'kitenge dresses under 80k' })
    expect(response.status).toBe(200)
    const envelope = (await response.json()) as { module_id: string; result: { price_filter: { max: number } }; trace_id: string; confidence: null }
    expect(envelope.module_id).toBe('MCI-01')
    expect(envelope.result.price_filter?.max).toBe(80_000)
    expect(envelope.confidence).toBeNull()
  })

  test('MCI-02 plan returns public-only filters', async () => {
    const plan = {
      query_plan: {
        original_query: 'rice', normalized_text: 'rice', tokens: ['rice'], language_hints: ['unknown'],
        intent: 'SEARCH', price_filter: null, sort_preference: null, category_hints: [], offer_request: null,
        ambiguity: { level: 'LOW', notes: [] },
      },
    }
    const response = await post('/v1/search/plan', plan)
    expect(response.status).toBe(200)
    const envelope = (await response.json()) as { module_id: string; result: { filters: { statuses: string[] }; semantic_path_available: boolean } }
    expect(envelope.module_id).toBe('MCI-02')
    expect(envelope.result.filters.statuses).toEqual(['ACTIVE'])
    expect(envelope.result.semantic_path_available).toBe(false)
  })

  test('MCI-03 rank with two candidates', async () => {
    const body = {
      query_plan: {
        original_query: 'iphone', normalized_text: 'iphone', tokens: ['iphone'], language_hints: ['unknown'],
        intent: 'SEARCH', price_filter: null, sort_preference: null, category_hints: [], offer_request: null,
        ambiguity: { level: 'LOW', notes: [] },
      },
      candidates: [
        { listing_id: 'L1', seller_ref: 'S1', category_id: 'electronics-phones', title: 'iPhone 12', description: null, price: 2400000, currency: 'UGX', county: 'Kampala', area: null, published_at: '2026-11-01T00:00:00Z', refreshed_at: '2026-11-18T00:00:00Z' },
        { listing_id: 'L2', seller_ref: 'S2', category_id: 'home-kitchen', title: 'wooden sofa', description: null, price: 100000, currency: 'UGX', county: 'Gulu', area: null, published_at: '2026-11-01T00:00:00Z', refreshed_at: '2026-11-18T00:00:00Z' },
      ],
      context: { now: '2026-11-20T12:00:00Z' },
    }
    const response = await post('/v1/search/rank', body)
    expect(response.status).toBe(200)
    const envelope = (await response.json()) as { module_id: string; result: { ranked: Array<{ listing_id: string }> } }
    expect(envelope.module_id).toBe('MCI-03')
    expect(envelope.result.ranked[0].listing_id).toBe('L1')
  })

  test('MCI-27 insights rejects sales language at the boundary too', async () => {
    const snapshot = {
      merchant_ref: 'm-1',
      period: { days: 7, from: '2026-11-13' },
      shop_totals: { views: 100, contact_taps: 10, share_clicks: 2 },
      shop_daily: [{ day: '2026-11-19', views: 20, contact_taps: 2, share_clicks: 1 }],
      listings: [{ listing_id: 'L-A', category_id: 'food-staples', status: 'ACTIVE', days_live: 20, views: 60, contact_taps: 6, share_clicks: 1 }],
      previous_period_totals: null,
    }
    const response = await post('/v1/merchant/insights', snapshot)
    expect(response.status).toBe(200)
    const envelope = (await response.json()) as { module_id: string; result: { insights: Array<{ statement: string }> } }
    expect(envelope.module_id).toBe('MCI-27')
    for (const insight of envelope.result.insights) {
      expect(insight.statement.toLowerCase()).not.toMatch(/\b(sales?|sold|orders?)\b/)
    }
  })

  test('invalid payloads return 400 with a stable code', async () => {
    const response = await post('/v1/search/understand', { query: '' })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string; trace_id: string } }
    expect(body.error.code).toBe('PAYLOAD_INVALID')
    expect(body.error.trace_id.startsWith('gw-')).toBe(true)
  })
})

describe('security boundaries', () => {
  test('nonce replay returns 409 AUTH_REPLAY', async () => {
    const ctx = testEnv()
    const fixedNonce = 'nonce-fixed-0001'
    const first = await post('/v1/search/understand', { query: 'rice' }, { nonce: fixedNonce, env: ctx })
    expect(first.status).toBe(200)
    const second = await post('/v1/search/understand', { query: 'rice' }, { nonce: fixedNonce, env: ctx })
    expect(second.status).toBe(409)
    const body = (await second.json()) as { error: { code: string } }
    expect(body.error.code).toBe('AUTH_REPLAY')
  })

  test('scope denial is 403 with the missing scope named', async () => {
    const restricted: CallerConfig = { ...CALLER, scopes: ['search:understand'] }
    const ctx = testEnv()
    ctx.overrides.callers = new Map([[restricted.callerId, restricted]])
    const response = await post('/v1/merchant/insights', { merchant_ref: 'm' }, { caller: restricted, env: ctx })
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('SCOPE_DENIED')
    expect(body.error.message).toContain('merchant:insights')
  })

  test('per-caller rate limit trips to 429 RATE_LIMITED (limit 5/min)', async () => {
    const ctx = testEnv()
    const statuses: number[] = []
    for (let i = 0; i < 7; i++) {
      const response = await post('/v1/search/understand', { query: 'rice' }, { nonce: `nonce-rate-${i}`, env: ctx })
      statuses.push(response.status)
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0)
    expect(statuses[0]).toBe(200)
  })

  test('oversized payloads are rejected before auth', async () => {
    const big = 'x'.repeat(40_000)
    const response = await post('/v1/search/understand', { query: big })
    expect(response.status).toBe(413)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  test('unsigned requests fail with AUTH_MISSING', async () => {
    const { env, overrides } = testEnv()
    const response = await handleRequest(
      new Request('https://gateway.internal/v1/search/understand', { method: 'POST', body: '{"query":"rice"}' }),
      env,
      overrides,
    )
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('AUTH_MISSING')
  })

  test('trace id from the caller is echoed back', async () => {
    const caller: CallerConfig = { ...CALLER, scopes: ['search:understand'] }
    const bodyText = '{"query":"rice"}'
    const { headers } = await signRequest({
      secret: caller.secret,
      callerId: caller.callerId,
      secretId: caller.secretId,
      method: 'POST',
      path: '/v1/search/understand',
      timestamp: String(NOW_SECONDS),
      body: bodyText,
      nonce: 'nonce-trace-1',
    })
    const { env, overrides } = testEnv()
    const response = await handleRequest(
      new Request('https://gateway.internal/v1/search/understand', {
        method: 'POST',
        headers: { ...headers, 'x-mudaala-trace-id': 'commerce-trace-12345678' },
        body: bodyText,
      }),
      env,
      overrides,
    )
    expect(response.headers.get('x-mudaala-trace-id')).toBe('commerce-trace-12345678')
  })
})

describe('job submission (staging store)', () => {
  test('submit, idempotent replay, and submitter-scoped status read', async () => {
    let counter = 0
    const store = new MemoryJobStore(() => `job-${++counter}`, () => '2026-11-20T12:00:00Z')
    const { env, overrides } = testEnv()
    overrides.jobStore = store

    const submission = {
      schema_version: '1.0',
      kind: 'EVAL_BENCHMARK_RUN',
      idempotency_key: 'bench-run-0001',
      payload: { suite: 'fixtures' },
      budget: { max_attempts: 2, deadline_seconds: 600, compute_profile: 'CPU_XS' },
    }
    const first = await post('/v1/jobs', submission, { env: { env, overrides }, nonce: 'nonce-j1' })
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as { result: { job_id: string; idempotent_replay: boolean } }
    expect(firstBody.result.idempotent_replay).toBe(false)

    const replay = await post('/v1/jobs', submission, { env: { env, overrides }, nonce: 'nonce-j2' })
    const replayBody = (await replay.json()) as { result: { job_id: string; idempotent_replay: boolean } }
    expect(replayBody.result.job_id).toBe(firstBody.result.job_id)
    expect(replayBody.result.idempotent_replay).toBe(true)

    expect(store.read(firstBody.result.job_id)?.submitter).toBe('mudaala-commerce')
  })

  test('GPU batch jobs carry the approval warning', async () => {
    const { env, overrides } = testEnv()
    overrides.jobStore = new MemoryJobStore(() => 'job-gpu', () => '2026-11-20T12:00:00Z')
    const response = await post('/v1/jobs', {
      schema_version: '1.0',
      kind: 'EVAL_BENCHMARK_RUN',
      idempotency_key: 'gpu-run-0001',
      payload: {},
      budget: { max_attempts: 1, deadline_seconds: 600, compute_profile: 'GPU_BATCH' },
    }, { env: { env, overrides }, nonce: 'nonce-gpu' })
    const body = (await response.json()) as { result: Record<string, unknown>; warnings: string[] }
    expect(body.warnings.join(' ')).toContain('owner approval')
  })

  test('store-level payload cap rejects oversized payloads (defense in depth)', async () => {
    const store = new MemoryJobStore(() => 'job-big', () => '2026-11-20T12:00:00Z')
    const submission = {
      schema_version: '1.0' as const,
      kind: 'EVENT_BACKFILL' as const,
      idempotency_key: 'big-payload-01',
      payload: { blob: 'x'.repeat(40_000) },
      budget: { max_attempts: 1, deadline_seconds: 60, compute_profile: 'CPU_XS' as const },
      submitter: 'mudaala-commerce',
    }
    // Through HTTP the 32 KiB gateway cap returns 413 first; the store check
    // protects direct callers (e.g. Hermes via the same interface).
    expect(() => store.submit(submission, 'mudaala-commerce')).toThrow('PAYLOAD_TOO_LARGE')
  })
})

describe('nonce replay remediation (atomic consume, caller isolation)', () => {
  const CALLER2: CallerConfig = {
    callerId: 'commerce-2',
    secretId: 'key-2026-11',
    secret: 'test-secret-2-do-not-use',
    scopes: ['search:understand', 'search:rank', 'search:plan', 'search:diversify', 'merchant:insights', 'jobs:submit'],
    rateLimitPerMinute: 5,
    enabled: true,
  }

  test('two simultaneous requests with the same nonce: exactly one succeeds', async () => {
    const ctx = testEnv()
    const [a, b] = await Promise.all([
      post('/v1/search/understand', { query: 'rice' }, { nonce: 'nonce-race-0001', env: ctx }),
      post('/v1/search/understand', { query: 'rice' }, { nonce: 'nonce-race-0001', env: ctx }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const rejected = a.status === 409 ? a : b
    const body = (await rejected.json()) as { error: { code: string } }
    expect(body.error.code).toBe('AUTH_REPLAY')
  })

  test('caller isolation: the same nonce string from two callers never collides', async () => {
    const ctx = testEnv()
    ctx.overrides.callers = new Map([
      [CALLER.callerId, CALLER],
      [CALLER2.callerId, CALLER2],
    ])
    const a = await post('/v1/search/understand', { query: 'rice' }, { nonce: 'nonce-shared-0001', env: ctx })
    const b = await post('/v1/search/understand', { query: 'rice' }, { nonce: 'nonce-shared-0001', env: ctx, caller: CALLER2 })
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
  })

  test('expired nonces are admitted again after the TTL', async () => {
    // Nonce TTL is fixed at 180s in the worker; the cache itself is time-based.
    const nowMs = { value: NOW_SECONDS * 1000 }
    const ctx = testEnv()
    ctx.overrides.nonces = new InMemoryNonceCache(() => nowMs.value)
    const first = await post('/v1/search/understand', { query: 'rice' }, { nonce: 'nonce-exp-0001', env: ctx })
    expect(first.status).toBe(200)
    nowMs.value += 181_000
    const second = await post('/v1/search/understand', { query: 'rice' }, { nonce: 'nonce-exp-0001', env: ctx })
    expect(second.status).toBe(200)
  })
})
