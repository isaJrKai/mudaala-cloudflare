import { describe, expect, it } from 'bun:test'
import { COMPOSITIONS, COMPOSITION_KEYS } from './compositions'
import { computeSignals, isEligible, selectComposition } from './select'
import { sampleProduct, sampleScenarios } from './sample-scenarios'

const scenario = (key: string) => sampleScenarios().find((s) => s.key === key)!
const pick = (key: string, over: Partial<Parameters<typeof selectComposition>[0]> = {}) => {
  const s = scenario(key)
  return selectComposition({ products: s.products, merchantCategory: s.merchantCategory, purpose: s.purpose, seed: s.seed, ...over })
}

describe('registry', () => {
  it('ships 10-15 foundational compositions with unique keys', () => {
    expect(COMPOSITIONS.length).toBeGreaterThanOrEqual(10)
    expect(COMPOSITIONS.length).toBeLessThanOrEqual(15)
    expect(new Set(COMPOSITION_KEYS).size).toBe(COMPOSITION_KEYS.length)
  })
  it('always has a universally eligible fallback', () => {
    const c = COMPOSITIONS.find((x) => x.key === 'essentials-grid')!
    for (const n of [1, 2, 7, 60]) {
      const products = Array.from({ length: n }, (_, i) => sampleProduct({ id: `f${i}`, title: `P ${i}`, category: 'other', photos: [] }))
      expect(isEligible(c, computeSignals(products, null))).toBe(true)
    }
  })
})

describe('category-aware selection (sample scenarios)', () => {
  it('fashion -> editorial lookbook', () => expect(pick('fashion').composition.key).toBe('editorial-lookbook'))
  it('single-brand electronics -> model lineup', () => expect(pick('electronics').composition.key).toBe('model-lineup'))
  it('mixed-brand electronics -> spec sheet', () => expect(pick('electronics-mixed').composition.key).toBe('spec-sheet-rows'))
  it('furniture -> room story', () => expect(pick('furniture').composition.key).toBe('room-story'))
  it('beauty -> clean shelf', () => expect(pick('beauty').composition.key).toBe('clean-shelf'))
  it('general retail new arrivals -> swipe ribbon or category sections, never a fashion/spec layout', () => {
    const key = pick('general').composition.key
    expect(['ribbon-carousel', 'category-sections']).toContain(key)
  })
  it('the chosen composition differs across at least 4 of the 6 scenarios', () => {
    const keys = new Set(sampleScenarios().map((s) => pick(s.key).composition.key))
    expect(keys.size).toBeGreaterThanOrEqual(4)
  })
  it('one product -> solo feature; two fashion products -> side by side', () => {
    const one = [sampleProduct({ title: 'Linen shirt', category: 'textiles-clothing' })]
    expect(selectComposition({ products: one, merchantCategory: null, purpose: 'COLLECTION', seed: 'a' }).composition.key).toBe('solo-feature')
    const two = [one[0], sampleProduct({ title: 'Wrap dress', category: 'textiles-clothing' })]
    expect(selectComposition({ products: two, merchantCategory: null, purpose: 'COLLECTION', seed: 'a' }).composition.key).toBe('duo-pairing')
  })
  it('photo-less products never get an image-led composition', () => {
    const products = scenario('fashion').products.map((p) => ({ ...p, photos: [] }))
    const sel = selectComposition({ products, merchantCategory: 'textiles-clothing', purpose: 'COLLECTION', seed: 'x' })
    expect(['editorial-lookbook', 'mosaic-grid', 'gallery-wall']).not.toContain(sel.composition.key)
  })
  it('uses the merchant category when the products themselves are mixed', () => {
    const mixed = [
      ...Array.from({ length: 4 }, (_, i) => sampleProduct({ id: `c${i}`, title: `Dress ${i}`, category: 'textiles-clothing' })),
      ...Array.from({ length: 3 }, (_, i) => sampleProduct({ id: `e${i}`, title: `Phone ${i}`, category: 'electronics' })),
      ...Array.from({ length: 3 }, (_, i) => sampleProduct({ id: `o${i}`, title: `Thing ${i}`, category: 'other' })),
    ]
    expect(computeSignals(mixed, 'textiles-clothing').vertical).toBe('fashion')
    expect(computeSignals(mixed, null).vertical).toBe('general')
  })
})

describe('determinism', () => {
  it('same input -> identical selection, 200 times', () => {
    const first = JSON.stringify(pick('fashion'))
    for (let i = 0; i < 200; i++) expect(JSON.stringify(pick('fashion'))).toBe(first)
  })
  it('does not depend on the clock or input array identity', () => {
    const s = scenario('furniture')
    const a = selectComposition({ products: s.products, merchantCategory: s.merchantCategory, purpose: s.purpose, seed: s.seed })
    const b = selectComposition({ products: structuredClone(s.products), merchantCategory: s.merchantCategory, purpose: s.purpose, seed: s.seed })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
  it('the seed only varies the look (flip/accent), never the composition', () => {
    const keys = new Set<string>()
    const variants = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const sel = pick('fashion', { seed: `shop-${i}` })
      keys.add(sel.composition.key)
      variants.add(JSON.stringify(sel.variant))
    }
    expect([...keys]).toEqual(['editorial-lookbook'])
    expect(variants.size).toBeGreaterThan(1)
  })
})

describe('merchant override', () => {
  it('honours a registered style key, even for odd counts', () => {
    const sel = pick('fashion', { styleKey: 'duo-pairing' })
    expect(sel.composition.key).toBe('duo-pairing')
    expect(sel.overridden).toBe(true)
  })
  it('ignores an unknown style key and falls back to the recommendation', () => {
    const sel = pick('fashion', { styleKey: 'does-not-exist' })
    expect(sel.composition.key).toBe('editorial-lookbook')
    expect(sel.overridden).toBe(false)
  })
})

describe('robustness', () => {
  it('selects something sensible for every count 1..60', () => {
    for (let n = 1; n <= 60; n++) {
      const products = Array.from({ length: n }, (_, i) => sampleProduct({ id: `r${i}`, title: `Item ${i}`, category: i % 3 ? 'textiles-clothing' : 'electronics' }))
      const sel = selectComposition({ products, merchantCategory: null, purpose: 'COLLECTION', seed: 's' })
      expect(sel.composition.key.length).toBeGreaterThan(0)
      expect(sel.alternatives.length).toBeGreaterThan(0)
    }
  })
  it('handles an empty showroom without throwing', () => {
    expect(() => selectComposition({ products: [], merchantCategory: null, purpose: 'COLLECTION', seed: 's' })).not.toThrow()
  })
  it('gives merchant-facing reasons that never exceed 3', () => {
    for (const s of sampleScenarios()) expect(pick(s.key).reasons.length).toBeLessThanOrEqual(3)
  })
})
