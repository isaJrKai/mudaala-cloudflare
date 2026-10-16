// Mudaala - listing domain service.
// Search, expiry, refresh rules, saved-search matching.
// All time-dependent logic reads persisted timestamps; nothing is faked in the UI.

import { db } from '@/lib/db'
import { ApiError } from '@/lib/api'
import { isTransitionAllowed } from '@/lib/validation'
import { LISTING_ACTIVE_DAYS, REFRESH_COOLDOWN_HOURS, EXPIRING_SOON_DAYS } from '@/lib/constants'
import { haversineMeters } from '@/lib/geo'
import type { Listing, Prisma } from '@prisma/client'
import type { ListingQuery } from '@/lib/validation'
import { getSearchTermGroups, searchTextMatchesGroup, scoreListingSearch, parseSearchIntent } from '@/lib/search'

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}


// Lazy expiry sweep - idempotent, runs on reads that matter.
// Persisted timestamps decide; expired listings are marked EXPIRED and owners notified.
export async function expireOverdueListings(): Promise<number> {
  const now = new Date()
  const overdue = await db.listing.findMany({
    where: { status: 'ACTIVE', expiresAt: { lt: now } },
    select: { id: true, userId: true, title: true, expiresAt: true },
    take: 500,
  })
  if (overdue.length === 0) return 0
  await db.listing.updateMany({
    where: { id: { in: overdue.map((l) => l.id) } },
    data: { status: 'EXPIRED' },
  })
  await db.notification.createMany({
    data: overdue.map((l) => ({
      userId: l.userId,
      type: 'LISTING_EXPIRED',
      title: 'Listing expired',
      body: `"${l.title}" has expired. Repost it if it is still available.`,
      listingId: l.id,
    })),
  })
  return overdue.length
}

// "Expiring soon" warnings - sent once per listing via expiringNotifiedAt.
export async function notifyExpiringSoon(): Promise<number> {
  const soon = addDays(new Date(), EXPIRING_SOON_DAYS)
  const candidates = await db.listing.findMany({
    where: { status: 'ACTIVE', expiresAt: { lt: soon, gt: new Date() }, expiringNotifiedAt: null },
    select: { id: true, userId: true, title: true, expiresAt: true },
    take: 500,
  })
  if (candidates.length === 0) return 0
  await db.listing.updateMany({
    where: { id: { in: candidates.map((l) => l.id) } },
    data: { expiringNotifiedAt: new Date() },
  })
  await db.notification.createMany({
    data: candidates.map((l) => ({
      userId: l.userId,
      type: 'LISTING_EXPIRING',
      title: 'Listing expiring soon',
      body: `"${l.title}" expires on ${l.expiresAt.toISOString().slice(0, 10)}. Refresh it to stay visible.`,
      listingId: l.id,
    })),
  })
  return candidates.length
}

interface SearchOptions {
  query: ListingQuery
  includeStatuses?: string[]
}

// The shop identity every buyer should see next to a listing: the named
// business profile (shop name + shop photo), falling back to the account name.
// area/county ride along so the browse feed can disambiguate same-name shops
// ("Nakato · Nakasero" vs "Nakato · Jinja").
export const SHOP_OWNER_INCLUDE = {
  user: {
    select: {
      id: true,
      name: true,
      // profile.lat/lng arrive PRE-ROUNDED to ~100 m (see profile/location
      // route) - enough to order and label distances, never a precise spot.
      profile: { select: { businessName: true, photoUrl: true, area: true, county: true, lat: true, lng: true } },
    },
  },
} as const

export type ListingWithShop = Prisma.ListingGetPayload<{ include: typeof SHOP_OWNER_INCLUDE }>

// A listing as it leaves the API: the stored JSON photos string becomes a
// real array.
type Serialized<L extends { photos: string }> = Omit<L, 'photos'> & { photos: string[] }

// Stored photos are a JSON array of URL strings; corrupt data degrades to [].
function parsePhotos(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 500)
      .slice(0, 4)
  } catch {
    return []
  }
}

// Client-supplied photo lists are never trusted: keep only valid URL shapes,
// dedupe, cap at 4. Entries come from our own upload API (/uploads/...) or
// are pasted http(s) links.
export function sanitizePhotos(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const v of input) {
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (t.length === 0 || t.length > 500) continue
    const allowed = t.startsWith('/uploads/') || /^https?:\/\/\S+$/i.test(t)
    if (allowed && !out.includes(t)) out.push(t)
    if (out.length >= 4) break
  }
  return out
}

// Serialize a listing for the API: photos become a real array.
export function serializeListing<T extends { photos: string }>(listing: T): Serialized<T> {
  const { photos, ...rest } = listing
  return { ...rest, photos: parsePhotos(photos) }
}

function searchWhereGroups(query: string): Prisma.ListingWhereInput[] {
  return getSearchTermGroups(query).map((group) => {
    const alternatives: Prisma.ListingWhereInput[] = []
    for (const term of group.terms) {
      alternatives.push(
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { category: { contains: term, mode: 'insensitive' } },
        { area: { contains: term, mode: 'insensitive' } },
        { county: { contains: term, mode: 'insensitive' } },
      )
    }
    for (const category of group.categories) {
      alternatives.push({ category: { equals: category, mode: 'insensitive' } })
    }
    return { OR: alternatives }
  })
}

export async function searchListings({ query, includeStatuses = ['ACTIVE'] }: SearchOptions): Promise<{
  items: Serialized<ListingWithShop>[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}> {
  const page = query.page ?? 1
  const pageSize = query.pageSize ?? 20
  const intent = parseSearchIntent(query.q ?? '')
  const searchText = intent.text
  const minPrice = query.minPrice === undefined ? intent.minPrice
    : intent.minPrice === undefined ? query.minPrice : Math.max(query.minPrice, intent.minPrice)
  const maxPrice = query.maxPrice === undefined ? intent.maxPrice
    : intent.maxPrice === undefined ? query.maxPrice : Math.min(query.maxPrice, intent.maxPrice)
  const effectiveSort = intent.sort && query.sort === undefined
    ? intent.sort
    : query.sort

  const where: Prisma.ListingWhereInput = { status: { in: includeStatuses } }

  if (searchText) {
    // Every meaningful word must match, but each word may use customer-language
    // synonyms or an inferred category. Price phrases are extracted first, so
    // "perfume under 50k" filters by price instead of searching for "50k".
    where.AND = searchWhereGroups(query.q ?? '')
  }
  if (query.type) where.type = query.type
  if (query.category) where.category = query.category
  if (query.county) where.county = query.county
  if (query.unit) where.unit = query.unit
  if (minPrice !== undefined || maxPrice !== undefined) {
    where.price = {
      ...(minPrice !== undefined ? { gte: minPrice } : {}),
      ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
    }
  }

  const orderBy: Prisma.ListingOrderByWithRelationInput =
    effectiveSort === 'price_asc' ? { price: { sort: 'asc', nulls: 'last' } } : effectiveSort === 'price_desc' ? { price: { sort: 'desc', nulls: 'last' } } : { refreshedAt: 'desc' }

  // Keep a copy of the non-text filters for a bounded Unicode-normalized
  // fallback. PostgreSQL's raw contains filter cannot find mathematical
  // alphanumeric letters (for example 𝐩𝐞𝐫𝐟𝐮𝐦𝐞), even though the shared
  // normalizer correctly converts them to ordinary ASCII.
  const textFallbackWhere: Prisma.ListingWhereInput = { ...where }
  delete textFallbackWhere.AND

  // "Photos sell": within the same recency band (ads refreshed on the same
  // day), ads WITH a photo rank slightly higher than ads without. Recency
  // stays the primary order - a 2-day-old ad never jumps a 5-hour-old one;
  // the boost only decides inside the band. Implemented like the 'nearest'
  // sort: fetch a capped window in freshness order, re-rank in memory, slice
  // the page - so pagination stays honest (nearest-shop-on-page-1 logic,
  // same trade-off, same cap).
  if (effectiveSort === 'newest' || effectiveSort === undefined) {
    const PHOTO_BOOST_SCAN_CAP = 500
    const BAND_MS = 24 * 60 * 60 * 1000
    const now = Date.now()
    const pageStart = (page - 1) * pageSize

    // The photo/relevance ranking window is deliberately capped. Once a
    // browse page starts beyond that window, continue with database ordering
    // instead of returning an empty page while total/pageCount advertise more.
    // For unfiltered browse, the first 500 rows contain the same IDs as the
    // database's freshness order; photo boost only reorders within that window.
    if (!searchText && pageStart >= PHOTO_BOOST_SCAN_CAP) {
      const [pageRows, total] = await Promise.all([
        db.listing.findMany({
          where,
          orderBy: [orderBy],
          skip: pageStart,
          take: pageSize,
          include: SHOP_OWNER_INCLUDE,
        }),
        db.listing.count({ where }),
      ])
      return {
        items: pageRows.map(serializeListing),
        total,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      }
    }

    const [all, total, fallbackCandidates] = await Promise.all([
      db.listing.findMany({
        where,
        orderBy: [orderBy],
        take: PHOTO_BOOST_SCAN_CAP,
        include: SHOP_OWNER_INCLUDE,
      }),
      db.listing.count({ where }),
      searchText
        ? db.listing.findMany({
            where: textFallbackWhere,
            orderBy: [orderBy],
            take: PHOTO_BOOST_SCAN_CAP,
            include: SHOP_OWNER_INCLUDE,
          })
        : Promise.resolve([] as ListingWithShop[]),
    ])

    // Match normalized seller text in a capped recent window, then merge it
    // with database matches. Never scan the whole listings table. Count the
    // overlap in SQL so total remains correct even when the fallback finds
    // rows that also matched the ordinary database filter.
    const groups = searchText ? getSearchTermGroups(query.q ?? '') : []
    const normalizedFallback = fallbackCandidates.filter((row) =>
      groups.length > 0 && groups.every((group) => searchTextMatchesGroup(
        group,
        [row.title, row.description, row.category, row.area, row.county],
        row.category,
      )),
    )
    const allIds = new Set(all.map((row) => row.id))
    const extraFallback = normalizedFallback.filter((row) => !allIds.has(row.id))
    const overlapCount = extraFallback.length
      ? await db.listing.count({ where: { AND: [where, { id: { in: extraFallback.map((row) => row.id) } }] } })
      : 0
    const combined = [...all, ...extraFallback]
    const adjustedTotal = total + extraFallback.length - overlapCount

    const ranked = combined.map((row, index) => ({
      row,
      index,
      band: Math.floor((now - row.refreshedAt.getTime()) / BAND_MS),
      hasPhoto: parsePhotos(row.photos).length > 0,
      relevance: searchText ? scoreListingSearch({
        title: row.title,
        description: row.description,
        category: row.category,
        area: row.area,
        county: row.county,
      }, searchText) : 0,
    }))
    ranked.sort((a, b) =>
      (query.q ? b.relevance - a.relevance : 0) ||
      a.band - b.band ||
      (a.hasPhoto === b.hasPhoto ? a.index - b.index : a.hasPhoto ? -1 : 1),
    )
    let pageRows = ranked.slice(pageStart, pageStart + pageSize).map((entry) => entry.row)

    // A page can straddle the cap when pageSize does not divide 500 (e.g.
    // page 17 at 30 rows/page). Fill only that page's overflow from the next
    // database-ordered rows so there are no gaps or duplicates at the boundary.
    if (!searchText && total > PHOTO_BOOST_SCAN_CAP && pageStart < PHOTO_BOOST_SCAN_CAP && pageStart + pageSize > PHOTO_BOOST_SCAN_CAP) {
      const overflowRows = await db.listing.findMany({
        where,
        orderBy: [orderBy],
        skip: PHOTO_BOOST_SCAN_CAP,
        take: pageStart + pageSize - PHOTO_BOOST_SCAN_CAP,
        include: SHOP_OWNER_INCLUDE,
      })
      pageRows = [...pageRows, ...overflowRows]
    }

    return {
      items: pageRows.map(serializeListing),
      total: adjustedTotal,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(adjustedTotal / pageSize)),
    }
  }

  // "Near me": order by real walking-sense distance to the buyer. SQLite has
  // no geo index, so we scan the matching rows (capped), compute haversine
  // from the buyer's position to each SHOP's blurred spot, and paginate in
  // memory. Sorting on the server (not per browser page) keeps page 2 honest:
  // the nearest shop is always on page 1. Shops without a spot fall in
  // after the located ones, in freshness order.
  if (query.sort === 'nearest' && query.lat !== undefined && query.lng !== undefined) {
    const NEAREST_SCAN_CAP = 500
    const [all, total, fallbackCandidates] = await Promise.all([
      db.listing.findMany({ where, orderBy: [orderBy], take: NEAREST_SCAN_CAP, include: SHOP_OWNER_INCLUDE }),
      db.listing.count({ where }),
      searchText
        ? db.listing.findMany({ where: textFallbackWhere, orderBy: [orderBy], take: NEAREST_SCAN_CAP, include: SHOP_OWNER_INCLUDE })
        : Promise.resolve([] as ListingWithShop[]),
    ])
    const groups = searchText ? getSearchTermGroups(query.q ?? '') : []
    const normalizedFallback = fallbackCandidates.filter((row) =>
      groups.length > 0 && groups.every((group) => searchTextMatchesGroup(
        group, [row.title, row.description, row.category, row.area, row.county], row.category,
      )),
    )
    const allIds = new Set(all.map((row) => row.id))
    const extraFallback = normalizedFallback.filter((row) => !allIds.has(row.id))
    const overlapCount = extraFallback.length
      ? await db.listing.count({ where: { AND: [where, { id: { in: extraFallback.map((row) => row.id) } }] } })
      : 0
    const combined = [...all, ...extraFallback]
    const adjustedTotal = total + extraFallback.length - overlapCount
    const buyer = { lat: query.lat, lng: query.lng }
    const ranked = combined.map((row, index) => {
      const spot = row.user.profile
      const meters = spot && spot.lat !== null && spot.lng !== null ? haversineMeters(buyer, { lat: spot.lat, lng: spot.lng }) : null
      return { row, meters, index }
    })
    ranked.sort((a, b) => {
      if (a.meters === null && b.meters === null) return a.index - b.index
      if (a.meters === null) return 1
      if (b.meters === null) return -1
      return a.meters - b.meters || a.index - b.index
    })
    const pageRows = ranked.slice((page - 1) * pageSize, page * pageSize).map((entry) => entry.row)
    return {
      items: pageRows.map(serializeListing),
      total: adjustedTotal,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(adjustedTotal / pageSize)),
    }
  }

  // Price-intent sorting uses a bounded in-memory merge too, so Unicode-styled
  // seller text is not lost just because the query asked for the cheapest or
  // most expensive matching products.
  if (searchText && (effectiveSort === 'price_asc' || effectiveSort === 'price_desc')) {
    const SEARCH_SCAN_CAP = 500
    const [all, total, fallbackCandidates] = await Promise.all([
      db.listing.findMany({ where, orderBy: [orderBy], take: SEARCH_SCAN_CAP, include: SHOP_OWNER_INCLUDE }),
      db.listing.count({ where }),
      db.listing.findMany({ where: textFallbackWhere, orderBy: [orderBy], take: SEARCH_SCAN_CAP, include: SHOP_OWNER_INCLUDE }),
    ])
    const groups = getSearchTermGroups(query.q ?? '')
    const normalizedFallback = fallbackCandidates.filter((row) =>
      groups.length > 0 && groups.every((group) => searchTextMatchesGroup(
        group, [row.title, row.description, row.category, row.area, row.county], row.category,
      )),
    )
    const allIds = new Set(all.map((row) => row.id))
    const extraFallback = normalizedFallback.filter((row) => !allIds.has(row.id))
    const overlapCount = extraFallback.length
      ? await db.listing.count({ where: { AND: [where, { id: { in: extraFallback.map((row) => row.id) } }] } })
      : 0
    const combined = [...all, ...extraFallback]
    const adjustedTotal = total + extraFallback.length - overlapCount
    combined.sort((a, b) => {
      const aPrice = a.price
      const bPrice = b.price
      if (aPrice === null && bPrice !== null) return 1
      if (bPrice === null && aPrice !== null) return -1
      if (aPrice !== null && bPrice !== null && aPrice !== bPrice) {
        return effectiveSort === 'price_asc' ? aPrice - bPrice : bPrice - aPrice
      }
      return b.refreshedAt.getTime() - a.refreshedAt.getTime()
    })
    const pageRows = combined.slice((page - 1) * pageSize, page * pageSize)
    return {
      items: pageRows.map(serializeListing),
      total: adjustedTotal,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(adjustedTotal / pageSize)),
    }
  }

  const [rows, total] = await Promise.all([
    db.listing.findMany({
      where,
      orderBy: [orderBy],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: SHOP_OWNER_INCLUDE,
    }),
    db.listing.count({ where }),
  ])

  const items = rows.map(serializeListing)
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) }
}

// Check a listing against a saved-search query (shared matching rules).
function listingMatchesQuery(listing: Listing, query: ListingQuery): boolean {
  if (query.type && listing.type !== query.type) return false
  if (query.category && listing.category !== query.category) return false
  if (query.county && listing.county !== query.county) return false
  if (query.unit && listing.unit !== query.unit) return false
  const intent = parseSearchIntent(query.q ?? '')
  if (intent.text) {
    const values = [listing.title, listing.description, listing.category, listing.area, listing.county]
    if (!getSearchTermGroups(query.q ?? '').every((group) => searchTextMatchesGroup(group, values, listing.category))) return false
  }
  const minPrice = query.minPrice === undefined ? intent.minPrice
    : intent.minPrice === undefined ? query.minPrice : Math.max(query.minPrice, intent.minPrice)
  const maxPrice = query.maxPrice === undefined ? intent.maxPrice
    : intent.maxPrice === undefined ? query.maxPrice : Math.min(query.maxPrice, intent.maxPrice)
  if (minPrice !== undefined && (listing.price === null || listing.price < minPrice)) return false
  if (maxPrice !== undefined && (listing.price === null || listing.price > maxPrice)) return false
  return true
}

// After a new listing is published, update every OTHER user's saved searches
// that match it and send real NEW_MATCH notifications with real counts.
export async function notifySavedSearchMatches(listing: Listing): Promise<void> {
  const searches = await db.savedSearch.findMany({
    where: { userId: { not: listing.userId } },
    include: { user: { select: { id: true } } },
  })
  for (const search of searches) {
    let parsed: ListingQuery
    try {
      parsed = JSON.parse(search.queryJson) as ListingQuery
    } catch {
      console.error(`[saved-search] corrupt queryJson for ${search.id}`)
      continue
    }
    if (!listingMatchesQuery(listing, parsed)) continue

    // Recompute the honest total of currently matching ACTIVE listings.
    const total = await db.listing.count({ where: { ...whereFromQuery(parsed), status: 'ACTIVE' } })
    await db.$transaction(async (tx) => {
      await tx.savedSearch.update({ where: { id: search.id }, data: { lastMatchCount: total, lastCheckedAt: new Date() } })
      await tx.notification.create({
        data: {
          userId: search.userId,
          type: 'NEW_MATCH',
          title: `New match for "${search.name}"`,
          body: `"${listing.title}" (${listing.county}) matches your saved search.`,
          listingId: listing.id,
        },
      })
    })
  }
}

function whereFromQuery(query: ListingQuery): Prisma.ListingWhereInput {
  const where: Prisma.ListingWhereInput = {}
  if (query.type) where.type = query.type
  if (query.category) where.category = query.category
  if (query.county) where.county = query.county
  if (query.unit) where.unit = query.unit
  const intent = parseSearchIntent(query.q ?? '')
  if (intent.text) where.AND = searchWhereGroups(query.q ?? '')
  const minPrice = query.minPrice === undefined ? intent.minPrice
    : intent.minPrice === undefined ? query.minPrice : Math.max(query.minPrice, intent.minPrice)
  const maxPrice = query.maxPrice === undefined ? intent.maxPrice
    : intent.maxPrice === undefined ? query.maxPrice : Math.min(query.maxPrice, intent.maxPrice)
  if (minPrice !== undefined || maxPrice !== undefined) {
    where.price = {
      ...(minPrice !== undefined ? { gte: minPrice } : {}),
      ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
    }
  }
  return where
}

// Refresh: bump refreshedAt, extend expiry. ACTIVE only, 24h cooldown.
export async function refreshListing(listing: Listing): Promise<Listing> {
  if (listing.status !== 'ACTIVE') {
    throw new ApiError(409, 'Only active listings can be refreshed. Repost it instead.')
  }
  const cooldownMs = REFRESH_COOLDOWN_HOURS * 60 * 60 * 1000
  const cooldownEnds = new Date(listing.refreshedAt.getTime() + cooldownMs)
  if (cooldownEnds.getTime() > Date.now()) {
    throw new ApiError(429, `You can refresh this listing again after ${cooldownEnds.toLocaleString('en-KE')}`)
  }

  const now = new Date()
  // Claim the refresh atomically. If two requests race, only one can move
  // refreshedAt past the old cooldown boundary; the other gets a controlled
  // cooldown/conflict response instead of Prisma P2025 or duplicate refreshes.
  const changed = await db.listing.updateMany({
    where: {
      id: listing.id,
      userId: listing.userId,
      status: 'ACTIVE',
      refreshedAt: { lte: new Date(now.getTime() - cooldownMs) },
    },
    data: { refreshedAt: now, expiresAt: addDays(now, LISTING_ACTIVE_DAYS), expiringNotifiedAt: null },
  })
  if (changed.count === 0) {
    const current = await getOwnedListingOr404(listing.id, listing.userId)
    if (current.status !== 'ACTIVE') {
      throw new ApiError(409, 'Only active listings can be refreshed. Repost it instead.')
    }
    const currentCooldownEnds = new Date(current.refreshedAt.getTime() + cooldownMs)
    if (currentCooldownEnds.getTime() > Date.now()) {
      throw new ApiError(429, `You can refresh this listing again after ${currentCooldownEnds.toLocaleString('en-KE')}`)
    }
    throw new ApiError(409, 'This listing changed while refreshing. Please try again.')
  }

  const updated = await db.listing.findFirst({ where: { id: listing.id, userId: listing.userId } })
  if (!updated) throw new ApiError(404, 'Listing not found')
  return updated
}

// Ownership is enforced here - callers pass the authenticated user's id.
export async function getOwnedListingOr404(id: string, userId: string): Promise<Listing> {
  const listing = await db.listing.findUnique({ where: { id } })
  if (!listing) throw new ApiError(404, 'Listing not found')
  if (listing.userId !== userId) {
    // Deliberately identical to 404: never confirm existence to non-owners.
    throw new ApiError(404, 'Listing not found')
  }
  return listing
}

