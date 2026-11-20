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
    // Remediation: beyond-cap items stay in the slate (tail), so A appears
    // 3 times IN TOTAL — but only 2 within the top window (cap respected
    // where it matters: exposure).
    const aCount = result.slate.filter((id) => meta[id].seller_ref === 'A').length
    expect(aCount).toBe(3)
    // Both within-cap A items precede the cap-demoted one, wherever the
    // adjacency pass interleaves other sellers.
    expect(result.slate.indexOf('a1')).toBeLessThan(result.slate.indexOf('a3'))
    expect(result.slate.indexOf('a2')).toBeLessThan(result.slate.indexOf('a3'))
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

describe('MCI-08 remediation — tail placement', () => {
  test('beyond-cap items remain in the slate at the tail, in original order', () => {
    const ranked = [item('a1', 90), item('a2', 80), item('a3', 70), item('b1', 60), item('c1', 50), item('a4', 40)]
    const meta = metaFor([['a1', 'A'], ['a2', 'A'], ['a3', 'A'], ['b1', 'B'], ['c1', 'C'], ['a4', 'A']])
    const result = diversifySlate(ranked, meta, { maxPerSeller: 2 })
    // Top window holds within-cap items (adjacency pass interleaves same-
    // seller neighbours with alternatives); a3 and a4 sit at the tail.
    expect(result.slate).toContain('a3')
    expect(result.slate).toContain('a4')
    expect(result.slate.slice(0, 4)).toEqual(['a1', 'b1', 'a2', 'c1'])
    expect(result.slate.slice(-2)).toEqual(['a3', 'a4'])
    // The slate is a full permutation of the input (nothing vanishes).
    expect(result.slate.length).toBe(6)
    expect(new Set(result.slate)).toEqual(new Set(['a1', 'a2', 'a3', 'a4', 'b1', 'c1']))
    expect(result.demoted.filter((d) => d.rule.startsWith('PER_SELLER_CAP')).length).toBe(2)
  })

  test('no listing silently disappears from the returned slate', () => {
    const ranked = [item('a1', 90), item('a2', 85), item('a3', 80), item('a4', 75), item('a5', 70)]
    const meta = metaFor([['a1', 'A'], ['a2', 'A'], ['a3', 'A'], ['a4', 'A'], ['a5', 'A']])
    const result = diversifySlate(ranked, meta, { maxPerSeller: 2 })
    expect(result.slate.length).toBe(5)
    expect(result.fairness_report.applied_caps).toContain('max_per_seller=2')
  })
})

describe('MCI-08 remediation — rotation bucket (implemented, deterministic)', () => {
  test('bucket > 0 rotates the top window deterministically; 0 is a no-op', () => {
    const ranked = [item('a1', 90), item('b1', 80), item('c1', 70), item('d1', 60), item('e1', 50)]
    const meta = metaFor([['a1', 'A'], ['b1', 'B'], ['c1', 'C'], ['d1', 'D'], ['e1', 'E']])
    const zero = diversifySlate(ranked, meta, { rotationBucket: 0, maxPerSeller: 10, explorationSlots: 0 })
    const three = diversifySlate(ranked, meta, { rotationBucket: 3, maxPerSeller: 10, explorationSlots: 0 })
    const threeAgain = diversifySlate(ranked, meta, { rotationBucket: 3, maxPerSeller: 10, explorationSlots: 0 })
    expect(zero.slate).toEqual(['a1', 'b1', 'c1', 'd1', 'e1']) // no-op at 0
    expect(three.slate).toEqual(['d1', 'e1', 'a1', 'b1', 'c1']) // left-rotated by 3
    expect(threeAgain.slate).toEqual(three.slate) // deterministic
    expect(three.fairness_report.applied_caps).toContain('rotation_bucket=3')
    // Rotation preserves the window SET (a permutation, nothing lost).
    expect(new Set(three.slate)).toEqual(new Set(zero.slate))
  })

  test('rotation keeps the full slate intact and reports the applied bucket', () => {
    const ranked = [item('x1', 50), item('y1', 49), item('x2', 48)]
    const meta = metaFor([['x1', 'X'], ['y1', 'Y'], ['x2', 'X']])
    const result = diversifySlate(ranked, meta, { rotationBucket: 2, maxPerSeller: 1, explorationSlots: 0 })
    expect(new Set(result.slate)).toEqual(new Set(['x1', 'y1', 'x2']))
  })
})

describe('MCI-08 round 2 — adjacency survives rotation and promotion', () => {
  test('rotation does not reintroduce same-seller adjacency (reviewer example)', () => {
    // `A,B,C,A` rotated left once would be `B,C,A,A` — the post-rotation
    // repair must break that pair where an alternative exists.
    const ranked = [item('a1', 90), item('b1', 80), item('c1', 70), item('a2', 60)]
    const meta = metaFor([['a1', 'A'], ['b1', 'B'], ['c1', 'C'], ['a2', 'A']])
    const result = diversifySlate(ranked, meta, {
      rotationBucket: 1,
      explorationWindow: 4,
      explorationSlots: 0,
      maxPerSeller: 10,
    })
    expect(result.fairness_report.applied_caps).toContain('rotation_bucket=1')
    for (let i = 1; i < result.slate.length; i++) {
      expect(meta[result.slate[i]].seller_ref).not.toBe(meta[result.slate[i - 1]].seller_ref)
    }
    // The window is a permutation — rotation moved items, nothing vanished.
    expect(new Set(result.slate)).toEqual(new Set(['a1', 'b1', 'c1', 'a2']))
    expect(result.demoted.some((d) => d.rule === 'ADJACENCY_SWAP')).toBe(true)
  })

  test('rotation, seller cap and exploration combined keep all invariants', () => {
    const ranked = [
      item('a1', 95), item('a2', 90), item('b1', 85), item('c1', 80),
      item('a3', 75), item('k1', 10), item('a4', 5),
    ]
    const meta = metaFor([
      ['a1', 'A'], ['a2', 'A'], ['b1', 'B'], ['c1', 'C'],
      ['a3', 'A'], ['k1', 'K'], ['a4', 'A'],
    ])
    const result = diversifySlate(ranked, meta, {
      maxPerSeller: 2,
      rotationBucket: 2,
      explorationSlots: 1,
      explorationWindow: 5,
    })
    // Full permutation of the input (nothing lost, nothing duplicated).
    expect(result.slate.length).toBe(7)
    expect(new Set(result.slate)).toEqual(new Set(['a1', 'a2', 'a3', 'a4', 'b1', 'c1', 'k1']))
    // The adjacency invariant holds on the FINAL slate.
    for (let i = 1; i < result.slate.length; i++) {
      expect(meta[result.slate[i]].seller_ref).not.toBe(meta[result.slate[i - 1]].seller_ref)
    }
    expect(result.fairness_report.applied_caps).toContain('rotation_bucket=2')
  })

  test('exploration promotion cannot leave same-seller tail neighbours behind', () => {
    // K promotes out of a tail slot flanked by two beyond-cap items of the
    // SAME seller (cap 1): the vacated join `A,A` must be repaired.
    const ranked = [item('c1', 95), item('d1', 90), item('e1', 85), item('a1', 80), item('a2', 75), item('k1', 10)]
    const meta = metaFor([
      ['c1', 'C'], ['d1', 'D'], ['e1', 'E'], ['a1', 'A'], ['a2', 'A'], ['k1', 'K'],
    ])
    const result = diversifySlate(ranked, meta, {
      maxPerSeller: 1,
      explorationSlots: 1,
      explorationWindow: 4,
      rotationBucket: 0,
    })
    expect(result.fairness_report.new_shop_slots_used).toBe(1)
    expect(result.demoted.some((d) => d.rule === 'EXPLORATION_PROMOTION' && d.listing_id === 'k1')).toBe(true)
    for (let i = 1; i < result.slate.length; i++) {
      expect(meta[result.slate[i]].seller_ref).not.toBe(meta[result.slate[i - 1]].seller_ref)
    }
    expect(new Set(result.slate)).toEqual(new Set(['c1', 'd1', 'e1', 'a1', 'a2', 'k1']))
  })

  test('invariants hold across every rotation bucket for a mixed catalogue', () => {
    const pairs: Array<[string, string]> = []
    const ranked: RankedItem[] = []
    let score = 100
    for (let s = 0; s < 6; s++) {
      for (let n = 0; n < 2; n++) {
        const id = `s${s}i${n}`
        ranked.push(item(id, score--))
        pairs.push([id, `SELLER-${s}`])
      }
    }
    const meta = metaFor(pairs)
    for (const bucket of [0, 1, 2, 3, 4]) {
      const result = diversifySlate(ranked, meta, {
        rotationBucket: bucket,
        maxPerSeller: 2,
        explorationSlots: 1,
      })
      expect(result.slate.length).toBe(12)
      expect(new Set(result.slate).size).toBe(12)
      for (let i = 1; i < result.slate.length; i++) {
        expect(meta[result.slate[i]].seller_ref).not.toBe(meta[result.slate[i - 1]].seller_ref)
      }
    }
  })

  test('settings themselves are runtime-validated (round 2)', () => {
    // A zero/negative cap would demote everything; a negative bucket would
    // silently disable rotation; a zero window would misplace promotions;
    // NaN is not a number. All rejected at the engine boundary.
    expect(() => diversifySlate([], {}, { maxPerSeller: 0 })).toThrow()
    expect(() => diversifySlate([], {}, { maxPerSeller: -2 })).toThrow()
    expect(() => diversifySlate([], {}, { rotationBucket: -1 })).toThrow()
    expect(() => diversifySlate([], {}, { explorationWindow: 0 })).toThrow()
    expect(() => diversifySlate([], {}, { explorationSlots: 1.5 })).toThrow()
    expect(() => diversifySlate([], {}, { maxPerSeller: Number.NaN })).toThrow()
    // Valid partial settings parse fine (defaults fill the rest).
    const result = diversifySlate([], {}, { rotationBucket: 3 })
    expect(result.slate).toEqual([])
  })
})

describe('MCI-08 remediation — adversarial inputs', () => {
  test('missing seller metadata degrades to the unknown bucket without crashing', () => {
    const ranked = [item('a1', 90), item('mystery', 80)]
    const meta = metaFor([['a1', 'A']]) // 'mystery' has no metadata
    const result = diversifySlate(ranked, meta)
    expect(result.slate).toEqual(['a1', 'mystery'])
    expect(result.fairness_report.distinct_sellers_top5).toBe(2) // A + unknown
  })

  test('duplicate listing ids are deduplicated (first occurrence wins)', () => {
    const ranked = [item('dup', 90), item('b1', 80), item('dup', 10)]
    const meta = metaFor([['dup', 'A'], ['b1', 'B']])
    const result = diversifySlate(ranked, meta)
    expect(result.slate.filter((id) => id === 'dup').length).toBe(1)
    expect(result.slate).toEqual(['dup', 'b1'])
  })

  test('empty slate produces an empty, valid report (contract-parse clean)', () => {
    const result = diversifySlate([], {})
    expect(MCI08Result.safeParse(result).success).toBe(true)
    expect(result.slate).toEqual([])
    expect(result.fairness_report.new_shop_slots_used).toBe(0)
  })

  test('oversized metadata is rejected by the direct engine boundary', () => {
    const metadata = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`listing-${i}`, { seller_ref: `seller-${i}`, category_id: 'electronics', published_at: '2026-11-20T00:00:00Z' }]))
    expect(() => diversifySlate([], metadata)).toThrow()
  })

  test('large input (500 items, one seller) stays within contract bounds', () => {
    const ranked: RankedItem[] = []
    const meta: Record<string, { seller_ref: string; category_id: string; published_at: string }> = {}
    for (let i = 0; i < 500; i++) {
      ranked.push(item(`L${i}`, 500 - i))
      meta[`L${i}`] = { seller_ref: 'MEGA', category_id: 'test', published_at: '2026-11-01T00:00:00Z' }
    }
    const result = diversifySlate(ranked, meta, { maxPerSeller: 2 })
    expect(MCI08Result.safeParse(result).success).toBe(true)
    expect(result.slate.length).toBe(500)
    // Window (top 2 of MEGA) + 498 tail items, all present exactly once.
    expect(new Set(result.slate).size).toBe(500)
    expect(result.fairness_report.top_seller_share).toBeCloseTo(1, 3)
  })

  test('malformed ranked items fail the runtime boundary (not silently accepted)', () => {
    const bad = [{ listing_id: 'x', score: 'not-a-number', reasons: [], contributions: {} }] as unknown as RankedItem[]
    expect(() => diversifySlate(bad, {})).toThrow()
  })

  test('exploration promotion never violates cap or adjacency invariants', () => {
    const ranked = [item('a1', 95), item('b1', 90), item('a2', 85), item('b2', 80), item('k1', 10)]
    const meta = metaFor([['a1', 'A'], ['b1', 'B'], ['a2', 'A'], ['b2', 'B'], ['k1', 'K']])
    const result = diversifySlate(ranked, meta, { maxPerSeller: 2, explorationSlots: 1 })
    // Adjacency invariant holds after promotion.
    for (let i = 1; i < result.slate.length; i++) {
      expect(meta[result.slate[i]].seller_ref).not.toBe(meta[result.slate[i - 1]].seller_ref)
    }
    // The promoted seller stays within its per-seller cap.
    const kCount = result.slate.filter((id) => id === 'k1').length
    expect(kCount).toBe(1)
  })

  test('fairness metrics reflect the final returned slate including tail', () => {
    const ranked = [item('a1', 90), item('a2', 85), item('a3', 80), item('b1', 75)]
    const meta = metaFor([['a1', 'A'], ['a2', 'A'], ['a3', 'A'], ['b1', 'B']])
    const result = diversifySlate(ranked, meta, { maxPerSeller: 2 })
    // Final slate: a1, a2, b1, a3 (tail) → A holds 3 of 4.
    expect(result.fairness_report.top_seller_share).toBeCloseTo(0.75, 3)
    expect(result.fairness_report.distinct_sellers_top5).toBe(2)
  })
})

describe('MCI-08 round 3 — initial repair never creates new violations', () => {
  test('reviewer regression: A1,A2,B1,A3 — the repair must not vacate B1 into a new violation', () => {
    // Sellers A,A,B,A with cap 2: cap pass → [a1,a2,b1 | a3(tail)]. The
    // guard-free initial pass moved b1 to split (a1,a2), which vacated a
    // spot that joined (a2,a3) — a NEW violation. With the vacated-spot
    // guard, b1 stays put: the one remaining same-seller pair is the
    // unavoidable head pair (three A items and one separator make one
    // adjacency mathematically unavoidable — no safe alternative exists).
    const ranked = [item('a1', 90), item('a2', 80), item('b1', 70), item('a3', 60)]
    const meta = metaFor([['a1', 'A'], ['a2', 'A'], ['b1', 'B'], ['a3', 'A']])
    const result = diversifySlate(ranked, meta, { rotationBucket: 0, explorationSlots: 0 })
    // b1 keeps separating the tail A items; no NEW violation was created.
    expect(result.slate).toEqual(['a1', 'a2', 'b1', 'a3'])
    expect(result.slate[2]).toBe('b1')
    // Permutation integrity and cap/tail placement intact.
    expect(new Set(result.slate)).toEqual(new Set(['a1', 'a2', 'b1', 'a3']))
    const aInWindow = result.slate.slice(0, 3).filter((id) => meta[id].seller_ref === 'A').length
    expect(aInWindow).toBe(2) // cap respected in the exposure window
    expect(result.demoted.some((d) => d.listing_id === 'a3' && d.rule.startsWith('PER_SELLER_CAP'))).toBe(true)
  })

  test('a safe alternative is still taken by the initial pass', () => {
    // Moving b1 is SAFE here: its vacated spot joins a2 (seller A) with
    // c1 (seller C) — different sellers — so the invariant is fully satisfied.
    const ranked = [item('a1', 90), item('a2', 80), item('b1', 70), item('c1', 60)]
    const meta = metaFor([['a1', 'A'], ['a2', 'A'], ['b1', 'B'], ['c1', 'C']])
    const result = diversifySlate(ranked, meta, { rotationBucket: 0, explorationSlots: 0 })
    expect(result.slate).toEqual(['a1', 'b1', 'a2', 'c1'])
    for (let i = 1; i < result.slate.length; i++) {
      expect(meta[result.slate[i]].seller_ref).not.toBe(meta[result.slate[i - 1]].seller_ref)
    }
  })

  test('the guard skips unsafe candidates but takes a later safe one', () => {
    // (a1,a2) violated: b1 is unsafe (vacating joins a2,a3 — same seller)
    // but c1 is safe (last position, nothing to join). The repair must not
    // give up after the first rejection.
    const ranked = [item('a1', 95), item('a2', 90), item('b1', 85), item('a3', 80), item('c1', 75)]
    const meta = metaFor([
      ['a1', 'A'], ['a2', 'A'], ['b1', 'B'], ['a3', 'A'], ['c1', 'C'],
    ])
    const result = diversifySlate(ranked, meta, { maxPerSeller: 3, rotationBucket: 0, explorationSlots: 0 })
    expect(result.slate).toEqual(['a1', 'c1', 'a2', 'b1', 'a3'])
    for (let i = 1; i < result.slate.length; i++) {
      expect(meta[result.slate[i]].seller_ref).not.toBe(meta[result.slate[i - 1]].seller_ref)
    }
    expect(new Set(result.slate)).toEqual(new Set(['a1', 'a2', 'b1', 'a3', 'c1']))
  })

  test('tail placement plus repair reaches zero violations when separation is possible', () => {
    // Beyond-cap a3 lands in the tail; the repair separates every A item
    // because enough alternatives exist.
    const ranked = [
      item('a1', 95), item('a2', 90), item('b1', 85), item('c1', 80), item('d1', 75), item('a3', 70),
    ]
    const meta = metaFor([
      ['a1', 'A'], ['a2', 'A'], ['b1', 'B'], ['c1', 'C'], ['d1', 'D'], ['a3', 'A'],
    ])
    const result = diversifySlate(ranked, meta, { maxPerSeller: 2, rotationBucket: 0, explorationSlots: 0 })
    expect(result.slate).toEqual(['a1', 'b1', 'a2', 'c1', 'd1', 'a3'])
    for (let i = 1; i < result.slate.length; i++) {
      expect(meta[result.slate[i]].seller_ref).not.toBe(meta[result.slate[i - 1]].seller_ref)
    }
    expect(new Set(result.slate).size).toBe(6)
  })
})
