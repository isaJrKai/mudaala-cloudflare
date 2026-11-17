// Bun executes this test file in CI; Bun's ambient test types are not part of the Next.js TypeScript build.
// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { rankDiscoveryCandidates } from './discovery-ranking'
import { findTaxonomyNode, isValidTaxonomyAttributes, isValidTaxonomyPath, taxonomyAncestors, taxonomyChildren } from './product-taxonomy'

const now = new Date('2026-11-17T12:00:00.000Z')
const candidate = (overrides: Record<string, unknown> = {}) => ({
  id: 'listing-1',
  userId: 'seller-1',
  category: 'electronics',
  title: 'Samsung Galaxy smartphone',
  description: '128GB Android smartphone in good condition',
  county: 'Kampala',
  area: 'Ntinda',
  publishedAt: new Date('2026-11-16T12:00:00.000Z'),
  viewCount: 12,
  callClicks7d: 2,
  whatsappClicks7d: 4,
  shareClicks7d: 1,
  exposureCount7d: 3,
  ...overrides,
})

describe('product taxonomy', () => {
  it('preserves broad legacy category IDs and provides nested types', () => {
    expect(findTaxonomyNode('electronics')?.parentId).toBeNull()
    expect(findTaxonomyNode('electronics-smartphones')?.parentId).toBe('electronics-phones')
    expect(taxonomyAncestors('electronics-smartphones').map((node) => node.id)).toEqual([
      'electronics', 'electronics-phones', 'electronics-smartphones',
    ])
  })

  it('supports parent-child validation and category-specific attributes', () => {
    expect(isValidTaxonomyPath('electronics-phones', 'electronics-smartphones')).toBe(true)
    expect(isValidTaxonomyPath('electronics', 'electronics-smartphones')).toBe(false)
    expect(findTaxonomyNode('electronics-smartphones')?.attributes?.map((item) => item.key)).toContain('storage')
    expect(taxonomyChildren('textiles-clothing').map((node) => node.id)).toContain('fashion-clothing')
    expect(taxonomyChildren('fashion-clothing').map((node) => node.id)).toEqual(expect.arrayContaining(['fashion-hoodies', 'fashion-dresses', 'fashion-shirts']))
    expect(isValidTaxonomyAttributes('electronics-smartphones', { brand: 'Samsung', model: 'Galaxy S24', storage: '128GB' })).toBe(true)
    expect(isValidTaxonomyAttributes('electronics-smartphones', { storage: '2TB' })).toBe(false)
    expect(isValidTaxonomyAttributes('electronics-smartphones', { unknownField: 'value' })).toBe(false)
  })
})

describe('discovery ranking', () => {
  it('prioritises matching category and coarse locality while returning explanations', () => {
    const result = rankDiscoveryCandidates([
      candidate({ id: 'far', county: 'Jinja', area: 'Central' }),
      candidate({ id: 'near', county: 'Kampala', area: 'Ntinda' }),
    ], { now, category: 'electronics', county: 'Kampala', area: 'Ntinda' })
    expect(result[0]?.candidate.id).toBe('near')
    expect(result[0]?.reasons).toContain('Available near you')
  })

  it('uses recent daily views instead of lifetime views when available', () => {
    const result = rankDiscoveryCandidates([
      candidate({ id: 'old-views', viewCount: 50000, views7d: 0, callClicks7d: 0, whatsappClicks7d: 0, shareClicks7d: 0 }),
      candidate({ id: 'recent-views', viewCount: 10, views7d: 500, callClicks7d: 0, whatsappClicks7d: 0, shareClicks7d: 0 }),
    ], { now })
    expect(result[0]?.candidate.id).toBe('recent-views')
  })

  it('weights real buyer contacts above passive views', () => {
    const result = rankDiscoveryCandidates([
      candidate({ id: 'views', viewCount: 10000, callClicks7d: 0, whatsappClicks7d: 0, shareClicks7d: 0 }),
      candidate({ id: 'contacts', viewCount: 10, callClicks7d: 8, whatsappClicks7d: 9, shareClicks7d: 0 }),
    ], { now })
    expect(result[0]?.candidate.id).toBe('contacts')
  })

  it('gives underexposed and new shops a bounded boost', () => {
    const result = rankDiscoveryCandidates([
      candidate({ id: 'established', userId: 'seller-old', exposureCount7d: 500 }),
      candidate({ id: 'new', userId: 'seller-new', exposureCount7d: 0, isNewShop: true }),
    ], { now })
    expect(result[0]?.candidate.id).toBe('new')
  })

  it('excludes caller-specified IDs, applies query relevance and caps results', () => {
    const result = rankDiscoveryCandidates([
      candidate({ id: 'match' }),
      candidate({ id: 'unrelated', title: 'Fresh tomatoes', description: 'Red tomatoes' }),
      candidate({ id: 'excluded' }),
    ], { now, query: 'Samsung smartphone', excludeListingIds: ['excluded'], limit: 1 })
    expect(result).toHaveLength(1)
    expect(result[0]?.candidate.id).toBe('match')
  })

  it('keeps paginated result sets intact beyond the first 100 candidates', () => {
    const candidates = Array.from({ length: 125 }, (_, index) => candidate({ id: `listing-${index}` }))
    const result = rankDiscoveryCandidates(candidates, { now, limit: candidates.length })
    expect(result).toHaveLength(125)
    expect(result.slice(100, 105)).toHaveLength(5)
  })

  it('interleaves sellers when scores are comparable', () => {
    const result = rankDiscoveryCandidates([
      candidate({ id: 'a1', userId: 'seller-a' }),
      candidate({ id: 'a2', userId: 'seller-a' }),
      candidate({ id: 'b1', userId: 'seller-b' }),
    ], { now, limit: 3 })
    expect(result.slice(0, 2).map((item) => item.candidate.userId)).toEqual(['seller-a', 'seller-b'])
  })
})
