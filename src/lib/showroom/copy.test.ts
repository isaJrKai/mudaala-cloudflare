import { describe, expect, it } from 'bun:test'
import { suggestShowroomCopy } from './copy'
import { sampleProduct, sampleScenarios } from './sample-scenarios'
import { slugCandidate, slugify } from './slug'

describe('suggestShowroomCopy: facts only', () => {
  it('states the count and shop, nothing else, when no brands or prices exist', () => {
    const products = [sampleProduct({ title: 'a', category: 'other', price: null }), sampleProduct({ title: 'b', category: 'other', price: null })]
    const s = suggestShowroomCopy(products, 'Kato Stores', 'COLLECTION')
    expect(s.introduction).toBe('2 products from Kato Stores.')
  })
  it('mentions brands only when present and only the ones that exist', () => {
    const s = suggestShowroomCopy(sampleScenarios().find((x) => x.key === 'electronics')!.products, 'Sample Phones', 'BRAND')
    expect(s.introduction).toContain('Brand: Apple.')
    expect(s.title).toBe('Apple collection')
  })
  it('quotes the real minimum price and never a discount or superlative', () => {
    const products = [sampleProduct({ title: 'a', category: 'other', price: 20000 }), sampleProduct({ title: 'b', category: 'other', price: 35000 })]
    const s = suggestShowroomCopy(products, 'Shop', 'COLLECTION')
    expect(s.introduction).toContain('Prices from')
    expect(s.introduction).toContain('20,000')
    expect(`${s.title} ${s.introduction}`).not.toMatch(/\b(best|sale|discount|off|cheap|premium|luxury|authentic|genuine|warranty|trusted)\b/i)
  })
  it('omits the price sentence when currencies are mixed', () => {
    const products = [sampleProduct({ title: 'a', category: 'other', currency: 'UGX' }), sampleProduct({ title: 'b', category: 'other', currency: 'USD' })]
    expect(suggestShowroomCopy(products, 'Shop', 'COLLECTION').introduction).not.toContain('Prices from')
  })
  it('purpose drives the title; length limits hold', () => {
    const products = [sampleProduct({ title: 'a', category: 'other' })]
    expect(suggestShowroomCopy(products, 'S', 'NEW_ARRIVALS').title).toBe('New arrivals')
    expect(suggestShowroomCopy(products, 'S', 'FEATURED').title).toBe('Featured picks')
    for (const sc of sampleScenarios()) {
      const s = suggestShowroomCopy(sc.products, sc.shopName, sc.purpose, sc.merchantCategory)
      expect(s.title.length).toBeLessThanOrEqual(80)
      expect(s.introduction.length).toBeLessThanOrEqual(600)
    }
  })
})

describe('slug', () => {
  it('slugifies to ascii words', () => {
    expect(slugify('Summer Fashion')).toBe('summer-fashion')
    expect(slugify('  Café & Crème!! ')).toBe('cafe-and-creme')
    expect(slugify('Mukwano\'s "Best" 2026')).toBe('mukwano-s-best-2026')
  })
  it('never returns something shorter than 3 chars or empty', () => {
    expect(slugify('!!')).toBe('showroom')
    expect(slugify('Ab')).toBe('ab-showroom')
    expect(slugify('日本語')).toBe('showroom')
  })
  it('caps length and never ends with a hyphen', () => {
    const s = slugify('word '.repeat(40))
    expect(s.length).toBeLessThanOrEqual(60)
    expect(s.endsWith('-')).toBe(false)
  })
  it('candidate sequence is deterministic, starts at the base, and stays valid', () => {
    expect(slugCandidate('summer-fashion', 0)).toBe('summer-fashion')
    expect(slugCandidate('summer-fashion', 1)).toBe('summer-fashion-2')
    const seen = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const c = slugCandidate('summer-fashion', i)
      expect(c).toBe(slugCandidate('summer-fashion', i))
      expect(c).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(c.length).toBeLessThanOrEqual(80)
      seen.add(c)
    }
    expect(seen.size).toBe(10)
  })
})
