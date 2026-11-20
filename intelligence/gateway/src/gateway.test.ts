/**
 * Gateway pipeline tests — the full request path with in-memory limiter and
 * nonce cache (production uses the Durable Object; the router is runtime-
 * agnostic by design, see limiter.ts).
 */
import { describe, expect, test } from 'bun:test'
import { handleRequest } from './index'
import { buildCanonicalString, hmacSha256Hex, sha256Hex, signRequest } from './auth'
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

  test('MCI-01 → MCI-02 → MCI-03 → MCI-08 composes through authenticated gateway routes', async () => {
    // Fixture-backed integration of the real gateway routes. The fixture
    // catalogue stands in for the commerce-plane Prisma adapter; production
    // database wiring is a separate acceptance gate.
    const understandResponse = await post('/v1/search/understand', { query: 'iphone under 1m' })
    expect(understandResponse.status).toBe(200)
    const understandEnvelope = await understandResponse.json() as { module_id: string; result: Record<string, unknown> }
    expect(understandEnvelope.module_id).toBe('MCI-01')
    const queryPlan = understandEnvelope.result

    const planResponse = await post('/v1/search/plan', {
      query_plan: queryPlan,
      constraints: { counties: ['Kampala'] },
      bounds: { max_candidates: 50 },
    })
    expect(planResponse.status).toBe(200)
    const planEnvelope = await planResponse.json() as { module_id: string; result: { filters: { statuses: string[]; categories: string[]; price: { currency: string; min: number | null; max: number | null } | null; counties: string[]; keywords: string[]; types: string[] }; limits: { candidate_cap: number } } }
    expect(planEnvelope.module_id).toBe('MCI-02')
    const retrieval = planEnvelope.result
    expect(retrieval.filters.statuses).toEqual(['ACTIVE'])
    expect(retrieval.filters.price?.max).toBe(1_000_000)
    expect(retrieval.limits.candidate_cap).toBe(50)

    const fresh = '2026-11-19T12:00:00Z'
    const catalogue = [
      { status: 'ACTIVE', type: 'OFFER', candidate: { listing_id: 'L1', seller_ref: 'seller-a', category_id: 'electronics', title: 'iPhone 12 128GB', description: 'Dual SIM smartphone', price: 950_000, currency: 'UGX', county: 'Kampala', area: 'Ntinda', published_at: fresh, refreshed_at: fresh, availability: 'IN_STOCK', engagement: { views: 100, contact_taps: 8, share_clicks: 4 } } },
      { status: 'ACTIVE', type: 'OFFER', candidate: { listing_id: 'L2', seller_ref: 'seller-a', category_id: 'electronics', title: 'iPhone 11', description: null, price: 750_000, currency: 'UGX', county: 'Kampala', area: 'Kansanga', published_at: fresh, refreshed_at: fresh, availability: 'UNKNOWN' } },
      { status: 'ACTIVE', type: 'OFFER', candidate: { listing_id: 'L3', seller_ref: 'seller-b', category_id: 'electronics', title: 'iPhone 13', description: null, price: 900_000, currency: 'UGX', county: 'Kampala', area: 'Ntinda', published_at: fresh, refreshed_at: fresh, availability: 'IN_STOCK' } },
      { status: 'ACTIVE', type: 'OFFER', candidate: { listing_id: 'L4', seller_ref: 'seller-c', category_id: 'electronics', title: 'iPhone 14 Pro', description: null, price: 1_500_000, currency: 'UGX', county: 'Kampala', area: 'Ntinda', published_at: fresh, refreshed_at: fresh } },
      { status: 'ACTIVE', type: 'OFFER', candidate: { listing_id: 'L5', seller_ref: 'seller-d', category_id: 'electronics', title: 'iPhone 12', description: null, price: 800_000, currency: 'UGX', county: 'Gulu', area: null, published_at: fresh, refreshed_at: fresh } },
      { status: 'ACTIVE', type: 'OFFER', candidate: { listing_id: 'L6', seller_ref: 'seller-e', category_id: 'home-kitchen', title: 'Wooden sofa', description: null, price: 500_000, currency: 'UGX', county: 'Kampala', area: 'Ntinda', published_at: fresh, refreshed_at: fresh } },
    ]
    const retrieved = catalogue.filter((row) => {
      const candidate = row.candidate
      const filters = retrieval.filters
      const priceMatches = !filters.price || (candidate.currency === filters.price.currency && (filters.price.min === null || candidate.price >= filters.price.min) && (filters.price.max === null || candidate.price <= filters.price.max))
      const categoryMatches = filters.categories.length === 0 || filters.categories.includes(candidate.category_id)
      const keywordMatches = filters.keywords.every((keyword) => `${candidate.title} ${candidate.description ?? ''}`.toLowerCase().includes(keyword.toLowerCase()))
      return filters.statuses.includes(row.status) && filters.types.includes(row.type) && filters.counties.includes(candidate.county) && priceMatches && categoryMatches && keywordMatches
    }).map((row) => row.candidate)
    expect(retrieved.map((candidate) => candidate.listing_id)).toEqual(['L1', 'L2', 'L3'])

    const rankResponse = await post('/v1/search/rank', {
      query_plan: queryPlan,
      candidates: retrieved,
      context: { county: 'Kampala', area: 'Ntinda', now: '2026-11-20T12:00:00Z' },
    })
    expect(rankResponse.status).toBe(200)
    const rankEnvelope = await rankResponse.json() as { module_id: string; result: { ranked: Array<{ listing_id: string; score: number }> } }
    expect(rankEnvelope.module_id).toBe('MCI-03')
    expect(rankEnvelope.result.ranked[0].listing_id).toBe('L1')

    const metadata = Object.fromEntries(retrieved.map((candidate) => [candidate.listing_id, {
      seller_ref: candidate.seller_ref,
      category_id: candidate.category_id,
      published_at: candidate.published_at,
    }]))
    const diversifyResponse = await post('/v1/search/diversify', {
      ranked: rankEnvelope.result.ranked,
      metadata,
      settings: { max_per_seller: 1, exploration_slots: 1, rotation_bucket: 0 },
    })
    expect(diversifyResponse.status).toBe(200)
    const diversifyEnvelope = await diversifyResponse.json() as { module_id: string; result: { slate: string[]; fairness_report: { distinct_sellers_top5: number } } }
    expect(diversifyEnvelope.module_id).toBe('MCI-08')
    expect(diversifyEnvelope.result.slate).toHaveLength(retrieved.length)
    expect(new Set(diversifyEnvelope.result.slate)).toEqual(new Set(['L1', 'L2', 'L3']))
    const sellerByListingId = new Map(retrieved.map((candidate) => [candidate.listing_id, candidate.seller_ref]))
    expect(sellerByListingId.get(diversifyEnvelope.result.slate[0])).not.toBe(sellerByListingId.get(diversifyEnvelope.result.slate[1]))
    expect(diversifyEnvelope.result.fairness_report.distinct_sellers_top5).toBe(2)
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

describe('streaming payload limits (remediation: cap enforced while reading)', () => {
  function chunkedRequest(chunks: Uint8Array[], headers: Record<string, string>): Request {
    let index = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++])
        else controller.close()
      },
    })
    return new Request('https://gateway.internal/v1/search/understand', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      // @ts-expect-error bun accepts a ReadableStream body here
      body: stream,
      // @ts-expect-error duplex is required for streaming bodies
      duplex: 'half',
    })
  }

  test('oversized chunked body is rejected without buffering the whole stream', async () => {
    const { env, overrides } = testEnv()
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls < 8) {
          controller.enqueue(new TextEncoder().encode('x'.repeat(8192)))
          pulls++
        } else {
          controller.close()
        }
      },
    })
    const response = await handleRequest(
      new Request('https://gateway.internal/v1/search/understand', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // @ts-expect-error bun accepts a ReadableStream body here
        body: stream,
        // @ts-expect-error duplex is required for streaming bodies
        duplex: 'half',
      }),
      env,
      overrides,
    )
    expect(response.status).toBe(413)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE')
    // The reader must have stopped BEFORE draining all 8 chunks (32 KiB cap
    // is crossed on the 5th 8 KiB chunk); a fully-buffering implementation
    // would have consumed all 8.
    expect(pulls).toBeLessThan(8)
  })

  test('misleading Content-Length (declares small, sends large) is caught by the stream cap', async () => {
    const { env, overrides } = testEnv()
    const chunks = Array.from({ length: 5 }, () => new TextEncoder().encode('y'.repeat(8192)))
    const response = await handleRequest(chunkedRequest(chunks, { 'content-length': '100' }), env, overrides)
    expect(response.status).toBe(413)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  test('UTF-8 bytes are measured, not UTF-16 code units (emoji payload regression)', async () => {
    const { env, overrides } = testEnv()
    // 10 000 emoji = 20 000 UTF-16 units (old check passes at 32 768) but
    // 40 000 UTF-8 bytes (new check rejects).
    const emojiBody = JSON.stringify({ query: '😀'.repeat(10_000) })
    const chunks = [new TextEncoder().encode(emojiBody)]
    const response = await handleRequest(chunkedRequest(chunks, {}), env, overrides)
    expect(response.status).toBe(413)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  test('valid multibyte JSON under the cap still succeeds', async () => {
    const response = await post('/v1/search/understand', { query: 'kitenge 😀 dresses under 50k' })
    expect(response.status).toBe(200)
    const envelope = (await response.json()) as { module_id: string }
    expect(envelope.module_id).toBe('MCI-01')
  })

  test('malformed UTF-8 bytes are rejected with a stable envelope', async () => {
    const { env, overrides } = testEnv()
    const badBytes = new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]) // {"<invalid>"}
    const bodyHash = await sha256Hex(badBytes)
    const canonical = buildCanonicalString({
      callerId: CALLER.callerId,
      secretId: CALLER.secretId,
      method: 'POST',
      path: '/v1/search/understand',
      timestamp: String(NOW_SECONDS),
      bodyHash,
    })
    const signature = await hmacSha256Hex(CALLER.secret, canonical)
    const headers = {
      'x-mudaala-caller': CALLER.callerId,
      'x-mudaala-secret-id': CALLER.secretId,
      'x-mudaala-timestamp': String(NOW_SECONDS),
      'x-mudaala-nonce': 'nonce-badutf8-01',
      'x-mudaala-signature': signature,
    }
    const request = new Request('https://gateway.internal/v1/search/understand', {
      method: 'POST',
      headers,
      // @ts-expect-error raw bytes body
      body: badBytes,
    })
    const response = await handleRequest(request, env, overrides)
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PAYLOAD_INVALID')
  })

  test('a stream that fails mid-flight returns a clean 400, not a crash', async () => {
    const { env, overrides } = testEnv()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"query":"ri'))
        setTimeout(() => controller.error(new Error('connection dropped')), 5)
      },
    })
    const response = await handleRequest(
      new Request('https://gateway.internal/v1/search/understand', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // @ts-expect-error streaming body
        body: stream,
        // @ts-expect-error duplex
        duplex: 'half',
      }),
      env,
      overrides,
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PAYLOAD_INVALID')
  })
})

describe('idempotency correctness (remediation)', () => {
  const submission = {
    schema_version: '1.0' as const,
    kind: 'EVAL_BENCHMARK_RUN' as const,
    idempotency_key: 'idem-correct-0001',
    payload: { suite: 'fixtures', threshold: 0.5 },
    budget: { max_attempts: 2, deadline_seconds: 600, compute_profile: 'CPU_XS' as const },
  }

  test('same key + content-equal payload (different key order) replays the original job', async () => {
    let counter = 0
    const store = new MemoryJobStore(() => `job-idem-${++counter}`, () => '2026-11-20T12:00:00Z')
    const first = store.submit({ ...submission, submitter: 'mudaala-commerce' }, 'mudaala-commerce')
    // Same content, reordered keys — identical by content, NOT a conflict.
    const reordered = store.submit({
      ...submission,
      submitter: 'mudaala-commerce',
      payload: { threshold: 0.5, suite: 'fixtures' },
    }, 'mudaala-commerce')
    expect(reordered.job_id).toBe(first.job_id)
    expect(store.wasReplay(first.job_id)).toBe(true)
  })

  test('same key + different payload conflicts (409 IDEMPOTENCY_CONFLICT)', async () => {
    let counter = 0
    const { env, overrides } = testEnv()
    overrides.jobStore = new MemoryJobStore(() => `job-conf-${++counter}`, () => '2026-11-20T12:00:00Z')
    const first = await post('/v1/jobs', submission, { env: { env, overrides }, nonce: 'nonce-idem-1' })
    expect(first.status).toBe(200)
    const conflict = await post('/v1/jobs', { ...submission, payload: { suite: 'OTHER', threshold: 0.5 } }, { env: { env, overrides }, nonce: 'nonce-idem-2' })
    expect(conflict.status).toBe(409)
    const body = (await conflict.json()) as { error: { code: string } }
    expect(body.error.code).toBe('IDEMPOTENCY_CONFLICT')
  })

  test('concurrent submissions cannot create duplicate jobs', async () => {
    let counter = 0
    const { env, overrides } = testEnv()
    overrides.jobStore = new MemoryJobStore(() => `job-conc-${++counter}`, () => '2026-11-20T12:00:00Z')
    const [a, b] = await Promise.all([
      post('/v1/jobs', submission, { env: { env, overrides }, nonce: 'nonce-idem-3a' }),
      post('/v1/jobs', submission, { env: { env, overrides }, nonce: 'nonce-idem-3b' }),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    const bodyA = (await a.json()) as { result: { job_id: string } }
    const bodyB = (await b.json()) as { result: { job_id: string } }
    expect(bodyB.result.job_id).toBe(bodyA.result.job_id)
  })

  test('retention: swept finished records free the key; reuse creates a new job', async () => {
    let counter = 0
    const clock = { iso: '2026-11-20T12:00:00Z' }
    const store = new MemoryJobStore(() => `job-ret-${++counter}`, () => clock.iso, { retentionMs: 1000 })
    const first = store.submit({ ...submission, submitter: 'mudaala-commerce' }, 'mudaala-commerce')
    store.finish(first.job_id!)
    clock.iso = '2026-11-21T12:00:01Z' // > retentionMs past finish
    const resubmitted = store.submit({ ...submission, submitter: 'mudaala-commerce' }, 'mudaala-commerce')
    expect(resubmitted.job_id).not.toBe(first.job_id)
    expect(store.read(first.job_id)).toBeUndefined()
  })

  test('size bound: oldest finished records are evicted beyond maxEntries', () => {
    let counter = 0
    const store = new MemoryJobStore(() => `job-cap-${++counter}`, () => '2026-11-20T12:00:00Z', { maxEntries: 2 })
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const record = store.submit({
        ...submission,
        submitter: 'mudaala-commerce',
        idempotency_key: `idem-cap-${String(i).padStart(4, '0')}`,
      }, 'mudaala-commerce')
      ids.push(record.job_id)
      store.finish(record.job_id)
    }
    expect(store.read(ids[0])).toBeUndefined()
    expect(store.read(ids[1])).toBeDefined()
    expect(store.read(ids[2])).toBeDefined()
  })
})
