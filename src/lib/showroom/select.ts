// Composition selection - PURE and DETERMINISTIC.
// Same input (products, purpose, merchant category, slug) -> same output, always.
// No Math.random, no Date, no I/O. Ties break by registry order.

import { COMPOSITIONS, FALLBACK_COMPOSITION_KEY, findComposition } from './compositions'
import { stableHash } from './hash'
import { productFacts } from './products'
import { VERTICAL_SURFACE, verticalOfCategory } from './verticals'
import type {
  CompositionDef,
  CompositionVariant,
  Selection,
  SelectionInput,
  ShowroomProduct,
  ShowroomSignals,
  Vertical,
} from './types'

function share(count: number, total: number): number {
  return total === 0 ? 0 : count / total
}

function groupKeyOf(product: ShowroomProduct): string {
  return product.taxonomyId ?? product.category
}

export function computeSignals(
  products: ShowroomProduct[],
  merchantCategory: string | null,
): ShowroomSignals {
  const count = products.length

  // Vertical: dominant product vertical when clear; else the merchant's own
  // category if it is well represented; else general.
  const tally = new Map<Vertical, number>()
  for (const p of products) {
    const v = verticalOfCategory(p.category)
    tally.set(v, (tally.get(v) ?? 0) + 1)
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const [topVertical, topCount] = ranked[0] ?? (['general', 0] as [Vertical, number])
  const merchantVertical = verticalOfCategory(merchantCategory)
  let vertical: Vertical = 'general'
  let purity = 0
  if (count > 0) {
    if (share(topCount, count) >= 0.6) {
      vertical = topVertical
      purity = share(topCount, count)
    } else if (merchantVertical !== 'general' && share(tally.get(merchantVertical) ?? 0, count) >= 0.4) {
      vertical = merchantVertical
      purity = share(tally.get(merchantVertical) ?? 0, count)
    } else {
      vertical = 'general'
      purity = share(tally.get('general') ?? 0, count)
    }
  }

  const withPhoto = products.filter((p) => p.photos.length > 0).length
  const multiPhoto = products.filter((p) => p.photos.length > 1).length
  const withFacts = products.filter((p) => productFacts(p, vertical, 99).length >= 2).length

  const brands = new Map<string, { n: number; label: string }>()
  for (const p of products) {
    const label = p.brand?.trim()
    if (!label) continue
    const key = label.toLowerCase()
    const prev = brands.get(key)
    brands.set(key, { n: (prev?.n ?? 0) + 1, label: prev?.label ?? label })
  }
  const topBrandEntry = [...brands.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))[0]

  return {
    count,
    vertical,
    verticalPurity: purity,
    imageCoverage: share(withPhoto, count),
    multiPhotoShare: share(multiPhoto, count),
    factsShare: share(withFacts, count),
    brandCount: brands.size,
    topBrandShare: share(topBrandEntry?.n ?? 0, count),
    topBrand: topBrandEntry?.label ?? null,
    groupCount: new Set(products.map(groupKeyOf)).size,
    pricedShare: share(products.filter((p) => p.price !== null).length, count),
  }
}

export function isEligible(c: CompositionDef, s: ShowroomSignals): boolean {
  const e = c.eligibility
  if (s.count < e.minProducts || s.count > e.maxProducts) return false
  if (s.imageCoverage < e.minImageCoverage) return false
  if (e.minFactsShare !== undefined && s.factsShare < e.minFactsShare) return false
  if (e.minTopBrandShare !== undefined && s.topBrandShare < e.minTopBrandShare) return false
  if (e.minGroupCount !== undefined && s.groupCount < e.minGroupCount) return false
  return true
}

function countFit(c: CompositionDef, count: number): number {
  const [lo, hi] = c.sweetSpot
  if (count >= lo && count <= hi) return 2
  const distance = count < lo ? lo - count : count - hi
  return Math.max(0, 2 - distance * 0.4)
}

export function scoreComposition(c: CompositionDef, s: ShowroomSignals, purpose: SelectionInput['purpose']): number {
  const vertical = (c.affinity.verticals[s.vertical] ?? 0) * (0.5 + 0.5 * s.verticalPurity)
  const purposeScore = c.affinity.purposes[purpose] ?? 0
  const image = c.imageWeight * s.imageCoverage + 0.3 * c.imageWeight * s.multiPhotoShare
  const w = c.signalWeights ?? {}
  const signal =
    (w.factsShare ?? 0) * s.factsShare +
    (w.topBrandShare ?? 0) * s.topBrandShare +
    (w.groupCount ?? 0) * Math.min(s.groupCount, 5)
  return Math.round((vertical + purposeScore + countFit(c, s.count) + image + signal) * 1000) / 1000
}

export function variantFor(seed: string, compositionKey: string): CompositionVariant {
  const h = stableHash(`${seed}:${compositionKey}`)
  return { flip: (h & 1) === 1, accent: (h & 2) === 2 ? 'mango' : 'green' }
}

function reasonsFor(c: CompositionDef, s: ShowroomSignals, purpose: SelectionInput['purpose']): string[] {
  const reasons: string[] = []
  if ((c.affinity.verticals[s.vertical] ?? 0) >= 2 && s.verticalPurity >= 0.6) {
    reasons.push(`Suits a ${s.vertical === 'general' ? 'mixed' : s.vertical} selection`)
  }
  if ((c.affinity.purposes[purpose] ?? 0) >= 2) reasons.push(`Made for ${purpose.toLowerCase().replace('_', ' ')}`)
  if (c.imageWeight >= 1 && s.imageCoverage >= 0.8) {
    const withPhoto = Math.round(s.imageCoverage * s.count)
    reasons.push(`${withPhoto} of ${s.count} products have photos`)
  }
  if (c.signalWeights?.topBrandShare && s.topBrand && s.topBrandShare >= 0.5) reasons.push(`Mostly ${s.topBrand}`)
  if (c.signalWeights?.factsShare && s.factsShare >= 0.5) reasons.push('Your products have details worth showing')
  if (c.signalWeights?.groupCount && s.groupCount >= 2) reasons.push(`${s.groupCount} product types to browse`)
  const [lo, hi] = c.sweetSpot
  if (s.count >= lo && s.count <= hi && reasons.length < 3) reasons.push(`Looks best with ${lo === hi ? lo : `${lo}-${hi}`} products`)
  return reasons.slice(0, 3)
}

export function selectComposition(input: SelectionInput): Selection {
  const signals = computeSignals(input.products, input.merchantCategory)
  const eligible = COMPOSITIONS.filter((c) => isEligible(c, signals))
  const scored = eligible
    .map((c, index) => ({ c, index, score: scoreComposition(c, signals, input.purpose) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)

  const overrideDef = findComposition(input.styleKey)
  const best =
    scored[0] ??
    // Unreachable in practice (essentials-grid is always eligible) but never throw on a public page.
    { c: findComposition(FALLBACK_COMPOSITION_KEY)!, index: 0, score: 0 }
  const chosen = overrideDef ?? best.c

  return {
    composition: chosen,
    variant: variantFor(input.seed, chosen.key),
    surface: VERTICAL_SURFACE[signals.vertical],
    vertical: signals.vertical,
    signals,
    score: overrideDef ? scoreComposition(overrideDef, signals, input.purpose) : best.score,
    reasons: overrideDef ? ['Chosen by the seller'] : reasonsFor(best.c, signals, input.purpose),
    alternatives: scored.map(({ c, score }) => ({ key: c.key, label: c.label, score })),
    overridden: Boolean(overrideDef),
  }
}
