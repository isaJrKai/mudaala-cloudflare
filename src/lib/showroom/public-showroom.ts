// Public showroom loader (Phase D, Commerce Spine).
//
// One implementation of the public payload serves BOTH consumers: the
// /api/showrooms/public/[slug] route and the /showroom/[slug] server page,
// which passes it to the client component as initial data. Before this, the
// route held the only real copy and the SSR page shipped crawlers an empty
// shell that hydrated from a second fetch of the same data.
//
// Visibility rules are unchanged and deliberately strict: PUBLISHED +
// publishedAt reached + moderation-ACTIVE owner + non-seed ACTIVE OFFER
// listings that have not expired. Nothing unpublished ever leaks.

import { db } from '@/lib/db'
import { publicShopOwnerWhere } from '@/lib/shop-visibility'
import type { BusinessProfile } from '@prisma/client'

export interface PublicShowroomProduct {
  id: string; title: string; description: string; category: string; brand: string | null
  model: string | null; price: number | null; compareAtPrice: number | null; currency: string
  priceNegotiable: boolean; availabilityStatus: string; photos: string[]
  publishedAt: string
}

export interface PublicShowroomSection { heading?: string; body?: string; photoUrl?: string | null }

export interface PublicShowroomPayload {
  showroom: {
    id: string; slug: string; templateId: string; templateVersion: number; title: string
    headline: string | null; introduction: string | null; story: string | null
    logoUrl: string | null; primaryColor: string | null; accentColor: string | null
    coverPhotoUrl: string | null; photos: string[]; sections: PublicShowroomSection[]
    publishedAt: string | null
  }
  shop: {
    id: string; name: string; logoUrl: string | null; coverPhotoUrl: string | null
    category: string | null; description: string | null; area: string | null
    county: string | null; hours: string | null; shopCode: string | null; websiteUrl: string | null
  }
  products: PublicShowroomProduct[]
}

function readArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

function readSections(value: string): PublicShowroomSection[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as PublicShowroomSection[] : []
  } catch { return [] }
}

export async function loadPublicShowroom(slug: string, options: { previewForUserId?: string } = {}): Promise<PublicShowroomPayload | null> {
  const now = new Date()
  const previewing = options.previewForUserId !== undefined
  const showroom = await db.shopShowroom.findFirst({
    where: previewing
      ? { slug, userId: options.previewForUserId }
      : { slug, status: 'PUBLISHED', publishedAt: { lte: now }, user: { is: publicShopOwnerWhere } },
    include: {
      user: {
        select: {
          id: true,
          profile: true,
        },
      },
    },
  })
  const profile = showroom?.user.profile as BusinessProfile | null | undefined
  if (!showroom || !profile) return null
  // A preview may show an unpublished/unmoderated showroom to its owner only;
  // the public path requires an ACTIVE moderation status.
  if (!previewing && profile.moderationStatus !== 'ACTIVE') return null

  const listingIds = readArray(showroom.listingIds).slice(0, 60)
  const listings = listingIds.length ? await db.listing.findMany({
    where: {
      id: { in: listingIds },
      userId: showroom.userId,
      type: 'OFFER',
      status: 'ACTIVE',
      isSeed: false,
      expiresAt: { gt: now },
    },
    select: {
      id: true, title: true, description: true, category: true, brand: true, model: true,
      price: true, compareAtPrice: true, currency: true, priceNegotiable: true,
      availabilityStatus: true, photos: true, publishedAt: true,
    },
  }) : []

  const byId = new Map(listings.map((listing) => [listing.id, listing]))
  const orderedListings: PublicShowroomProduct[] = listingIds.flatMap((id) => {
    const listing = byId.get(id)
    if (!listing) return []
    return [{
      ...listing,
      photos: readArray(listing.photos).slice(0, 4),
      publishedAt: listing.publishedAt.toISOString(),
    }]
  })

  return {
    showroom: {
      id: showroom.id, slug: showroom.slug, templateId: showroom.templateId,
      templateVersion: showroom.templateVersion, title: showroom.title,
      headline: showroom.headline, introduction: showroom.introduction, story: showroom.story,
      logoUrl: showroom.logoUrl, primaryColor: showroom.primaryColor, accentColor: showroom.accentColor,
      coverPhotoUrl: showroom.coverPhotoUrl, photos: readArray(showroom.photos),
      sections: readSections(showroom.content),
      publishedAt: showroom.publishedAt?.toISOString() ?? null,
    },
    shop: {
      id: showroom.user.id,
      name: profile.businessName,
      logoUrl: profile.photoUrl,
      coverPhotoUrl: profile.coverPhotoUrl,
      category: profile.category,
      description: profile.description,
      area: profile.area,
      county: profile.county,
      hours: profile.hours,
      shopCode: profile.shopCode,
      websiteUrl: profile.websiteUrl,
    },
    products: orderedListings,
  }
}
