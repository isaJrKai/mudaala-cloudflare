/**
 * MCI-08 engine tests — caps, adjacency, exploration, fairness report.
 */
import { describe, expect, test } from 'bun:test'
import { MCI08Result } from '../../contracts/modules/mci08'
import type { RankedItem } from '../../contracts/modules/mci03'
import { MCI08_DEFAULT_SETTINGS, diversifySlate } from './engine'

function item(id: string, score: number): RankedItem {
  return { listing_id: id, score, reasons: [], contributions: {} }
}

function metaFor(ids: Array<[string, string]>): Record<string, { seller_ref: string; category_id: string; published_at: string }> {
  const out: Record<string, { seller_ref: string; category_id: string; published_at: string }> = {}
  for (const [id, seller] of ids) {
    out[id] = { seller_ref: seller, category_id: 'test', published_at: '2026-11-01T00:00:00Z' }
  }
  return out
}

describe('MCI-08 per-seller cap', () => {
  test('caps seller dominance and reports the applied cap', () => {
    const ranked = [item('a1', 90), item('a2', 80), item('a3', 70), item('b1', 60)]
    const meta = metaFor([
      ['a1', 'A'], ['a2', 'A'], ['a3', 'A'], ['b1', 'B'],
    ])
    const result = diversifySlate(ranked, meta, { maxPerSeller: 2 })
    expect(MCI08Result.safeParse(result).success).toBe(true)
    expect(result.fairness_report.applied_caps).toContain('max_per_seller=2')
    const aCount = result.slate.filter((id) => meta[id].seller_ref === 'A').length
    expect(aCount).toBe(2)
    expect(result.demoted.some((d) => d.listing_id === 'a3' && d.rule.startsWith('PER_SELLER_CAP'))).toBe(true)
  })

  test('top-1 never moves when the cap is not implicated', () => {
    const ranked = [item('a1', 90), item('b1', 80), item('b2', 70), item('b3', 60), item('b4', 50), item('b5', 40)]
    const meta = metaFor([
      ['a1', 'A'], ['b1', 'B'], ['b2', 'B'], ['b3', 'B'], ['b4', 'B'], ['b5', 'B'],
    ])
    const result = diversifySlate(ranked, meta, { maxPerSeller: 2 })
    expect(result.slate[0]).toBe('a1')
  })
})

describe('MCI-08 adjacency and exploration', () => {
  test('no two consecutive items from the same seller when alternatives exist', () => {
    const ranked = [item('a1', 90), item('b1', 80), item('a2', 70)]
    const meta = metaFor([['a1', 'A'], ['b1', 'B'], ['a2', 'A']])
    const result = diversifySlate(ranked, meta)
    for (let i = 1; i < result.slate.length; i++) {
      expect(meta[result.slate[i]].seller_ref).not.toBe(meta[result.slate[i - 1]].seller_ref)
    }
  })

  test('exploration promotes one unrepresented seller into the window', () => {
    // Window filled by ten distinct sellers (so cap and adjacency passes are
    // inert), one further item from an unrepresented seller K.
    const ranked: RankedItem[] = []
    const pairs: Array<[string, string]> = []
    for (let i = 1; i <= 10; i++) {
      ranked.push(item(`s${i}`, 100 - i))
      pairs.push([`s${i}`, `S${i}`])
    }
    ranked.push(item('k1', 10))
    pairs.push(['k1', 'K'])
    const result = diversifySlate(ranked, metaFor(pairs), { maxPerSeller: 10, explorationSlots: 1 })
    expect(result.fairness_report.new_shop_slots_used).toBe(1)
    const kPosition = result.slate.indexOf('k1')
    expect(kPosition).toBeLessThan(MCI08_DEFAULT_SETTINGS.explorationWindow)
    expect(result.demoted.some((d) => d.rule === 'EXPLORATION_PROMOTION' && d.listing_id === 'k1')).toBe(true)
  })

  test('relevance is preserved: slate is a permutation of input restricted by caps', () => {
    const ranked = [item('x1', 50), item('x2', 49), item('x3', 48), item('x4', 47)]
    const meta = metaFor([['x1', 'X'], ['x2', 'X'], ['x3', 'Y'], ['x4', 'Z']])
    const result = diversifySlate(ranked, meta, { maxPerSeller: 1 })
    expect(new Set(result.slate).size).toBe(result.slate.length)
    expect(result.slate).toContain('x1')
    expect(result.slate).toContain('x3')
  })
})

describe('MCI-08 fairness report', () => {
  test('reports distinct sellers in top-5 and concentration share', () => {
    const ranked = [item('a1', 90), item('b1', 80), item('c1', 70), item('d1', 60), item('a2', 50)]
    const meta = metaFor([['a1', 'A'], ['b1', 'B'], ['c1', 'C'], ['d1', 'D'], ['a2', 'A']])
    const result = diversifySlate(ranked, meta)
    expect(result.fairness_report.distinct_sellers_top5).toBe(4)
    expect(result.fairness_report.top_seller_share).toBeCloseTo(0.4, 3)
  })

  test('empty input produces an empty, valid report', () => {
    const result = diversifySlate([], {})
    expect(result.slate).toEqual([])
    expect(result.fairness_report.top_seller_share).toBe(0)
  })

  test('deterministic', () => {
    const ranked = [item('a1', 90), item('a2', 80), item('b1', 70)]
    const meta = metaFor([['a1', 'A'], ['a2', 'A'], ['b1', 'B']])
    expect(diversifySlate(ranked, meta)).toEqual(diversifySlate(ranked, meta))
  })
})
