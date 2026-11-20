/**
 * Contract tests for the intelligence foundation (commit B scope).
 *
 * These are the tests that make the contracts load-bearing: registry
 * completeness and honesty, envelope invariants, job state machine, event
 * allowlist, and the module honesty rules.
 */
import { describe, expect, test } from 'bun:test'
import {
  GATEWAY_ERROR_CODES,
  GatewayErrorBody,
  JOB_BUDGET_CAPS,
  JOB_STATUSES,
  ResponseEnvelope,
  assertTransition,
  canTransition,
  makeEnvelope,
  requiresGpuApproval,
  retryDelaySeconds,
  validateEvent,
  DECLARED_PURPOSES,
  REGISTRY,
  registryEntry,
  IMPLEMENTED_MODULE_IDS,
  MCI01Request,
  MCI01Result,
  MCI02Result,
  MCI03Result,
  MCI08Result,
  MCI27Result,
  MerchantAnalyticsSnapshot,
  assertNoUnsubstantiatedClaims,
  JobSubmission,
} from './index'

const TRACE = 'trace-0123456789abcdef'

describe('registry', () => {
  test('contains exactly 40 unique MCI modules', () => {
    expect(REGISTRY.modules.length).toBe(40)
    const ids = new Set(REGISTRY.modules.map((m) => m.module_id))
    expect(ids.size).toBe(40)
    for (let i = 1; i <= 40; i++) {
      const id = `MCI-${String(i).padStart(2, '0')}`
      expect(ids.has(id)).toBe(true)
    }
  })

  test('statuses use only the master plan §15 vocabulary', () => {
    const allowed = new Set(['PROPOSED', 'RESEARCHED', 'IN_DEVELOPMENT', 'SHADOW', 'CANARY', 'PRODUCTION', 'PAUSED', 'REJECTED'])
    for (const m of REGISTRY.modules) expect(allowed.has(m.status)).toBe(true)
  })

  test('no module claims PRODUCTION or SHADOW without evidence links', () => {
    for (const m of REGISTRY.modules) {
      if (m.status === 'PRODUCTION' || m.status === 'SHADOW' || m.status === 'CANARY') {
        expect(m.evidence_links.length, `${m.module_id} claims ${m.status} without evidence`).toBeGreaterThan(0)
      }
    }
  })

  test('high-impact modules require a human gate', () => {
    for (const id of ['MCI-09', 'MCI-10', 'MCI-13', 'MCI-14', 'MCI-16', 'MCI-23', 'MCI-30', 'MCI-33', 'MCI-40']) {
      expect(registryEntry(id)?.human_gate, id).toBe(true)
    }
  })

  test('consent-gated modules are marked', () => {
    for (const id of ['MCI-04', 'MCI-17', 'MCI-18', 'MCI-22', 'MCI-37']) {
      expect(registryEntry(id)?.requires_consent, id).toBe(true)
    }
  })

  test('gateway routes are registered exactly for implemented modules', () => {
    const routed = REGISTRY.modules.filter((m) => m.gateway_route !== null).map((m) => m.module_id)
    expect(new Set(routed)).toEqual(new Set(IMPLEMENTED_MODULE_IDS))
  })

  test('deferred modules carry a reason note', () => {
    for (const m of REGISTRY.modules.filter((x) => x.decision === 'DEFER')) {
      expect(m.notes.length, `${m.module_id} DEFER without reason`).toBeGreaterThan(10)
    }
  })
})

describe('response envelope', () => {
  test('builds a valid envelope with defaults', () => {
    const envelope = makeEnvelope({
      moduleId: 'MCI-01',
      contractVersion: '1.0',
      engineVersion: 'mci01-v0',
      traceId: TRACE,
      result: { ok: true },
    })
    expect(envelope.confidence).toBeNull()
    expect(envelope.reason_codes).toEqual([])
    expect(ResponseEnvelope.safeParse(envelope).success).toBe(true)
  })

  test('rejects unknown module ids', () => {
    expect(() =>
      makeEnvelope({ moduleId: 'MCI-99' as never, contractVersion: '1.0', engineVersion: 'x', traceId: TRACE, result: {} }),
    ).toThrow()
  })

  test('rejects short trace ids (trace propagation is contract, not convention)', () => {
    expect(() =>
      makeEnvelope({ moduleId: 'MCI-01', contractVersion: '1.0', engineVersion: 'x', traceId: 'short', result: {} }),
    ).toThrow()
  })

  test('gateway error bodies validate against the stable code list', () => {
    const body = { error: { code: 'RATE_LIMITED', message: 'slow down', trace_id: TRACE, retryable: true } }
    expect(GatewayErrorBody.safeParse(body).success).toBe(true)
    expect(GATEWAY_ERROR_CODES).toContain('AUTH_REPLAY')
  })
})

describe('job state machine', () => {
  test('legal transitions pass, illegal ones throw', () => {
    expect(canTransition('QUEUED', 'RUNNING')).toBe(true)
    expect(canTransition('RUNNING', 'SUCCEEDED')).toBe(true)
    expect(canTransition('FAILED', 'QUEUED')).toBe(true)
    expect(canTransition('SUCCEEDED', 'RUNNING')).toBe(false)
    expect(canTransition('DEAD', 'QUEUED')).toBe(false)
    expect(() => assertTransition('SUCCEEDED', 'RUNNING')).toThrow()
  })

  test('budget caps are enforced at parse time', () => {
    const base = { schema_version: '1.0' as const, kind: 'EVAL_BENCHMARK_RUN' as const, idempotency_key: 'abc12345', payload: {} }
    expect(() => JobSubmission.parse({ ...base, budget: { max_attempts: 99, deadline_seconds: 60, compute_profile: 'CPU_XS' } })).toThrow()
    const ok = JobSubmission.parse({ ...base, budget: { max_attempts: 3, deadline_seconds: 600, compute_profile: 'CPU_S' } })
    expect(ok.budget.max_attempts).toBeLessThanOrEqual(JOB_BUDGET_CAPS.maxAttempts)
  })

  test('GPU jobs are flagged for approval', () => {
    const gpu = requiresGpuApproval({ max_attempts: 1, deadline_seconds: 60, compute_profile: 'GPU_BATCH' })
    expect(gpu).toBe(true)
  })

  test('retry backoff is bounded', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const delay = retryDelaySeconds(attempt)
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThanOrEqual(60 * 1.25 + 1)
    }
  })

  test('all statuses appear in the transition table', () => {
    expect(JOB_STATUSES.length).toBe(6)
  })
})

describe('event taxonomy', () => {
  const baseEvent = {
    schema_version: '1.0',
    event_id: 'evt-0001aaaa',
    event_type: 'CONTACT_TAP',
    occurred_at: '2026-11-20T08:00:00.000Z',
    actor: { kind: 'BUYER', ref: 'pseudonymous-abc' },
    entity: { kind: 'LISTING', id: 'listing-1' },
    contact_channel: 'WHATSAPP',
    purpose: 'DISCOVERY_IMPROVEMENT',
    idempotency_key: 'idem-0001aaaa',
    coarse_location: null,
  }

  test('accepts a valid event and a declared purpose', () => {
    const parsed = validateEvent(baseEvent)
    expect(parsed.event_type).toBe('CONTACT_TAP')
    expect(DECLARED_PURPOSES).toContain(parsed.purpose)
  })

  test('CONTACT_TAP requires a contact channel; others forbid it', () => {
    expect(() => validateEvent({ ...baseEvent, contact_channel: null })).toThrow()
    expect(() => validateEvent({ ...baseEvent, event_type: 'LISTING_VIEWED' })).toThrow()
  })

  test('undeclared purposes are rejected', () => {
    expect(() => validateEvent({ ...baseEvent, purpose: 'GROW_THE_BUSINESS_ANYWAY' })).toThrow()
  })
})

describe('module contracts', () => {
  test('MCI-01 request bounds and result honesty fields', () => {
    expect(MCI01Request.safeParse({ query: '' }).success).toBe(false)
    expect(MCI01Request.safeParse({ query: 'kitenge dresses' }).success).toBe(true)
    const result: MCI01Result = {
      original_query: 'kitenge dresses',
      normalized_text: 'kitenge dresses',
      tokens: ['kitenge', 'dresses'],
      language_hints: ['en'],
      intent: 'SEARCH',
      price_filter: null,
      sort_preference: null,
      category_hints: [],
      offer_request: null,
      ambiguity: { level: 'LOW', notes: [] },
    }
    expect(MCI01Result.safeParse(result).success).toBe(true)
  })

  test('MCI-02 result always carries exclusion rules and no semantic path', () => {
    const result: MCI02Result = {
      filters: {
        statuses: ['ACTIVE'],
        types: ['OFFER'],
        categories: [],
        price: null,
        counties: [],
        keywords: ['kitenge'],
      },
      paths: [{ kind: 'KEYWORD', uses: ['keywords'], expected_selectivity: 'MEDIUM' }],
      ordering: 'RELEVANCE',
      limits: { candidate_cap: 200 },
      exclusion_rules: ['NO_PRIVATE_OR_DRAFT', 'NO_EXPIRED', 'NO_HIDDEN', 'NO_SEED_LISTINGS'],
      semantic_path_available: false,
    }
    expect(MCI02Result.safeParse(result).success).toBe(true)
    expect(result.exclusion_rules).toContain('NO_PRIVATE_OR_DRAFT')
  })

  test('MCI-03 contributions are a record of numbers (future feature vector)', () => {
    const result: MCI03Result = {
      ranked: [
        {
          listing_id: 'l1',
          score: 42.5,
          reasons: ['title match: kitenge'],
          contributions: { text_relevance: 22.5, freshness: 12, engagement: 5, locality: 3 },
        },
      ],
      engine_version: 'mci03-ranker-v0-deterministic',
      weights_ref: 'mci03.weights.v0',
    }
    expect(MCI03Result.safeParse(result).success).toBe(true)
  })

  test('MCI-08 fairness report is present in every result', () => {
    const result: MCI08Result = {
      slate: ['a', 'b'],
      demoted: [],
      fairness_report: { distinct_sellers_top5: 2, top_seller_share: 0.5, applied_caps: [], new_shop_slots_used: 0 },
    }
    expect(MCI08Result.safeParse(result).success).toBe(true)
  })

  test('MCI-27 snapshots validate and honesty rule blocks sales language', () => {
    const snapshot: MerchantAnalyticsSnapshot = {
      merchant_ref: 'merchant-pseudo-1',
      period: { days: 7, from: '2026-11-13' },
      shop_totals: { views: 100, contact_taps: 12, share_clicks: 3 },
      shop_daily: [{ day: '2026-11-19', views: 20, contact_taps: 2, share_clicks: 1 }],
      listings: [
        {
          listing_id: 'l1',
          category_id: 'electronics-phones',
          status: 'ACTIVE',
          days_live: 10,
          views: 50,
          contact_taps: 6,
          share_clicks: 1,
        },
      ],
      previous_period_totals: null,
    }
    expect(MerchantAnalyticsSnapshot.safeParse(snapshot).success).toBe(true)
    expect(() => assertNoUnsubstantiatedClaims(['Your shop made 12 sales this week'])).toThrow()
    expect(() =>
      assertNoUnsubstantiatedClaims(['Contact taps rose from 5 to 12 compared with the previous period']),
    ).not.toThrow()
    const result: MCI27Result = {
      insights: [
        {
          id: 'CTR_HEALTHY',
          severity: 'INFO',
          metric: 'ENGAGEMENT_RATE',
          statement: 'Contact taps were 12 from 100 views (12%).',
          evidence: [{ ref: 'shop_totals', label: 'tap rate', value: 0.12 }],
          suggested_action: null,
          confidence: null,
        },
      ],
      metric_definitions_ref: 'listing-analytics.daily-events.v1',
      coverage_warnings: [],
    }
    expect(MCI27Result.safeParse(result).success).toBe(true)
  })
})
