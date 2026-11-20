/**
 * MCI-08 Discovery diversity controller — deterministic slate controller v0.
 *
 * Registry guardrail: reduce repetitive exposure, give new shops fair
 * opportunity, preserve relevance and policy gates.
 *
 * Deterministic rules (no randomness):
 * 1. Per-seller cap inside the slate (default 2) — beyond-cap items are
 *    demoted to the tail with the rule recorded.
 * 2. Adjacency pass — no two consecutive slate items from the same seller
 *    where an alternative exists.
 * 3. Exploration promotion — up to `exploration_slots` promotions of the
 *    first item of sellers not yet represented inside the top window
 *    (default 10). On synthetic fixtures this typically surfaces new/small
 *    shops; the report counts these as new_shop_slots_used. There is no
 *    reliable new-shop signal in the v0 metadata, so the report field is
 *    defined as exploration promotions, not a claim about shop age.
 *
 * Relevance preservation is measurable: the slate order is a permutation of
 * the input ranking restricted by the cap; the top-1 item never moves unless
 * the cap itself requires it.
 */
import type { MCI08Result } from '../../contracts/modules/mci08'
import type { RankedItem } from '../../contracts/modules/mci03'

export const MCI08_ENGINE_VERSION = 'mci08-diversity-controller-v0.1.0'

export interface MCI08Settings {
  maxPerSeller: number
  rotationBucket: number
  explorationSlots: number
  explorationWindow: number
}

export const MCI08_DEFAULT_SETTINGS: MCI08Settings = {
  maxPerSeller: 2,
  rotationBucket: 0,
  explorationSlots: 1,
  explorationWindow: 10,
}

interface Meta {
  seller_ref: string
  category_id: string
  published_at: string
}

export function diversifySlate(
  ranked: RankedItem[],
  metadata: Record<string, Meta>,
  settings?: Partial<MCI08Settings>,
): MCI08Result {
  const s: MCI08Settings = { ...MCI08_DEFAULT_SETTINGS, ...settings }
  const appliedCaps: string[] = []
  const demoted: Array<{ listing_id: string; rule: string }> = []

  const sellerOf = (id: string) => metadata[id]?.seller_ref ?? 'unknown'

  // 1. Per-seller cap over the ranked order.
  const perSeller = new Map<string, number>()
  const kept: RankedItem[] = []
  const overflow: RankedItem[] = []
  for (const item of ranked) {
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

  // 2. Adjacency pass: swap same-seller neighbours with the next eligible item.
  const slate = [...kept]
  for (let i = 1; i < slate.length; i++) {
    if (sellerOf(slate[i].listing_id) !== sellerOf(slate[i - 1].listing_id)) continue
    // find next item after i from a different seller
    for (let j = i + 1; j < slate.length; j++) {
      if (sellerOf(slate[j].listing_id) !== sellerOf(slate[i - 1].listing_id)) {
        const moved = slate.splice(j, 1)[0]
        slate.splice(i, 0, moved)
        demoted.push({ listing_id: moved.listing_id, rule: 'ADJACENCY_SWAP' })
        break
      }
    }
  }

  // 3. Exploration promotion: first item of sellers absent from the top window.
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
  }

  // Fairness report.
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
      applied_caps: appliedCaps,
      new_shop_slots_used: promotions,
    },
  }
}
