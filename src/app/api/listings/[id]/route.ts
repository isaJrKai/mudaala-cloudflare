import { NextRequest } from 'next/server'
import { route, jsonOk, requireUser, ApiError } from '@/lib/api'
import { listingUpdateSchema, listingStatusSchema, isTransitionAllowed, fieldErrors, listingNeedsUnit, normalizePhone, type CountryKey } from '@/lib/validation'
import { db } from '@/lib/db'
import { expireOverdueListings, getOwnedListingOr404, sanitizePhotos, serializeListing } from '@/lib/listings'
import { LISTING_ACTIVE_DAYS, countryDef, findProhibitedItem } from '@/lib/constants'
import { getSessionUser } from '@/lib/auth'
import { isAdminUser } from '@/lib/admin'
type Params = { params: Promise<{ id: string }> }

// Public detail view. Also expires overdue listings so status is always truthful.
export async function GET(_request: NextRequest, { params }: Params) {
  return route(async () => {
    const { id } = await params
    await expireOverdueListings()

    const listing = await db.listing.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            createdAt: true,
            profile: {
              select: {
                businessName: true,
                photoUrl: true,
                area: true,
                county: true,
                description: true,
                hours: true,
              },
            },
          },
        },
      },
    })
    if (!listing) throw new ApiError(404, 'This listing does not exist or has been removed')

    // Moderation: a HIDDEN listing is invisible to everyone except its owner
    // (checking their appeal) and an admin (reviewing reports). The response
    // is the same 404 as a missing ad - moderation state is never leaked.
    if (listing.status === 'HIDDEN') {
      const viewer = await getSessionUser()
      const privileged = viewer && (viewer.id === listing.userId || isAdminUser(viewer))
      if (!privileged) throw new ApiError(404, 'This listing does not exist or has been removed')
    }

    // Fire-and-forget view counter; failures never break the response.
    db.listing.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => undefined)

    // Return only the public seller identity fields needed by the listing page.
    // Do not spread the full User or BusinessProfile rows into a public response:
    // that would expose internal flags, legal-acceptance metadata, and private contact fields.
    return jsonOk({ listing: { ...serializeListing(listing), user: listing.user } })
  })
}

// Edit (owner only). Status can only change through an explicitly allowed
// transition - a fulfilled listing never silently becomes active again.
export async function PATCH(request: NextRequest, { params }: Params) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await params
    const listing = await getOwnedListingOr404(id, user.id)

    // Read the body exactly once - a Request stream cannot be consumed twice.
    const body = await request.json().catch(() => {
      throw new ApiError(400, 'Request body must be valid JSON')
    })

    // Two shapes are accepted: field edits, or a deliberate status change.
    const hasStatusOnly = typeof body === 'object' && body !== null && 'status' in body && Object.keys(body).length === 1
    if (hasStatusOnly) {
      const data = parseStatus(body)
      if (!isTransitionAllowed(listing.status, data.status)) {
        throw new ApiError(409, `Cannot change a ${listing.status.toLowerCase()} listing to ${data.status.toLowerCase()}`)
      }
      // Reposting (EXPIRED/ARCHIVED → ACTIVE) is a deliberate act: it restarts
      // freshness and expiry. FULFILLED → ACTIVE never touches timestamps.
      const now = new Date()
      const repost = data.status === 'ACTIVE' && (listing.status === 'EXPIRED' || listing.status === 'ARCHIVED')
      const changed = await db.listing.updateMany({
        where: { id, userId: user.id, status: listing.status, updatedAt: listing.updatedAt },
        data: {
          status: data.status,
          ...(repost
            ? {
                refreshedAt: now,
                expiresAt: new Date(now.getTime() + LISTING_ACTIVE_DAYS * 24 * 60 * 60 * 1000),
                expiringNotifiedAt: null,
              }
            : {}),
        },
      })
      if (changed.count === 0) {
        await getOwnedListingOr404(id, user.id)
        throw new ApiError(409, 'This listing changed while you were editing. Reload and try again.')
      }
      const updated = await db.listing.findFirst({ where: { id, userId: user.id } })
      if (!updated) throw new ApiError(404, 'Listing not found')
      return jsonOk({ listing: updated })
    }

    const parsed = listingUpdateSchema.safeParse(body)
    if (!parsed.success) {
      throw new ApiError(400, 'Please fix the highlighted fields', fieldErrors(parsed.error))
    }
    const data = parsed.data

    // Field edits on a non-active listing would risk contradictory state -
    // the UI asks the owner to reactivate first.
    if (listing.status !== 'ACTIVE') {
      throw new ApiError(409, `This listing is ${listing.status.toLowerCase()}. Reactivate it before editing.`)
    }

    // Country changes re-normalize contact numbers and validate the location.
    const country = (data.country ?? listing.country) as CountryKey
    const def = countryDef(country)
    const county = data.county ?? listing.county
    if (!def.locations.includes(county)) {
      throw new ApiError(400, `Choose a district or region in ${def.name}`, {
        county: `Choose a district or region in ${def.name}`,
      })
    }

    // Prohibited items: edits get the same filter as publishing (an edit must
    // not become the loophole around the publish-time rejection).
    const banned = findProhibitedItem(
      data.title ?? listing.title,
      data.description ?? listing.description,
    )
    if (banned) {
      throw new ApiError(400, banned.message, {
        title: 'This listing cannot be published - ' + banned.label.toLowerCase(),
      })
    }
    const rawContactPhone = data.contactPhone ?? listing.contactPhone
    const contactPhone = normalizePhone(rawContactPhone, country)
    if (!contactPhone) {
      throw new ApiError(400, 'Enter a valid phone number for the selected country', {
        contactPhone: 'Invalid phone number for the selected country',
      })
    }
    const rawWhatsapp = 'contactWhatsapp' in data ? data.contactWhatsapp : listing.contactWhatsapp
    const contactWhatsapp = rawWhatsapp ? normalizePhone(rawWhatsapp, country) : null
    if (rawWhatsapp && !contactWhatsapp) {
      throw new ApiError(400, 'Enter a valid WhatsApp number for the selected country', {
        contactWhatsapp: 'Invalid WhatsApp number for the selected country',
      })
    }

    const merged = {
      title: data.title ?? listing.title,
      description: data.description ?? listing.description,
      category: data.category ?? listing.category,
      price: 'price' in data && data.price !== undefined ? data.price : listing.price,
      compareAtPrice: 'compareAtPrice' in data ? (data.compareAtPrice ?? null) : listing.compareAtPrice,
      currency: data.currency ?? listing.currency,
      priceNegotiable: data.priceNegotiable ?? listing.priceNegotiable,
      unit: 'unit' in data ? data.unit : listing.unit,
      quantity: 'quantity' in data ? data.quantity : listing.quantity,
      county,
      country,
      area: 'area' in data ? data.area : listing.area,
      contactPhone,
      contactWhatsapp,
      photos: 'photos' in data ? JSON.stringify(sanitizePhotos(data.photos)) : listing.photos,
    }

    if (merged.price === null && !merged.priceNegotiable) {
      throw new ApiError(400, 'Enter a price or mark it as negotiable', { price: 'Enter a price or mark it as negotiable' })
    }
    if (listingNeedsUnit(merged.category, merged.price) && merged.unit === null) {
      throw new ApiError(400, 'Choose the unit the price refers to', { unit: 'Choose the unit the price refers to' })
    }
    // Discount rules against the merged record (partials cannot be judged alone).
    if (merged.compareAtPrice !== null && merged.price === null) {
      throw new ApiError(400, 'Add the current price first - the old price only shows as a discount next to it', {
        compareAtPrice: 'Add the current price first - the old price only shows as a discount next to it',
      })
    }
    if (merged.compareAtPrice !== null && merged.price !== null && merged.compareAtPrice <= merged.price) {
      throw new ApiError(400, 'The old price must be higher than the current price', {
        compareAtPrice: 'The old price must be higher than the current price',
      })
    }

    const changed = await db.listing.updateMany({
      where: { id, userId: user.id, status: 'ACTIVE', updatedAt: listing.updatedAt },
      data: { ...merged },
    })
    if (changed.count === 0) {
      const current = await getOwnedListingOr404(id, user.id)
      if (current.status !== 'ACTIVE') {
        throw new ApiError(409, `This listing is ${current.status.toLowerCase()}. Reactivate it before editing.`)
      }
      throw new ApiError(409, 'This listing changed while you were editing. Reload and try again.')
    }
    const updated = await db.listing.findFirst({ where: { id, userId: user.id } })
    if (!updated) throw new ApiError(404, 'Listing not found')
    return jsonOk({ listing: serializeListing(updated) })
  })
}

// Delete (owner only).
export async function DELETE(_request: NextRequest, { params }: Params) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await params
    // Owner-scoped atomic delete avoids a check-then-delete race: duplicate
    // clicks or overlapping tabs should get one success and then a 404, not 503.
    const removed = await db.listing.deleteMany({ where: { id, userId: user.id } })
    if (removed.count === 0) throw new ApiError(404, 'Listing not found')
    return jsonOk({ ok: true })
  })
}

function parseStatus(body: unknown): { status: string } {
  const result = listingStatusSchema.safeParse(body)
  if (!result.success) throw new ApiError(400, 'Invalid status value')
  return result.data
}
