// Deterministic editorial suggestions. NO AI, NO invented claims.
// Every sentence is assembled from facts already stored on the listings
// (count, brands, category, listed prices). These are SUGGESTIONS: the
// merchant must accept or edit them, and the stored introSource records which.

import { categoryLabel } from '@/lib/constants'
import { formatPrice } from '@/lib/format'
import { findTaxonomyNode } from '@/lib/product-taxonomy'
import { computeSignals } from './select'
import { VERTICAL_NOUN } from './verticals'
import type { ShowroomProduct, ShowroomPurpose } from './types'

export interface CopySuggestion {
  title: string
  introduction: string
}

function dominantCategoryLabel(products: ShowroomProduct[]): string | null {
  const tally = new Map<string, number>()
  for (const p of products) tally.set(p.category, (tally.get(p.category) ?? 0) + 1)
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  if (!top) return null
  // Prefer the taxonomy leaf label when every product shares one.
  const taxa = new Set(products.map((p) => p.taxonomyId))
  const only = taxa.size === 1 ? [...taxa][0] : null
  return (only && findTaxonomyNode(only)?.label) || categoryLabel(top[0])
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export function suggestShowroomCopy(
  products: ShowroomProduct[],
  shopName: string,
  purpose: ShowroomPurpose,
  merchantCategory: string | null = null,
): CopySuggestion {
  const signals = computeSignals(products, merchantCategory)
  const category = dominantCategoryLabel(products)

  let title: string
  switch (purpose) {
    case 'NEW_ARRIVALS': title = 'New arrivals'; break
    case 'FEATURED': title = 'Featured picks'; break
    case 'BRAND': title = signals.topBrand && signals.topBrandShare >= 0.5 ? `${signals.topBrand} collection` : 'Brand showcase'; break
    case 'CATEGORY': title = category ?? 'Our selection'; break
    default: title = category && signals.groupCount <= 1 ? `${category} collection` : 'Our selection'
  }
  title = title.slice(0, 80)

  const noun = VERTICAL_NOUN[signals.vertical]
  const n = products.length
  const sentences = [`${n} ${n === 1 ? noun.one : noun.many} from ${shopName}.`]

  const brands: string[] = []
  for (const p of products) {
    const b = p.brand?.trim()
    if (b && !brands.some((x) => x.toLowerCase() === b.toLowerCase())) brands.push(b)
  }
  if (brands.length >= 1 && brands.length <= 3) sentences.push(`${brands.length === 1 ? 'Brand' : 'Brands'}: ${joinNames(brands)}.`)

  const priced = products.filter((p) => p.price !== null)
  const currencies = new Set(priced.map((p) => p.currency))
  if (priced.length > 0 && currencies.size === 1) {
    const min = Math.min(...priced.map((p) => p.price as number))
    sentences.push(`Prices from ${formatPrice(min, null, priced[0].currency)}.`)
  }
  return { title, introduction: sentences.join(' ').slice(0, 600) }
}
