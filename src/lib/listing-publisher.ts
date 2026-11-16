// Shared, validated listing publication boundary for web and trusted server integrations.
// Callers must establish the seller identity; this service never accepts a client-supplied userId.
import { ApiError } from '@/lib/api'
import { hit, PUBLISH_DAY_MAX, PUBLISH_WINDOW_MS } from '@/lib/rate-limit'
import { listingCreateSchema, normalizePhone, type CountryKey } from '@/lib/validation'
import { db } from '@/lib/db'
import { notifySavedSearchMatches, sanitizePhotos } from '@/lib/listings'
import { LISTING_ACTIVE_DAYS, countryDef, currencyDef, findProhibitedItem } from '@/lib/constants'
import type { z } from 'zod'

export type ListingPublishInput = z.infer<typeof listingCreateSchema>
export type ListingPublisher = { id: string; country?: string | null }

export async function publishListingForSeller(input: {
  seller: ListingPublisher
  data: ListingPublishInput
  ipKey: string
}) {
  const { seller, data } = input

  const ipVerdict = await hit(`publish:ip:${input.ipKey}`, PUBLISH_DAY_MAX, PUBLISH_WINDOW_MS)
  if (!ipVerdict.ok) throw new ApiError(429, 'You have published a lot today - please continue tomorrow')
  const verdict = await hit(`publish:user:${seller.id}`, PUBLISH_DAY_MAX, PUBLISH_WINDOW_MS)
  if (!verdict.ok) throw new ApiError(429, 'You have published a lot today - please continue tomorrow')

  const banned = findProhibitedItem(data.title, data.description ?? '')
  if (banned) {
    throw new ApiError(400, banned.message, {
      title: 'This listing cannot be published - ' + banned.label.toLowerCase(),
    })
  }

  const country = (data.country ?? seller.country ?? 'UG') as CountryKey
  const currency = data.currency ?? currencyDef(country).key
  const contactPhone = normalizePhone(data.contactPhone, country)
  if (!contactPhone) {
    throw new ApiError(400, 'Enter a valid phone number for the selected country', {
      contactPhone: 'Invalid phone number for the selected country',
    })
  }
  const contactWhatsapp = data.contactWhatsapp ? normalizePhone(data.contactWhatsapp, country) : null
  if (data.contactWhatsapp && !contactWhatsapp) {
    throw new ApiError(400, 'Enter a valid WhatsApp number for the selected country', {
      contactWhatsapp: 'Invalid WhatsApp number for the selected country',
    })
  }
  const def = countryDef(country)
  if (!def.locations.includes(data.county)) {
    throw new ApiError(400, `Choose a district or region in ${def.name}`, {
      county: `Choose a district or region in ${def.name}`,
    })
  }

  const now = new Date()
  const photos = sanitizePhotos(data.photos)
  const listing = await db.listing.create({
    data: {
      userId: seller.id,
      type: data.type,
      title: data.title,
      description: data.description,
      category: data.category,
      price: data.price,
      compareAtPrice: data.compareAtPrice ?? null,
      currency,
      priceNegotiable: data.priceNegotiable,
      unit: data.unit,
      quantity: data.quantity,
      county: data.county,
      country,
      area: data.area,
      contactPhone,
      contactWhatsapp,
      photos: JSON.stringify(photos),
      status: 'ACTIVE',
      publishedAt: now,
      refreshedAt: now,
      expiresAt: new Date(now.getTime() + LISTING_ACTIVE_DAYS * 24 * 60 * 60 * 1000),
    },
  })

  const growthEvents = [{ userId: seller.id, eventType: 'PRODUCT_CREATED', entityId: listing.id, idempotencyKey: `product-created:${listing.id}` }]
  if (photos.length > 0) growthEvents.push({ userId: seller.id, eventType: 'PRODUCT_PHOTO_ADDED', entityId: listing.id, idempotencyKey: `product-photo-added:${listing.id}` })
  await db.merchantGrowthEvent.createMany({ data: growthEvents, skipDuplicates: true }).catch((err) =>
    console.error('[growth-coach] product event recording failed:', err),
  )
  await notifySavedSearchMatches(listing).catch((err) =>
    console.error('[listings] saved-search match failed:', err),
  )
  return listing
}
