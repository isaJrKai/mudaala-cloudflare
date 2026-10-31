// Shared server-side helpers for the public web pages (/l/[id], /s/[code]).
 // Everything here touches the database or the expiry sweep, so client
 // bundles must never import from this file.

import { cache } from 'react'
import { db } from '@/lib/db'
import { expireOverdueListings } from '@/lib/listings'
import { formatPrice } from '@/lib/format'
import { unitLabel } from '@/lib/constants'
import { siteUrl } from '@/lib/site'

export function photosOf(photosJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(photosJson)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is string => typeof p === 'string').slice(0, 8)
  } catch {
    return []
  }
}

export function absolutePhoto(photo: string): string {
  return photo.startsWith('http') ? photo : new URL(photo, siteUrl).toString()
}

export function placeOf(listing: { area: string | null; county: string }): string {
  return listing.area ? `${listing.area}, ${listing.county}` : listing.county
}

export function priceLabelOf(listing: { price: number | null; unit: string | null; currency: string }): string | null {
  if (listing.price === null) return null
  return formatPrice(listing.price, listing.unit ? unitLabel(listing.unit) : null, listing.currency)
}

export function metaTitle(listing: {
  type: string
  title: string
  area: string | null
  county: string
  price: number | null
  unit: string | null
  currency: string
}): string {
  if (listing.type === 'REQUEST') return `Wanted: ${listing.title} · ${placeOf(listing)} · Mudaala`
  const price = priceLabelOf(listing)
  return price ? `${listing.title} · ${price} · Mudaala` : `${listing.title} · ${placeOf(listing)} · Mudaala`
}

export function metaDescription(listing: { description: string; area: string | null; county: string }): string {
  const base = listing.description.replace(/\\s+/g, ' ').trim()
  const clipped = base.length > 140 ? `${base.slice(0, 140).replace(/\\s+\\S*$/, '')}…` : base
  return `${clipped} · ${placeOf(listing)}, Uganda · on Mudaala`
}

/**
 * Expiry is scheduled maintenance, not a prerequisite for serving a public
 * listing. If the opportunistic sweep fails, continue with the read path.
 * Keeping the lookup callback inside this helper makes the fallback contract
 * directly testable without mocking Prisma or touching a database.
 */
export async function withBestEffortExpirySweep<T>(
  sweep: () => Promise<unknown>,
  lookup: () => Promise<T>,
  log: (message: string, detail: string) => void = (message, detail) => console.error(message, detail),
): Promise<T> {
  try {
    await sweep()
  } catch (error) {
    log(
      '[ad-page] overdue-listing sweep failed; continuing public listing lookup:',
      error instanceof Error ? error.message : 'unknown error',
    )
  }
  return lookup()
}

// One loader per request (React.cache dedupes the generateMetadata + page +
// not-found trio). Resolves the bare id first, then the dash-tail of older
// keyword-style URLs. Never throws or redirects - callers decide between
// 308, 404 and render, so the not-found boundary can reuse it safely.
export const loadAdRow = cache(async (param: string) =>
  withBestEffortExpirySweep(expireOverdueListings, async () => {
    let listing = await db.listing.findUnique({
      where: { id: param },
      include: { user: { include: { profile: true } } },
    })
    if (!listing && param.includes('-')) {
      const tail = param.slice(param.lastIndexOf('-') + 1)
      if (tail) {
        listing = await db.listing.findUnique({
          where: { id: tail },
          include: { user: { include: { profile: true } } },
        })
      }
    }
    return listing
  }),
)

// Live ads a gone page can offer instead: same category, real stock, the
// freshest first. At most four - a 404 is a doorway, not a marketplace.
export async function similarListings(category: string, excludeId: string) {
  return db.listing.findMany({
    where: { status: 'ACTIVE', category, id: { not: excludeId } },
    orderBy: { refreshedAt: 'desc' },
    take: 4,
  })
}
