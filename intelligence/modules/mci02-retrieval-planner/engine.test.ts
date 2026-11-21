/**
 * MCI-02 engine tests — bounded plans, leakage guardrails, constraint precedence.
 */
import { describe, expect, test } from 'bun:test'
import { MCI02Result } from '../../contracts/modules/mci02'
import { MCI02_ENGINE_VERSION, planRetrieval } from './engine'
import { understandQuery } from '../mci01-query-understanding/engine'

describe('MCI-02 plan construction', () => {
  test('keyword query produces keyword-first plan with public-only filters', () => {
    const plan = planRetrieval(understandQuery({ query: 'kitenge dresses under 80k' }))
    expect(plan.filters.statuses).toEqual(['ACTIVE'])
    expect(plan.filters.keywords).toContain('kitenge')
    expect(plan.filters.price?.max).toBe(80_000)
    expect(plan.filters.price?.currency).toBe('UGX')
    expect(plan.paths[0].kind).toBe('KEYWORD')
    expect(plan.ordering).toBe('RELEVANCE')
    expect(MCI02Result.safeParse(plan).success).toBe(true)
  })

  test('category hints flow into filters with subcategory-aware selectivity', () => {
    const plan = planRetrieval(understandQuery({ query: 'iphone for sale' }))
    expect(plan.filters.categories).toContain('electronics')
    const categoryPath = plan.paths.find((p) => p.kind === 'CATEGORY')
    expect(categoryPath?.expected_selectivity).toBe('MEDIUM') // top-level id
  })

  test('explicit constraints override query intent', () => {
    const plan = planRetrieval(understandQuery({ query: 'looking for fridge' }), {
      offer_request: 'OFFER',
      counties: ['Kampala'],
      category_id: 'home-appliances',
    })
    expect(plan.filters.types).toEqual(['OFFER'])
    expect(plan.filters.counties).toEqual(['Kampala'])
    expect(plan.filters.categories[0]).toBe('home-appliances')
    expect(plan.paths.some((p) => p.kind === 'AREA')).toBe(true)
  })

  test('buyer phrasing does not narrow listing types (search wants OFFER results)', () => {
    const plan = planRetrieval(understandQuery({ query: 'anyone selling chicken' }))
    expect(plan.filters.types).toEqual(['OFFER', 'REQUEST'])
    const constrained = planRetrieval(understandQuery({ query: 'chicken' }), { offer_request: 'REQUEST' })
    expect(constrained.filters.types).toEqual(['REQUEST'])
  })

  test('sort preference flows through to ordering', () => {
    const plan = planRetrieval(understandQuery({ query: 'cheapest rice 25kg' }))
    expect(plan.ordering).toBe('PRICE_ASC')
    // '25kg' is a pack size, not a price — the filter must stay null.
    expect(plan.filters.price).toBeNull()
  })

  test('empty query degrades to browse plan, still bounded and public-only', () => {
    const plan = planRetrieval(understandQuery({ query: 'the for and' }))
    expect(plan.filters.keywords.length).toBe(0)
    expect(plan.paths.length).toBeGreaterThan(0)
    expect(plan.ordering).toBe('RELEVANCE')
  })
})

describe('MCI-02 guardrails', () => {
  test('candidate cap is bounded by contract max', () => {
    expect(planRetrieval(understandQuery({ query: 'rice' }), undefined, { max_candidates: 4000 }).limits.candidate_cap).toBe(500)
    expect(planRetrieval(understandQuery({ query: 'rice' }), undefined, { max_candidates: 50 }).limits.candidate_cap).toBe(50)
    expect(planRetrieval(understandQuery({ query: 'rice' })).limits.candidate_cap).toBe(200)
  })

  test('exclusion rules always present — leakage guardrail is in-band', () => {
    const plans = [
      planRetrieval(understandQuery({ query: 'phones' })),
      planRetrieval(understandQuery({ query: 'the' })),
      planRetrieval(understandQuery({ query: 'goats above 300k' }), { counties: ['Mbarara'] }),
    ]
    for (const plan of plans) {
      expect(plan.exclusion_rules).toContain('NO_PRIVATE_OR_DRAFT')
      expect(plan.exclusion_rules).toContain('NO_EXPIRED')
      expect(plan.exclusion_rules).toContain('NO_HIDDEN')
      expect(plan.exclusion_rules).toContain('NO_SEED_LISTINGS')
      expect(plan.filters.statuses).toEqual(['ACTIVE'])
    }
  })

  test('v0 honestly reports no semantic path', () => {
    const plan = planRetrieval(understandQuery({ query: 'vintage record player' }))
    expect(plan.semantic_path_available).toBe(false)
  })

  test('deterministic output', () => {
    const a = planRetrieval(understandQuery({ query: 'kitenge dresses' }), { counties: ['Jinja'] })
    const b = planRetrieval(understandQuery({ query: 'kitenge dresses' }), { counties: ['Jinja'] })
    expect(a).toEqual(b)
    expect(MCI02_ENGINE_VERSION).toMatch(/^mci02-retrieval-planner-v/)
  })
})

describe('MCI-02 remediation — runtime validation', () => {
  test('a malformed query_plan is rejected at the engine boundary', () => {
    // planRetrieval now re-validates its input; TS types alone are not trust.
    expect(() => planRetrieval({ tokens: 'not-a-list' } as never)).toThrow()
  })
})
