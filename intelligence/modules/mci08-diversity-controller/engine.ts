/**
 * MCI-08 Discovery diversity controller — deterministic slate controller v0.2.
 *
 * Registry guardrail: reduce repetitive exposure, give new shops fair
 * opportunity, preserve relevance and policy gates.
 *
 * Deterministic rules (no randomness), applied in order:
 * 1. Per-seller cap inside the slate (default 2) — beyond-cap items are
 *    DEMOTED TO THE TAIL of the slate with the rule recorded. Remediation
 *    fix: increment-1 dropped them from the returned slate entirely, which
 *    both contradicted the documented tail-placement behaviour and made
 *    `demoted` the only trace of live inventory.
 * 2. Adjacency repair — no two consecutive slate items from the same seller
 *    where an alternative exists.
 * 3. Rotation bucket (remediation: IMPLEMENTED, was declared but inert in
 *    increment-1): when `rotation_bucket > 0`, the top window
 *    (explorationWindow items) is rotated left by exactly that many
 *    positions — a deterministic, page-stable rotation that varies which
 *    seller holds the top slot across requests without re-ranking anything.
 *    bucket=0 (default) is a no-op, preserving the increment-1 ordering.
 * 4. Exploration promotion — up to `exploration_slots` promotions of the
 *    first item of sellers not yet represented inside the top window
 *    (default 1). Promotion never breaks the per-seller cap (the promoted
 *    seller is unrepresented in the window).
 * 5. Adjacency is re-checked AFTER rotation and AGAIN after promotion
 *    (round-2 remediation, reviewer finding 4): rotating `A,B,C,A` left once
 *    yields `B,C,A,A`, and a promotion vacates an interior position — both
 *    can (re)introduce same-seller neighbours. Each violating pair is fixed
 *    by moving the nearest alternative BETWEEN the two (forward candidates
 *    first, then backward), only when the move creates no new violation at
 *    the vacated spot; where no safe alternative exists the pair may remain
 *    (the guardrail promises separation only where alternatives exist).
 *
 * Remediation hardening:
 * - Input is validated at runtime (zod), not trusted from TypeScript types —
 *   including the SETTINGS object itself (round-2: integers within bounds,
 *   never NaN or negative).
 * - Duplicate listing ids are deduplicated (first occurrence wins); a
 *   duplicated id can never occupy two slate positions.
 * - Missing seller metadata degrades to the shared 'unknown' seller bucket
 *   instead of crashing the fairness maths.
 * - Fairness metrics are computed from the FINAL returned slate (including
 *   tail placements), so the report always describes what the caller gets.
 *
 * Relevance preservation is measurable: apart from the rotation window
 * (bucket > 0) and safety repairs, the slate order is a permutation of the
 * input ranking restricted by the cap; the top-1 item never moves unless the
 * cap itself requires it, an explicit rotation bucket is requested, or no
 * safe alternative exists for a same-seller pair.
 */
import { z } from 'zod'
import type { MCI08Result } from '../../contracts/modules/mci08'
import type { RankedItem } from '../../contracts/modules/mci03'

export const MCI08_ENGINE_VERSION = 'mci08-diversity-controller-v0.2.1'

export const MCI08_ITEM_SHAPE = z.object({
  listing_id: z.string().min(1).max(128),
  score: z.number(),
  reasons: z.array(z.string()).max(16).default([]),
  contributions: z.record(z.string(), z.number()).default({}),
})

export const MCI08_METADATA_SHAPE = z.record(
  z.string(),
  z.object({
    seller_ref: z.string().min(1).max(128),
    category_id: z.string().max(64),
    published_at: z.string(),
  }),
)

const MCI08_INPUT_SHAPE = z.object({
  ranked: z.array(MCI08_ITEM_SHAPE).max(500),
  metadata: MCI08_METADATA_SHAPE,
})

export interface MCI08Settings {
  maxPerSeller: number
  rotationBucket: number
  explorationSlots: number
  explorationWindow: number
}

/**
 * Runtime validation for the settings object itself (round-2 remediation,
 * reviewer finding 4): direct callers — not just the gateway contract — get
 * integer-bounded, NaN-rejecting validation. A negative cap would demote
 * every item, a negative bucket would silently disable rotation, and a zero
 * window would misplace exploration promotions.
 */
export const MCI08_SETTINGS_SHAPE = z.object({
  maxPerSeller: z.number().int().min(1).max(50).default(2),
  rotationBucket: z.number().int().min(0).max(500).default(0),
  explorationSlots: z.number().int().min(0).max(50).default(1),
  explorationWindow: z.number().int().min(1).max(500).default(10),
})

export const MCI08_DEFAULT_SETTINGS: MCI08Settings = {
  maxPerSeller: 2,
  rotationBucket: 0,
  explorationSlots: 1,
  explorationWindow: 10,
}

export const UNKNOWN_SELLER = 'unknown'

export function diversifySlate(
  ranked: RankedItem[],
  metadata: Record<string, { seller_ref: string; category_id: string; published_at: string }>,
  settings?: Partial<MCI08Settings>,
): MCI08Result {
  // Runtime validation — the contract boundary holds for direct callers too,
  // including the settings object (never NaN, negative, or unbounded).
  const parsed = MCI08_INPUT_SHAPE.parse({ ranked, metadata })
  const s: MCI08Settings = MCI08_SETTINGS_SHAPE.parse({ ...MCI08_DEFAULT_SETTINGS, ...settings })
  const appliedCaps: string[] = []
  const demoted: Array<{ listing_id: string; rule: string }> = []

  const sellerOf = (id: string) => metadata[id]?.seller_ref ?? UNKNOWN_SELLER

  // Deduplicate: first occurrence wins (input is score-ordered, so the
  // highest-ranked instance of an id is kept).
  const seenIds = new Set<string>()
  const unique: RankedItem[] = []
  for (const item of parsed.ranked) {
    if (seenIds.has(item.listing_id)) continue
    seenIds.add(item.listing_id)
    unique.push(item)
  }

  // 1. Per-seller cap over the ranked order; overflow goes to the tail.
  const perSeller = new Map<string, number>()
  const kept: RankedItem[] = []
  const overflow: RankedItem[] = []
  for (const item of unique) {
    const seller = sellerOf(item.listing_id)
    const count = perSeller.get(seller) ?? 0
    if (count >= s.maxPerSeller) {
      overflow.push(item)
      demoted.push({ listing_id: item.listing_id, rule: `PER_SELLER_CAP_${s.maxPerSeller}` })
    } else {
      perSeller.set(seller, count + 1)
      kept.push(item)
    }
  }
  if (overflow.length > 0) appliedCaps.push(`max_per_seller=${s.maxPerSeller}`)

  // Tail placement (documented behaviour, restored by the remediation):
  // demoted items remain IN the slate, after every within-cap item.
  const slate = [...kept, ...overflow]

  // 2. Adjacency repair (reused after rotation and promotion below). For
  //    each same-seller neighbour pair, the nearest alternative item is
  //    moved BETWEEN the two. The INITIAL pass is forward-only and
  //    guard-free — byte-identical to the increment-1 behaviour (top-1
  //    stability). The POST-ROTATION and POST-PROMOTION passes may also
  //    look BACKWARD (after a rotation the only alternative can sit ABOVE
  //    the pair) and reject a candidate whose removal would join two
  //    same-seller items at the vacated spot. Where no safe alternative
  //    exists the pair may remain.
  const repairAdjacency = (allowBackward: boolean, guardVacated: boolean) => {
    for (let sweep = 0; sweep <= slate.length; sweep++) {
      let changed = false
      for (let i = 1; i < slate.length; i++) {
        const seller = sellerOf(slate[i].listing_id)
        if (seller !== sellerOf(slate[i - 1].listing_id)) continue
        const candidates: Array<{ j: number; backward: boolean }> = []
        for (let k = i + 1; k < slate.length; k++) {
          if (sellerOf(slate[k].listing_id) !== seller) candidates.push({ j: k, backward: false })
        }
        if (allowBackward) {
          for (let k = i - 2; k >= 0; k--) {
            if (sellerOf(slate[k].listing_id) !== seller) candidates.push({ j: k, backward: true })
          }
        }
        for (const { j, backward } of candidates) {
          if (guardVacated && j > 0 && j < slate.length - 1) {
            const vacatesIntoViolation =
              sellerOf(slate[j - 1].listing_id) === sellerOf(slate[j + 1].listing_id)
            if (vacatesIntoViolation) continue
          }
          const moved = slate.splice(j, 1)[0]
          slate.splice(backward ? i - 1 : i, 0, moved)
          demoted.push({ listing_id: moved.listing_id, rule: 'ADJACENCY_SWAP' })
          changed = true
          i-- // re-scan this index: the boundary changed under the cursor
          break
        }
      }
      if (!changed) break
    }
  }
  repairAdjacency(false, false)

  // 3. Rotation bucket: deterministic left-rotation of the top window.
  const windowSize = Math.min(s.explorationWindow, slate.length)
  if (s.rotationBucket > 0 && windowSize > 1) {
    const bucket = s.rotationBucket % windowSize
    if (bucket > 0) {
      const window = slate.slice(0, windowSize)
      const rotated = [...window.slice(bucket), ...window.slice(0, bucket)]
      slate.splice(0, windowSize, ...rotated)
      appliedCaps.push(`rotation_bucket=${s.rotationBucket}`)
      // Rotation can (re)introduce same-seller adjacency (`A,B,C,A` rotated
      // once is `B,C,A,A`) — the diversity controller's invariant wins over
      // the raw rotation outcome (reviewer finding 4).
      repairAdjacency(true, true)
    }
  }

  // 4. Exploration promotion: first item of sellers absent from the top window.
  let promotions = 0
  if (s.explorationSlots > 0) {
    const windowEnd = Math.min(s.explorationWindow, slate.length)
    const represented = new Set(slate.slice(0, windowEnd).map((i) => sellerOf(i.listing_id)))
    for (let idx = windowEnd; idx < slate.length && promotions < s.explorationSlots; idx++) {
      const candidate = slate[idx]
      const seller = sellerOf(candidate.listing_id)
      if (!represented.has(seller)) {
        // Promote to the last slot of the window (stable, deterministic):
        // each promotion shifts the window tail down by one.
        slate.splice(idx, 1)
        const insertAt = Math.max(0, Math.min(windowEnd - 1 - promotions, slate.length - 1))
        slate.splice(insertAt, 0, candidate)
        demoted.push({ listing_id: candidate.listing_id, rule: 'EXPLORATION_PROMOTION' })
        represented.add(seller)
        promotions++
      }
    }
    // A promotion vacated an interior position, which can join two
    // same-seller tail items — repair ONLY then (with no promotion, the
    // initial pass result stands untouched).
    if (promotions > 0) repairAdjacency(true, true)
  }

  // Fairness report — computed from the FINAL returned slate.
  const top5 = slate.slice(0, Math.min(5, slate.length))
  const distinctSellersTop5 = new Set(top5.map((i) => sellerOf(i.listing_id))).size
  const counts = new Map<string, number>()
  for (const item of slate) {
    const seller = sellerOf(item.listing_id)
    counts.set(seller, (counts.get(seller) ?? 0) + 1)
  }
  const maxShare = slate.length === 0 ? 0 : Math.max(...counts.values()) / slate.length

  return {
    slate: slate.map((i) => i.listing_id),
    demoted: demoted.slice(0, 100),
    fairness_report: {
      distinct_sellers_top5: distinctSellersTop5,
      top_seller_share: Math.round(maxShare * 1000) / 1000,
      applied_caps: appliedCaps.slice(0, 8),
      new_shop_slots_used: promotions,
    },
  }
}
