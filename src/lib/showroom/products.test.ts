import { describe, expect, it } from 'bun:test'
import { availabilityLabel, excerpt, isPubliclyListable, productFacts, toShowroomProduct, wasPrice } from './products'
import { sampleProduct } from './sample-scenarios'

const listing = (over: Record<string, unknown> = {}) => ({
  id: 'l1', title: 'Phone', description: 'A phone', category: 'electronics', price: 1000, currency: 'UGX',
  photos: '["/uploads/a.jpg"]', publishedAt: new Date('2026-10-01T00:00:00Z'), ...over,
})

describe('toShowroomProduct (maps an existing Listing; invents nothing)', () => {
  it('keeps the listing id as the link back to /l/{id}', () => expect(toShowroomProduct(listing()).id).toBe('l1'))
  it('accepts stored JSON photos or an array', () => {
    expect(toShowroomProduct(listing()).photos).toEqual(['/uploads/a.jpg'])
    expect(toShowroomProduct(listing({ photos: ['/uploads/b.jpg'] })).photos).toEqual(['/uploads/b.jpg'])
  })
  it('drops seed-fixture photos and survives corrupt JSON', () => {
    expect(toShowroomProduct(listing({ photos: '["/uploads/seed/x.jpg","/uploads/real.jpg"]' })).photos).toEqual(['/uploads/real.jpg'])
    expect(toShowroomProduct(listing({ photos: '{oops' })).photos).toEqual([])
  })
  it('caps photos at 4', () => expect(toShowroomProduct(listing({ photos: ['1', '2', '3', '4', '5', '6'].map((n) => `/u/${n}.jpg`) })).photos.length).toBe(4))
  it('null price stays null ("ask seller"), unknown availability stays UNKNOWN', () => {
    const p = toShowroomProduct(listing({ price: null, availabilityStatus: 'weird' }))
    expect(p.price).toBeNull()
    expect(p.availability).toBe('UNKNOWN')
  })
  it('keeps only scalar attributes', () => {
    const p = toShowroomProduct(listing({ attributes: { size: 'M', nested: { a: 1 }, n: 3, bad: Number.NaN, list: [1] } }))
    expect(p.attributes).toEqual({ size: 'M', n: 3 })
  })
})

describe('productFacts: only stored facts, never invented', () => {
  it('returns nothing for a product with no brand/model/attributes', () => {
    expect(productFacts(sampleProduct({ title: 'Plain', category: 'other' }), 'general', 5)).toEqual([])
  })
  it('does not mine facts from the description text', () => {
    const p = sampleProduct({ title: 'Phone', category: 'electronics', description: 'Brand new Apple iPhone 128GB, 8GB RAM, excellent battery' })
    expect(productFacts(p, 'electronics', 5)).toEqual([])
  })
  it('uses taxonomy labels and readable enum values, electronics order first', () => {
    const p = sampleProduct({ title: 'iPhone', category: 'electronics', taxonomyId: 'electronics-smartphones', brand: 'Apple', model: 'iPhone 13', attributes: { condition: 'LIKE_NEW', storage: '128GB' } })
    expect(productFacts(p, 'electronics', 5).map((f) => `${f.label}:${f.value}`)).toEqual(['Brand:Apple', 'Model:iPhone 13', 'Storage:128GB', 'Condition:Like new'])
  })
  it('omits false booleans rather than implying "No", and oversized values', () => {
    const p = sampleProduct({ title: 'Feature phone', category: 'electronics', taxonomyId: 'electronics-feature-phones', attributes: { dualSim: false, brand: 'x'.repeat(60) } })
    expect(productFacts(p, 'electronics', 5)).toEqual([])
    const q = sampleProduct({ title: 'Feature phone', category: 'electronics', taxonomyId: 'electronics-feature-phones', attributes: { dualSim: true } })
    expect(productFacts(q, 'electronics', 5)).toEqual([{ key: 'dualSim', label: 'Dual SIM', value: 'Yes' }])
  })
  it('respects the max and de-duplicates brand', () => {
    const p = sampleProduct({ title: 'x', category: 'electronics', brand: 'Apple', attributes: { brand: 'Apple', storage: '128GB', ram: '4GB' } })
    expect(productFacts(p, 'electronics', 2).length).toBe(2)
    expect(productFacts(p, 'electronics', 9).filter((f) => f.label === 'Brand').length).toBe(1)
    expect(productFacts(p, 'electronics', 0)).toEqual([])
  })
})

describe('commercial claims', () => {
  it('availability is shown only when the seller reported it', () => {
    expect(availabilityLabel(sampleProduct({ title: 'a', category: 'other', availability: 'UNKNOWN' }))).toBeNull()
    expect(availabilityLabel(sampleProduct({ title: 'a', category: 'other', availability: 'IN_STOCK' }))).toBe('In stock')
    expect(availabilityLabel(sampleProduct({ title: 'a', category: 'other', availability: 'OUT_OF_STOCK' }))).toBe('Out of stock')
  })
  it('a "was" price needs a seller-supplied, genuinely higher compare-at price', () => {
    expect(wasPrice(sampleProduct({ title: 'a', category: 'other', price: 100, compareAtPrice: 150 }))).toBe(150)
    expect(wasPrice(sampleProduct({ title: 'a', category: 'other', price: 100, compareAtPrice: 100 }))).toBeNull()
    expect(wasPrice(sampleProduct({ title: 'a', category: 'other', price: 100, compareAtPrice: 50 }))).toBeNull()
    expect(wasPrice(sampleProduct({ title: 'a', category: 'other', price: null, compareAtPrice: 50 }))).toBeNull()
    expect(wasPrice(sampleProduct({ title: 'a', category: 'other', price: 100 }))).toBeNull()
  })
  it('excerpt trims on a word boundary', () => {
    expect(excerpt('short')).toBe('short')
    expect(excerpt('word '.repeat(60), 20).endsWith('…')).toBe(true)
  })
})

describe('isPubliclyListable mirrors the public collection filter', () => {
  const now = new Date('2026-11-17T00:00:00Z')
  const base = { userId: 'u1', status: 'ACTIVE', type: 'OFFER', isSeed: false, expiresAt: new Date('2026-12-01T00:00:00Z') }
  it('accepts an active, owned, non-seed, unexpired OFFER', () => expect(isPubliclyListable(base, 'u1', now)).toBe(true))
  it.each([
    ['another owner', { userId: 'u2' }], ['expired', { status: 'EXPIRED' }], ['hidden', { status: 'HIDDEN' }], ['a request', { type: 'REQUEST' }],
    ['seed data', { isSeed: true }], ['past its deadline', { expiresAt: new Date('2026-11-01T00:00:00Z') }],
  ])('rejects %s', (_label, over) => expect(isPubliclyListable({ ...base, ...over }, 'u1', now)).toBe(false))
})
