// Planning: composition + ordered products -> concrete sections.
// Guarantees every product appears exactly once, for ANY product count, so a
// merchant override can never produce a broken or lossy page.

import { categoryLabel } from '@/lib/constants'
import { findTaxonomyNode } from '@/lib/product-taxonomy'
import type { BlockPlan, CompositionDef, PlannedSection, ShowroomProduct, ShowroomPurpose } from './types'

/**
 * Display order: seller highlights first (in the order the seller starred
 * them), then the seller's own sequence. NEW_ARRIVALS sorts the remainder by
 * listing date, newest first - a verified timestamp, not a claim.
 */
export function orderProducts(
  products: ShowroomProduct[],
  highlights: string[],
  purpose: ShowroomPurpose,
): ShowroomProduct[] {
  const byId = new Map(products.map((p) => [p.id, p]))
  const starred: ShowroomProduct[] = []
  for (const id of highlights) {
    const hit = byId.get(id)
    if (hit && !starred.includes(hit)) starred.push(hit)
  }
  const rest = products.filter((p) => !starred.includes(p))
  if (purpose === 'NEW_ARRIVALS') {
    rest.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  }
  return [...starred, ...rest]
}

function categoryHeading(p: ShowroomProduct): string {
  if (p.taxonomyId) {
    const node = findTaxonomyNode(p.taxonomyId)
    if (node) return node.label
  }
  return categoryLabel(p.category)
}

function groupProducts(
  products: ShowroomProduct[],
  headingOf: (p: ShowroomProduct) => string | null,
): Array<{ heading: string; products: ShowroomProduct[] }> | null {
  const groups = new Map<string, ShowroomProduct[]>()
  const loose: ShowroomProduct[] = []
  const firstSeen: string[] = []
  const keyed = products.map((p) => ({ p, h: headingOf(p) }))
  for (const { p, h } of keyed) {
    if (!h) { loose.push(p); continue }
    const key = h.toLowerCase()
    if (!groups.has(key)) { groups.set(key, []); firstSeen.push(h) }
    groups.get(key)!.push(p)
  }
  const real: Array<{ heading: string; products: ShowroomProduct[] }> = []
  for (const h of firstSeen) {
    const members = groups.get(h.toLowerCase())!
    if (members.length >= 2) real.push({ heading: h, products: members })
    else loose.push(...members)
  }
  // Keep seller order inside the "More" shelf.
  const order = new Map(products.map((p, i) => [p.id, i]))
  loose.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  if (real.length === 0) return null
  if (loose.length > 0) real.push({ heading: 'More', products: loose })
  return real.length >= 2 ? real : null
}

export function planSections(composition: CompositionDef, ordered: ShowroomProduct[]): PlannedSection[] {
  let rest = [...ordered]
  const sections: PlannedSection[] = []
  const takeFrom = (n: number | 'rest') => {
    const count = n === 'rest' ? rest.length : Math.min(n, rest.length)
    const taken = rest.slice(0, count)
    rest = rest.slice(count)
    return taken
  }

  composition.plan.forEach((block, index) => {
    if (rest.length === 0) return
    const id = `${index}-${block.kind}`
    switch (block.kind) {
      case 'hero':
        sections.push({ id, block, products: takeFrom(1) })
        return
      case 'pair':
        sections.push({ id, block, products: takeFrom(2) })
        return
      case 'groups': {
        const all = takeFrom('rest')
        const byBrand = block.by === 'brand' ? groupProducts(all, (p) => p.brand?.trim() || null) : null
        const groups = byBrand ?? groupProducts(all, categoryHeading)
        if (!groups) {
          sections.push({ id, block, products: all })
          return
        }
        groups.forEach((g, gi) => sections.push({ id: `${id}-${gi}`, block, heading: g.heading, products: g.products }))
        return
      }
      default: {
        const take = (block as Extract<BlockPlan, { take: number | 'rest' }>).take
        sections.push({ id, block, products: takeFrom(take) })
      }
    }
  })

  if (rest.length > 0) {
    sections.push({
      id: 'overflow-grid',
      block: { kind: 'grid', take: 'rest', cols: 3, aspect: 'square' },
      products: rest,
    })
  }
  return sections
}

/** One call for the renderers: order -> select -> plan. Selection is passed in so tests can pin it. */
export function sectionCount(sections: PlannedSection[]): number {
  return sections.reduce((n, s) => n + s.products.length, 0)
}
