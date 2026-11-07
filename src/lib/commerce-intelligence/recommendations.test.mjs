import { describe, expect, it } from 'bun:test'
import { rankRelatedListings } from './recommendations.ts'

const now = new Date('2026-11-07T12:00:00.000Z')
const base = {
  type: 'OFFER',
  title: 'Leather office chair',
  description: 'Black adjustable leather office chair with wheels',
  category: 'home-kitchen',
  price: 250000,
  currency: 'UGX',
  county: 'Kampala',
  area: 'Ntinda',
  country: 'UG',
  status: 'ACTIVE',
  isSeed: false,
  expiresAt: new Date('2026-12-01T00:00:00.000Z'),
  refreshedAt: new Date('2026-11-06T12:00:00.000Z'),
}
const source = { ...base, id: 'source', userId: 'seller-source' }
function candidate(overrides = {}) {
  return {
    ...base,
    id: 'candidate',
    userId: 'seller-candidate',
    unit: null,
    photos: '[]',
    publishedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('shared commerce recommendation baseline', () => {
  it('returns deterministic, explainable relevant alternatives across channels', () => {
    const result = rankRelatedListings(source, [candidate()], {
      now,
      context: { channel: 'WHATSAPP', surface: 'WHATSAPP_ASSISTANT' },
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.reasonCode).toBe('SIMILAR_STYLE_DETAILS')
    expect(result[0]?.channel).toBe('WHATSAPP')
    expect(result[0]?.surface).toBe('WHATSAPP_ASSISTANT')
    expect(result[0]?.engineVersion).toBe('related-products-v1')
  })

  it('excludes inactive, expired, seeded, request and cross-country listings', () => {
    const result = rankRelatedListings(source, [
      candidate({ id: 'inactive', status: 'HIDDEN' }),
      candidate({ id: 'expired', expiresAt: new Date('2026-11-07T11:59:59.000Z') }),
      candidate({ id: 'seed', isSeed: true }),
      candidate({ id: 'request', type: 'REQUEST' }),
      candidate({ id: 'other-country', country: 'KE' }),
    ], { now })
    expect(result).toEqual([])
  })

  it('does not recommend from an ineligible source listing', () => {
    expect(rankRelatedListings({ ...source, status: 'HIDDEN' }, [candidate()], { now })).toEqual([])
    expect(rankRelatedListings({ ...source, isSeed: true }, [candidate()], { now })).toEqual([])
  })

  it('does not use category alone as proof of relevance', () => {
    const unrelated = candidate({
      title: 'Fresh tomatoes',
      description: 'Locally grown red tomatoes',
      price: 1000000,
    })
    expect(rankRelatedListings(source, [unrelated], { now })).toEqual([])
  })

  it('never compares prices across different currencies', () => {
    const similarPrice = candidate({
      title: 'Dining table',
      description: 'Solid wood dining table',
      currency: 'KES',
      price: 250000,
    })
    expect(rankRelatedListings(source, [similarPrice], { now })).toEqual([])
  })

  it('uses same-currency price similarity only as supporting evidence', () => {
    const similarPrice = candidate({
      title: 'Desk',
      description: 'Simple work surface',
      price: 260000,
    })
    const differentPrice = candidate({
      id: 'different-price',
      title: 'Desk',
      description: 'Simple work surface',
      price: 900000,
    })
    const result = rankRelatedListings(source, [differentPrice, similarPrice], { now })
    expect(result.map((item) => item.candidate.id)).toEqual(['candidate'])
    expect(result[0]?.reasonCode).toBe('SIMILAR_PRICE_CATEGORY')
  })

  it('interleaves relevant products across sellers before repeating a seller', () => {
    const result = rankRelatedListings(source, [
      candidate({ id: 'a1', userId: 'seller-a' }),
      candidate({ id: 'a2', userId: 'seller-a', refreshedAt: new Date('2026-11-05T12:00:00Z') }),
      candidate({ id: 'b1', userId: 'seller-b' }),
    ], { now, limit: 3 })
    expect(result.map((item) => item.candidate.userId)).toEqual(['seller-a', 'seller-b', 'seller-a'])
  })

  it('uses coarse locality as a ranking feature without overriding relevance', () => {
    const local = candidate({ id: 'local', county: 'Kampala', area: 'Ntinda' })
    const remote = candidate({ id: 'remote', county: 'Jinja', area: 'Central' })
    const result = rankRelatedListings(source, [remote, local], { now })
    expect(result[0]?.candidate.id).toBe('local')
  })

  it('caps result count and breaks exact ties deterministically', () => {
    const result = rankRelatedListings(source, [
      candidate({ id: 'z' }),
      candidate({ id: 'a' }),
    ], { now, limit: 1 })
    expect(result).toHaveLength(1)
    expect(result[0]?.candidate.id).toBe('a')
  })

  it('returns no result when the requested limit is zero', () => {
    expect(rankRelatedListings(source, [candidate()], { now, limit: 0 })).toEqual([])
  })
})
