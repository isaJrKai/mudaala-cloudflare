// Listing -> ShowroomProduct mapping and the "only show what exists" rules.

import { findTaxonomyNode } from '@/lib/product-taxonomy'
import { SEED_PHOTO_MARKER } from './constants'
import { VERTICAL_FACT_PRIORITY } from './verticals'
import type { Availability, ProductFact, ShowroomProduct, Vertical } from './types'

/** The minimal listing shape both Prisma rows and API-serialized listings satisfy. */
export interface ListingLike {
  id: string
  title: string
  description: string
  category: string
  taxonomyId?: string | null
  brand?: string | null
  model?: string | null
  attributes?: unknown
  price: number | null
  compareAtPrice?: number | null
  currency: string
  unit?: string | null
  priceNegotiable?: boolean
  photos: string[] | string
  availabilityStatus?: string | null
  publishedAt: Date | string
}

function parsePhotos(raw: string[] | string): string[] {
  let list: unknown = raw
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(list)) return []
  return list
    .filter((p): p is string => typeof p === 'string' && p.length > 0 && p.length <= 500)
    // PLACEHOLDER RULE: seed fixtures never present as real merchant stock.
    .filter((p) => !p.includes(SEED_PHOTO_MARKER))
    .slice(0, 4)
}

function parseAttributes(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string | number | boolean> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[key] = v
  }
  return out
}

const AVAILABILITY: ReadonlySet<string> = new Set(['UNKNOWN', 'IN_STOCK', 'AVAILABLE_ON_ORDER', 'OUT_OF_STOCK'])

export function toShowroomProduct(listing: ListingLike): ShowroomProduct {
  const status = listing.availabilityStatus ?? 'UNKNOWN'
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    category: listing.category,
    taxonomyId: listing.taxonomyId ?? null,
    brand: listing.brand?.trim() || null,
    model: listing.model?.trim() || null,
    attributes: parseAttributes(listing.attributes),
    price: listing.price,
    compareAtPrice: listing.compareAtPrice ?? null,
    currency: listing.currency,
    unit: listing.unit ?? null,
    priceNegotiable: Boolean(listing.priceNegotiable),
    photos: parsePhotos(listing.photos),
    availability: (AVAILABILITY.has(status) ? status : 'UNKNOWN') as Availability,
    publishedAt: new Date(listing.publishedAt).toISOString(),
  }
}

/**
 * Mirror of the Prisma `where` used by the public collection page, as a pure
 * predicate (used for the merchant preview and covered by tests). Keep in sync
 * with showroom/repo.ts `publicListingWhere`.
 */
export function isPubliclyListable(
  listing: { userId: string; status: string; type: string; isSeed: boolean; expiresAt: Date | string },
  ownerId: string,
  now: Date,
): boolean {
  return (
    listing.userId === ownerId &&
    listing.status === 'ACTIVE' &&
    listing.type === 'OFFER' &&
    !listing.isSeed &&
    new Date(listing.expiresAt).getTime() > now.getTime()
  )
}

// ------------------------------------------------------------------ facts

const CONDITION_LABELS: Record<string, string> = {
  NEW: 'New',
  LIKE_NEW: 'Like new',
  USED: 'Used',
  REFURBISHED: 'Refurbished',
}

function humanize(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function formatValue(value: string | number | boolean): string | null {
  if (typeof value === 'boolean') return value ? 'Yes' : null // "No" is omitted rather than implied
  if (typeof value === 'number') return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value)
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 40) return null
  if (CONDITION_LABELS[trimmed]) return CONDITION_LABELS[trimmed]
  if (/^[A-Z_]+$/.test(trimmed)) return humanize(trimmed.toLowerCase())
  return trimmed
}

/**
 * Verified facts only: brand/model plus the attributes the merchant filled in
 * against their taxonomy node. Never derived from the description text,
 * never defaulted, never padded. Order is vertical-aware but the SET of facts
 * is exactly what is stored.
 */
export function productFacts(product: ShowroomProduct, vertical: Vertical, max: number): ProductFact[] {
  const facts: ProductFact[] = []
  const seen = new Set<string>()
  const node = product.taxonomyId ? findTaxonomyNode(product.taxonomyId) : undefined
  const labelFor = (key: string) => node?.attributes?.find((a) => a.key === key)?.label ?? humanize(key)

  const push = (key: string, label: string, raw: string | number | boolean | null | undefined) => {
    if (raw === null || raw === undefined) return
    const value = formatValue(raw)
    if (!value) return
    const dedupe = `${label.toLowerCase()}|${value.toLowerCase()}`
    if (seen.has(dedupe)) return
    seen.add(dedupe)
    facts.push({ key, label, value })
  }

  const priority = VERTICAL_FACT_PRIORITY[vertical]
  const attrKeys = Object.keys(product.attributes).filter((k) => k !== 'brand' && k !== 'model')
  const ordered = [
    ...priority.filter((k) => attrKeys.includes(k)),
    ...attrKeys.filter((k) => !priority.includes(k)),
  ]
  push('brand', 'Brand', product.brand ?? (typeof product.attributes.brand === 'string' ? product.attributes.brand : null))
  push('model', 'Model', product.model ?? (typeof product.attributes.model === 'string' ? product.attributes.model : null))
  for (const key of ordered) push(key, labelFor(key), product.attributes[key])
  return facts.slice(0, Math.max(0, max))
}

export const AVAILABILITY_LABEL: Record<Exclude<Availability, 'UNKNOWN'>, string> = {
  IN_STOCK: 'In stock',
  AVAILABLE_ON_ORDER: 'Available on order',
  OUT_OF_STOCK: 'Out of stock',
}

/** Seller-reported availability, or null when the seller never said. */
export function availabilityLabel(product: ShowroomProduct): string | null {
  return product.availability === 'UNKNOWN' ? null : AVAILABILITY_LABEL[product.availability]
}

/** A "was" price is shown only when the seller supplied one that is genuinely higher. */
export function wasPrice(product: ShowroomProduct): number | null {
  if (product.price === null || product.compareAtPrice === null) return null
  return product.compareAtPrice > product.price ? product.compareAtPrice : null
}

/** A short excerpt of the seller's own description. */
export function excerpt(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max).replace(/\s+\S*$/, '')}…`
}
