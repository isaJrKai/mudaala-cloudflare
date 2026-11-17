import { db } from '@/lib/db'
import { ApiError, jsonOk, parseBody, requireSeller, route as apiRoute } from '@/lib/api'
import { standaloneShowroomPatchSchema } from '@/lib/showroom/standalone-schema'

type Params = { params: Promise<{ id: string }> }

function serialize(row: {
  id: string; slug: string; templateId: string; templateVersion: number; title: string
  headline: string | null; introduction: string | null; story: string | null
  logoUrl: string | null; primaryColor: string | null; accentColor: string | null
  coverPhotoUrl: string | null; photos: string; content: string; listingIds: string
  status: string; publishedAt: Date | null; updatedAt: Date
}) {
  const read = <T,>(value: string, fallback: T): T => {
    try { return JSON.parse(value) as T } catch { return fallback }
  }
  return {
    id: row.id, slug: row.slug, templateId: row.templateId, templateVersion: row.templateVersion,
    title: row.title, headline: row.headline, introduction: row.introduction, story: row.story,
    logoUrl: row.logoUrl, primaryColor: row.primaryColor, accentColor: row.accentColor,
    coverPhotoUrl: row.coverPhotoUrl, photos: read<string[]>(row.photos, []),
    sections: read<unknown[]>(row.content, []), listingIds: read<string[]>(row.listingIds, []),
    status: row.status, publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function PATCH(request: Request, { params }: Params) {
  return apiRoute(async () => {
    const { id } = await params
    const user = await requireSeller('Sign in as the shop owner to edit this showroom')
    const current = await db.shopShowroom.findFirst({ where: { id, userId: user.id } })
    if (!current) throw new ApiError(404, 'Showroom not found')
    const data = await parseBody(request, standaloneShowroomPatchSchema)

    const nextPhotos = data.photos ?? JSON.parse(current.photos) as string[]
    const nextCover = data.coverPhotoUrl === undefined ? current.coverPhotoUrl : data.coverPhotoUrl
    if (data.status === 'PUBLISHED' && !nextCover && nextPhotos.length === 0) {
      throw new ApiError(409, 'Add at least one of your own showroom photos before publishing.')
    }

    if (data.listingIds) {
      const owned = await db.listing.findMany({
        where: { id: { in: data.listingIds }, userId: user.id, type: 'OFFER', isSeed: false },
        select: { id: true },
      })
      if (owned.length !== data.listingIds.length) throw new ApiError(400, 'Only products from your own shop can be linked.')
    }

    const updated = await db.shopShowroom.update({
      where: { id: current.id },
      data: {
        ...(data.templateId !== undefined ? { templateId: data.templateId, templateVersion: 1 } : {}),
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.headline !== undefined ? { headline: data.headline } : {}),
        ...(data.introduction !== undefined ? { introduction: data.introduction } : {}),
        ...(data.story !== undefined ? { story: data.story } : {}),
        ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
        ...(data.primaryColor !== undefined ? { primaryColor: data.primaryColor } : {}),
        ...(data.accentColor !== undefined ? { accentColor: data.accentColor } : {}),
        ...(data.coverPhotoUrl !== undefined ? { coverPhotoUrl: data.coverPhotoUrl } : {}),
        ...(data.photos !== undefined ? { photos: JSON.stringify(data.photos) } : {}),
        ...(data.sections !== undefined ? { content: JSON.stringify(data.sections) } : {}),
        ...(data.listingIds !== undefined ? { listingIds: JSON.stringify(data.listingIds) } : {}),
        ...(data.status !== undefined ? {
          status: data.status,
          publishedAt: data.status === 'PUBLISHED' ? current.publishedAt ?? new Date() : null,
        } : {}),
      },
    })
    return jsonOk({ showroom: serialize(updated) })
  })
}

export async function DELETE(_request: Request, { params }: Params) {
  return apiRoute(async () => {
    const { id } = await params
    const user = await requireSeller('Sign in as the shop owner to delete this showroom')
    const deleted = await db.shopShowroom.deleteMany({ where: { id, userId: user.id } })
    if (!deleted.count) throw new ApiError(404, 'Showroom not found')
    return jsonOk({ deleted: true })
  })
}
