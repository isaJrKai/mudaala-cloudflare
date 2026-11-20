/**
 * MCI-03 engine tests — scoring behaviour, honesty, determinism.
 */
import { describe, expect, test } from 'bun:test'
import { MCI01Result } from '../../contracts/modules/mci01'
import { RankCandidate } from '../../contracts/modules/mci03'
import { MCI03_WEIGHTS, MCI03_WEIGHTS_REF, rankCandidates } from './engine'
import { understandQuery } from '../mci01-query-understanding/engine'

const NOW = '2026-11-20T12:00:00Z'
const FRESH = '2026-11-19T12:00:00Z'
const OLD = '2026-09-01T12:00:00Z'

function candidate(overrides: Partial<RankCandidate> & { listing_id: string }): RankCandidate {
  return {
    seller_ref: 'seller-x',
    category_id: 'electronics',
    title: 'generic listing',
    description: null,
    price: 100_000,
    currency: 'UGX',
    county: 'Kampala',
    area: null,
    published_at: FRESH,
    refreshed_at: FRESH,
    ...overrides,
  }
}

function plan(query: string): MCI01Result {
  return understandQuery({ query })
}

describe('MCI-03 text relevance', () => {
  test('query term coverage dominates and respects the relevance floor', () => {
    const result = rankCandidates(plan('iphone'), [
      candidate({ listing_id: 'exact', title: 'Apple iPhone 12 128GB', refreshed_at: OLD }),
      candidate({ listing_id: 'weak', title: 'phone case bundle', refreshed_at: OLD }),
      candidate({ listing_id: 'none', title: 'wooden sofa', category_id: 'home-kitchen', refreshed_at: OLD }),
    ])
    const scores = new Map(result.ranked.map((r) => [r.listing_id, r.score]))
    expect(scores.get('exact')! > scores.get('weak')!).toBe(true)
    const none = result.ranked.find((r) => r.listing_id === 'none')!
    expect(none.contributions.text_relevance).toBe(0)
  })

  test('any-token match never scores below the relevance floor', () => {
    const result = rankCandidates(plan('samsung tv'), [
      candidate({ listing_id: 'one-hit', title: 'samsung charger only', refreshed_at: OLD }),
    ])
    expect(result.ranked[0].score).toBeGreaterThanOrEqual(MCI03_WEIGHTS.RELEVANCE_FLOOR)
    expect(result.ranked[0].reasons.join(' ')).toContain('matches query terms')
  })

  test('description coverage contributes within its budget', () => {
    const result = rankCandidates(plan('dual sim'), [
      candidate({ listing_id: 'desc', title: 'feature phone', description: 'dual sim radio fm', refreshed_at: OLD }),
    ])
    expect(result.ranked[0].contributions.text_relevance).toBeGreaterThan(0)
    expect(result.ranked[0].contributions.text_relevance).toBeLessThanOrEqual(MCI03_WEIGHTS.TEXT_MAX)
  })
})

describe('MCI-03 freshness, engagement, locality, availability', () => {
  test('freshly refreshed listings outrank stale ones, all else equal', () => {
    const result = rankCandidates(plan('rice'), [
      candidate({ listing_id: 'stale', title: 'rice 25kg', category_id: 'food-staples', refreshed_at: OLD }),
      candidate({ listing_id: 'fresh', title: 'rice 25kg', category_id: 'food-staples', refreshed_at: FRESH }),
    ])
    expect(result.ranked[0].listing_id).toBe('fresh')
    expect(result.ranked[0].contributions.freshness > result.ranked[1].contributions.freshness).toBe(true)
  })

  test('engagement uses aggregate counts and saturates', () => {
    const result = rankCandidates(plan('sofa'), [
      candidate({ listing_id: 'quiet', title: 'sofa set', engagement: { views: 2, contact_taps: 0, share_clicks: 0 } }),
      candidate({ listing_id: 'busy', title: 'sofa set', engagement: { views: 900, contact_taps: 40, share_clicks: 12 } }),
    ])
    expect(result.ranked[0].listing_id).toBe('busy')
    expect(result.ranked[0].contributions.engagement).toBeLessThanOrEqual(MCI03_WEIGHTS.ENGAGEMENT_MAX)
  })

  test('locality boosts only on caller-authorised coarse context', () => {
    const result = rankCandidates(plan('blender'), [
      candidate({ listing_id: 'local', title: 'blender', county: 'Kampala', area: 'Ntinda' }),
      candidate({ listing_id: 'far', title: 'blender', county: 'Gulu', area: null }),
    ], { county: 'Kampala', area: 'Ntinda', now: NOW })
    expect(result.ranked[0].listing_id).toBe('local')
    expect(result.ranked[0].contributions.locality).toBe(MCI03_WEIGHTS.LOCALITY_COUNTY + MCI03_WEIGHTS.LOCALITY_AREA)
  })

  test('out-of-stock is penalised; unknown stock stays neutral (never treated as available)', () => {
    const result = rankCandidates(plan('fridge'), [
      candidate({ listing_id: 'unknown', title: 'fridge', availability: 'UNKNOWN', refreshed_at: FRESH }),
      candidate({ listing_id: 'out', title: 'fridge', availability: 'OUT_OF_STOCK', refreshed_at: FRESH }),
      candidate({ listing_id: 'instock', title: 'fridge', availability: 'IN_STOCK', refreshed_at: FRESH }),
    ])
    const scores = new Map(result.ranked.map((r) => [r.listing_id, r.score]))
    expect(scores.get('instock')! > scores.get('unknown')!).toBe(true)
    expect(scores.get('unknown')! > scores.get('out')!).toBe(true)
  })

  test('new-shop opportunity boost applies to the coarse NEW band only', () => {
    const result = rankCandidates(plan('perfume'), [
      candidate({ listing_id: 'new-shop', title: 'perfume', shop_size_band: 'NEW', refreshed_at: OLD }),
      candidate({ listing_id: 'established', title: 'perfume', shop_size_band: 'LARGE', refreshed_at: OLD }),
    ])
    const newShop = result.ranked.find((r) => r.listing_id === 'new-shop')!
    expect(newShop.contributions.new_shop).toBe(MCI03_WEIGHTS.NEW_SHOP_BOOST)
  })
})

describe('MCI-03 contract and determinism', () => {
  test('output validates against the MCI-03 contract', () => {
    const result = rankCandidates(plan('kitenge dresses'), [
      candidate({ listing_id: 'k1', title: 'kitenge dress', category_id: 'fashion-dresses' }),
    ])
    expect(result.engine_version).toMatch(/^mci03-ranker-v/)
    expect(result.weights_ref).toBe(MCI03_WEIGHTS_REF)
    expect(result.ranked.length).toBe(1)
  })

  test('tie-break is deterministic (score desc, then listing_id asc)', () => {
    const input = [
      candidate({ listing_id: 'b', title: 'rice' }),
      candidate({ listing_id: 'a', title: 'rice' }),
    ]
    const r1 = rankCandidates(plan('rice'), input, { now: NOW })
    const r2 = rankCandidates(plan('rice'), input, { now: NOW })
    expect(r1).toEqual(r2)
    expect(r1.ranked.map((r) => r.listing_id)).toEqual(['a', 'b'])
  })
})
