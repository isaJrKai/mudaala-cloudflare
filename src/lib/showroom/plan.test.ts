import { describe, expect, it } from 'bun:test'
import { COMPOSITIONS } from './compositions'
import { orderProducts, planSections } from './plan'
import { buildShowroomView } from './view'
import { sampleProduct, sampleScenarios } from './sample-scenarios'

const many = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    sampleProduct({ id: `p${i}`, title: `Product ${i}`, category: i % 2 ? 'textiles-clothing' : 'electronics', brand: i % 3 === 0 ? 'Acme' : i % 3 === 1 ? 'Zed' : null }),
  )

describe('planSections: every product appears exactly once, for ANY composition and ANY count', () => {
  for (const composition of COMPOSITIONS) {
    it(composition.key, () => {
      for (const n of [1, 2, 3, 4, 5, 8, 13, 30, 60]) {
        const products = many(n)
        const sections = planSections(composition, products)
        const ids = sections.flatMap((s) => s.products.map((p) => p.id))
        expect(ids.length).toBe(n)
        expect(new Set(ids).size).toBe(n)
        expect(sections.every((s) => s.products.length > 0)).toBe(true)
        expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length)
      }
    })
  }
  it('empty input yields no sections', () => {
    for (const c of COMPOSITIONS) expect(planSections(c, [])).toEqual([])
  })
})

describe('grouping', () => {
  const clean = COMPOSITIONS.find((c) => c.key === 'clean-shelf')!
  it('groups by brand, pooling singletons into "More"', () => {
    const products = [
      sampleProduct({ id: 'a1', title: 'A1', category: 'beauty-personal-care', brand: 'Nivea' }),
      sampleProduct({ id: 'a2', title: 'A2', category: 'beauty-personal-care', brand: 'Nivea' }),
      sampleProduct({ id: 'b1', title: 'B1', category: 'beauty-personal-care', brand: 'Garnier' }),
      sampleProduct({ id: 'b2', title: 'B2', category: 'beauty-personal-care', brand: 'Garnier' }),
      sampleProduct({ id: 'c1', title: 'C1', category: 'beauty-personal-care', brand: 'Solo' }),
      sampleProduct({ id: 'n1', title: 'N1', category: 'beauty-personal-care', brand: null }),
    ]
    const sections = planSections(clean, products)
    expect(sections.map((s) => s.heading)).toEqual(['Nivea', 'Garnier', 'More'])
    expect(sections[2].products.map((p) => p.id)).toEqual(['c1', 'n1'])
  })
  it('does not invent headings when there is nothing to group by', () => {
    const products = Array.from({ length: 5 }, (_, i) => sampleProduct({ id: `x${i}`, title: `X${i}`, category: 'other' }))
    const sections = planSections(clean, products)
    expect(sections.length).toBe(1)
    expect(sections[0].heading).toBeUndefined()
  })
})

describe('ordering', () => {
  const a = sampleProduct({ id: 'a', title: 'Alpha', category: 'other', publishedAt: '2026-10-01T00:00:00.000Z' })
  const b = sampleProduct({ id: 'b', title: 'Bravo', category: 'other', publishedAt: '2026-10-20T00:00:00.000Z' })
  const c = sampleProduct({ id: 'c', title: 'Charlie', category: 'other', publishedAt: '2026-10-10T00:00:00.000Z' })
  it('keeps the seller sequence by default', () => expect(orderProducts([a, b, c], [], 'COLLECTION').map((p) => p.id)).toEqual(['a', 'b', 'c']))
  it('puts highlights first, in the seller\'s order, ignoring unknown ids and duplicates', () => {
    expect(orderProducts([a, b, c], ['c', 'zzz', 'c', 'a'], 'COLLECTION').map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })
  it('NEW_ARRIVALS sorts the remainder newest first (verified listing dates)', () => {
    expect(orderProducts([a, b, c], [], 'NEW_ARRIVALS').map((p) => p.id)).toEqual(['b', 'c', 'a'])
    expect(orderProducts([a, b, c], ['a'], 'NEW_ARRIVALS').map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
  it('does not mutate its input', () => {
    const input = [a, b, c]
    orderProducts(input, ['c'], 'NEW_ARRIVALS')
    expect(input.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('buildShowroomView', () => {
  it('is deterministic and lossless for every sample scenario', () => {
    for (const s of sampleScenarios()) {
      const input = { products: s.products, highlights: [], purpose: s.purpose, merchantCategory: s.merchantCategory, seed: s.seed }
      const first = buildShowroomView(input)
      const second = buildShowroomView(input)
      expect(JSON.stringify(first)).toBe(JSON.stringify(second))
      expect(first.sections.flatMap((x) => x.products).length).toBe(s.products.length)
    }
  })
})
