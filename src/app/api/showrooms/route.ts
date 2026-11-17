import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { ApiError, jsonOk, parseBody, requireSeller, route as apiRoute } from '@/lib/api'
import { standaloneShowroomSchema } from '@/lib/showroom/standalone-schema'
import { findProhibitedItem } from '@/lib/constants'
import { containsMarketplaceEmoji } from '@/lib/validation'
import { assertUploadedShowroomPhotos } from '@/lib/showroom/photo-urls'

function slugBase(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'shop'
}

function serialize(row: {
  id: string; slug: string; templateId: string; templateVersion: number; title: string
  headline: string | null; introduction: string | null; story: string | null
  logoUrl: string | null; primaryColor: string | null; accentColor: string | null
  coverPhotoUrl: string | null; photos: string; content: string; listingIds: string
  status: string; publishedAt: Date | null; updatedAt: Date
}) {
  let photos: string[] = []
  let sections: unknown[] = []
  let listingIds: string[] = []
  try { photos = JSON.parse(row.photos) } catch { /* legacy empty value */ }
  try { sections = JSON.parse(row.content) } catch { /* legacy empty value */ }
  try { listingIds = JSON.parse(row.listingIds) } catch { /* legacy empty value */ }
  return { ...row, photos, sections, listingIds, publishedAt: row.publishedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString(), content: undefined }
}

export async function GET() {
  return apiRoute(async () => {
    const user = await requireSeller()
    const rows = await db.shopShowroom.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    })
    return jsonOk({ showrooms: rows.map(serialize) })
  })
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const user = await requireSeller('Sign in as the shop owner to create a showroom')
    const data = await parseBody(request, standaloneShowroomSchema)
    if (containsMarketplaceEmoji(data.title)) throw new ApiError(400, 'Please use words in the showroom title, not emojis.')
    const copy = [data.headline, data.introduction, data.story, ...data.sections.map((section) => section.heading || ''), ...data.sections.map((section) => section.body || '')].filter(Boolean).join(' ')
    if (containsMarketplaceEmoji(copy)) throw new ApiError(400, 'Please use words in your showroom copy, not emojis.')
    const prohibited = findProhibitedItem(data.title, copy)
    if (prohibited) throw new ApiError(400, prohibited.message, { title: `This showroom cannot be published - ${prohibited.label.toLowerCase()}` })
    assertUploadedShowroomPhotos([data.logoUrl, data.coverPhotoUrl, ...data.photos, ...data.sections.map((section) => section.photoUrl)])
    const profile = await db.businessProfile.findUnique({
      where: { userId: user.id },
      select: { businessName: true },
    })
    if (!profile) throw new ApiError(409, 'Set up your shop profile before creating its showroom.')

    if (data.status === 'PUBLISHED' && !data.coverPhotoUrl && data.photos.length === 0) {
      throw new ApiError(409, 'Add at least one of your own showroom photos before publishing.')
    }
    if (data.listingIds.length) {
      const owned = await db.listing.findMany({
        where: { id: { in: data.listingIds }, userId: user.id, type: 'OFFER', isSeed: false },
        select: { id: true },
      })
      if (owned.length !== data.listingIds.length) {
        throw new ApiError(400, 'Only products from your own shop can be linked.')
      }
    }

    const base = slugBase(data.title)
    let created: Awaited<ReturnType<typeof db.shopShowroom.create>> | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = `${base}-${randomBytes(3).toString('hex')}`
      try {
        created = await db.shopShowroom.create({
          data: {
            userId: user.id,
            slug,
            templateId: data.templateId,
            templateVersion: 1,
            title: data.title,
            headline: data.headline ?? null,
            introduction: data.introduction ?? null,
            story: data.story ?? null,
            logoUrl: data.logoUrl ?? null,
            primaryColor: data.primaryColor ?? null,
            accentColor: data.accentColor ?? null,
            coverPhotoUrl: data.coverPhotoUrl ?? null,
            photos: JSON.stringify(data.photos),
            content: JSON.stringify(data.sections),
            listingIds: JSON.stringify(data.listingIds),
            status: data.status ?? 'DRAFT',
            publishedAt: data.status === 'PUBLISHED' ? new Date() : null,
          },
        })
        break
      } catch (error) {
        if ((error as { code?: string })?.code !== 'P2002') throw error
      }
    }
    if (!created) throw new ApiError(409, 'Could not create a unique showroom address. Please try again.')
    return jsonOk({ showroom: serialize(created) }, 201)
  })
}
