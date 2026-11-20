import { afterEach, describe, expect, test } from 'bun:test'
import { prepareMciDiscovery, rankAndDiversifyMciDiscovery } from './discovery-pipeline'

const originalEnv = {
  url: process.env.INTELLIGENCE_GATEWAY_URL,
  caller: process.env.INTELLIGENCE_GATEWAY_CALLER_ID,
  secretId: process.env.INTELLIGENCE_GATEWAY_SECRET_ID,
  secret: process.env.INTELLIGENCE_GATEWAY_SECRET,
}

afterEach(() => {
  for (const [key, value] of [
    ['INTELLIGENCE_GATEWAY_URL', originalEnv.url],
    ['INTELLIGENCE_GATEWAY_CALLER_ID', originalEnv.caller],
    ['INTELLIGENCE_GATEWAY_SECRET_ID', originalEnv.secretId],
    ['INTELLIGENCE_GATEWAY_SECRET', originalEnv.secret],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function configureGateway() {
  process.env.INTELLIGENCE_GATEWAY_URL = 'https://intelligence.test'
  process.env.INTELLIGENCE_GATEWAY_CALLER_ID = 'commerce-test'
  process.env.INTELLIGENCE_GATEWAY_SECRET_ID = 'test-key'
  process.env.INTELLIGENCE_GATEWAY_SECRET = 'test-secret-with-sufficient-entropy'
}

const queryPlan = {
  original_query: 'black sneakers under 100k',
  normalized_text: 'black sneakers under 100k',
  tokens: ['black', 'sneakers'],
  language_hints: ['en'],
  intent: 'SEARCH',
  price_filter: { currency: 'UGX', min: null, max: 100000, raw_expression: 'under 100k' },
  sort_preference: 'RELEVANCE',
  category_hints: [{ category_id: 'textiles-clothing', source: 'CONCEPT', score: 0.9 }],
  offer_request: 'OFFER',
  ambiguity: { level: 'LOW', notes: [] },
}

const retrievalPlan = {
  filters: {
    statuses: ['ACTIVE'],
    types: ['OFFER'],
    categories: ['textiles-clothing'],
    price: { currency: 'UGX', min: null, max: 100000 },
    counties: [],
    keywords: ['black', 'sneakers'],
  },
  paths: [{ kind: 'KEYWORD', uses: ['keywords'], expected_selectivity: 'MEDIUM' }],
  ordering: 'RELEVANCE',
  limits: { candidate_cap: 40 },
  exclusion_rules: ['NO_PRIVATE_OR_DRAFT', 'NO_EXPIRED', 'NO_HIDDEN', 'NO_SEED_LISTINGS'],
  semantic_path_available: false,
}

const candidate = {
  listing_id: 'listing-1',
  seller_ref: 'seller-1',
  category_id: 'fashion-shoes',
  title: 'Black sneakers',
  description: 'New black sneakers',
  price: 80000,
  currency: 'UGX',
  county: 'Kampala',
  area: 'Ntinda',
  published_at: '2026-11-18T10:00:00.000Z',
  refreshed_at: '2026-11-19T10:00:00.000Z',
  engagement: { views: 12, contact_taps: 3, share_clicks: 1 },
}

function gatewayFetch(calls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname
    calls.push(path)
    const payloadByPath: Record<string, { module_id: string; result: unknown }> = {
      '/v1/search/understand': { module_id: 'MCI-01', result: queryPlan },
      '/v1/search/plan': { module_id: 'MCI-02', result: retrievalPlan },
      '/v1/search/rank': {
        module_id: 'MCI-03',
        result: { ranked: [{ listing_id: 'listing-1', score: 42, reasons: ['title match'], contributions: { text: 32 } }], engine_version: 'test-ranker', weights_ref: 'test-weights' },
      },
      '/v1/search/diversify': {
        module_id: 'MCI-08',
        result: { slate: ['listing-1'], demoted: [], fairness_report: { distinct_sellers_top5: 1, top_seller_share: 1, applied_caps: [], new_shop_slots_used: 0 } },
      },
    }
    return new Response(JSON.stringify(payloadByPath[path] ?? {}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

describe('MCI discovery commerce adapter', () => {
  test('runs query understanding and retrieval planning through authenticated gateway calls', async () => {
    configureGateway()
    const calls: string[] = []
    const plan = await prepareMciDiscovery(
      'black sneakers under 100k',
      { category_id: null, counties: ['Kampala'], offer_request: 'OFFER' },
      new Date('2026-11-20T10:00:00.000Z'),
      gatewayFetch(calls),
    )
    expect(plan?.queryPlan.original_query).toBe('black sneakers under 100k')
    expect(plan?.retrievalPlan.filters.statuses).toEqual(['ACTIVE'])
    expect(plan?.candidateCap).toBe(40)
    expect(calls).toEqual(['/v1/search/understand', '/v1/search/plan'])
  })

  test('runs relevance ranking and diversity against real candidate ids', async () => {
    configureGateway()
    const calls: string[] = []
    const slate = await rankAndDiversifyMciDiscovery({
      queryPlan: queryPlan as never,
      candidates: [candidate],
      metadata: { 'listing-1': { seller_ref: 'seller-1', category_id: 'fashion-shoes', published_at: candidate.published_at } },
      context: { county: 'Kampala', area: null, now: '2026-11-20T10:00:00.000Z' },
      rotationBucket: 2,
    }, gatewayFetch(calls))
    expect(slate).toEqual(['listing-1'])
    expect(calls).toEqual(['/v1/search/rank', '/v1/search/diversify'])
  })

  test('rejects a retrieval plan that relaxes the ACTIVE-only visibility invariant', async () => {
    configureGateway()
    const calls: string[] = []
    const unsafeFetch = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      calls.push(path)
      const unsafePlan = { ...retrievalPlan, filters: { ...retrievalPlan.filters, statuses: ['ACTIVE', 'HIDDEN'] } }
      const body = path === '/v1/search/understand'
        ? { module_id: 'MCI-01', result: queryPlan }
        : { module_id: 'MCI-02', result: unsafePlan }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const plan = await prepareMciDiscovery('black sneakers', {}, new Date(), unsafeFetch)
    expect(plan).toBeNull()
  })

  test('fails open before sending a candidate payload above the gateway byte budget', async () => {
    configureGateway()
    const calls: string[] = []
    const manyCandidates = Array.from({ length: 40 }, (_, index) => ({
      ...candidate,
      listing_id: `listing-${index}`,
      description: 'x'.repeat(2000),
    }))
    const metadata = Object.fromEntries(manyCandidates.map((item) => [item.listing_id, {
      seller_ref: item.seller_ref,
      category_id: item.category_id,
      published_at: item.published_at,
    }]))
    const slate = await rankAndDiversifyMciDiscovery({
      queryPlan: queryPlan as never,
      candidates: manyCandidates,
      metadata,
      context: { now: new Date().toISOString() },
      rotationBucket: 0,
    }, gatewayFetch(calls))
    expect(slate).toBeNull()
    expect(calls).toEqual([])
  })

  test('rejects a diversity result that invents or drops candidate ids', async () => {
    configureGateway()
    const calls: string[] = []
    const badFetch = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      calls.push(path)
      const body = path === '/v1/search/rank'
        ? { module_id: 'MCI-03', result: { ranked: [{ listing_id: 'listing-1', score: 42, reasons: [], contributions: {} }], engine_version: 'test', weights_ref: 'test' } }
        : { module_id: 'MCI-08', result: { slate: ['not-a-candidate'], demoted: [], fairness_report: { distinct_sellers_top5: 1, top_seller_share: 1, applied_caps: [], new_shop_slots_used: 0 } } }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const slate = await rankAndDiversifyMciDiscovery({
      queryPlan: queryPlan as never,
      candidates: [candidate],
      metadata: { 'listing-1': { seller_ref: 'seller-1', category_id: 'fashion-shoes', published_at: candidate.published_at } },
      context: { now: new Date().toISOString() },
      rotationBucket: 0,
    }, badFetch)
    expect(slate).toBeNull()
  })
})
