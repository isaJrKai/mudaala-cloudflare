// Persistence for showrooms. Thin by design: every owner-scoped query carries
// `userId` in its WHERE clause (tests assert this), and the public read path
// mirrors the public collection page's visibility rules exactly.

import type { Prisma, PrismaClient } from '@prisma/client'
import { publicCollectionVisibilityWhere } from '@/lib/collection-visibility'
import type { ListingLike } from './products'
import type { ShowroomPurpose } from './types'

export type ShowroomDb = Pick<PrismaClient, 'listing' | 'productCollection' | 'productCollectionItem' | 'showroomPresentation'>

export interface ShowroomRow {
  id: string
  collectionId: string
  userId: string
  slug: string
  title: string
  introduction: string | null
  introSource: 'MERCHANT' | 'SUGGESTED'
  purpose: ShowroomPurpose
  styleKey: string | null
  highlights: string[]
  status: 'DRAFT' | 'PUBLISHED'
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  /** ordered by the seller's sequence */
  listingIds: string[]
}

export interface OwnedListingRow {
  id: string
  userId: string
  type: string
  status: string
  isSeed: boolean
  expiresAt: Date
}

export interface PublicListingRow extends ListingLike {
  userId: string
}

export interface PublicShowroomData {
  showroom: ShowroomRow
  shop: { id: string; name: string; area: string | null; county: string | null; shopCode: string | null; photoUrl: string | null; category: string | null }
  listings: ListingLike[]
}

export class SlugTakenError extends Error {
  constructor() { super('slug taken') }
}

export interface ShowroomPatch {
  title?: string
  introduction?: string | null
  introSource?: 'MERCHANT' | 'SUGGESTED'
  purpose?: ShowroomPurpose
  styleKey?: string | null
  highlights?: string[]
  listingIds?: string[]
  status?: 'DRAFT' | 'PUBLISHED'
  publishedAt?: Date | null
  isActive?: boolean
}

export interface ShowroomRepo {
  findListingsOwnedBy(userId: string, ids: string[]): Promise<OwnedListingRow[]>
  countShowrooms(userId: string): Promise<number>
  create(data: {
    userId: string; slug: string; title: string; introduction: string | null
    introSource: 'MERCHANT' | 'SUGGESTED'; purpose: ShowroomPurpose; styleKey: string | null
    highlights: string[]; listingIds: string[]
  }): Promise<ShowroomRow>
  findOwned(id: string, userId: string): Promise<ShowroomRow | null>
  listOwned(userId: string): Promise<ShowroomRow[]>
  update(id: string, userId: string, patch: ShowroomPatch): Promise<ShowroomRow | null>
  deleteOwned(id: string, userId: string): Promise<boolean>
  findPublishedBySlug(slug: string, now: Date): Promise<PublicShowroomData | null>
}

const SELECT = {
  id: true, collectionId: true, userId: true, slug: true, introduction: true, introSource: true,
  purpose: true, styleKey: true, highlights: true, status: true, publishedAt: true, createdAt: true, updatedAt: true,
  collection: { select: { title: true, items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { listingId: true } } } },
} satisfies Prisma.ShowroomPresentationSelect

type Row = Prisma.ShowroomPresentationGetPayload<{ select: typeof SELECT }>

function parseIds(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 10) : []
  } catch { return [] }
}

function toRow(r: Row): ShowroomRow {
  return {
    id: r.id, collectionId: r.collectionId, userId: r.userId, slug: r.slug,
    title: r.collection.title, introduction: r.introduction,
    introSource: r.introSource === 'SUGGESTED' ? 'SUGGESTED' : 'MERCHANT',
    purpose: r.purpose as ShowroomPurpose, styleKey: r.styleKey,
    highlights: parseIds(r.highlights),
    status: r.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
    publishedAt: r.publishedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
    listingIds: r.collection.items.map((i) => i.listingId),
  }
}

/** Listings a customer may see - identical to the public collection page's filter. */
export function publicListingWhere(ownerId: string, now: Date): Prisma.ListingWhereInput {
  return { userId: ownerId, status: 'ACTIVE', type: 'OFFER', isSeed: false, expiresAt: { gt: now } }
}

function isSlugConflict(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null
  if (!e || e.code !== 'P2002') return false
  const target = e.meta?.target
  return Array.isArray(target) ? target.includes('slug') : typeof target === 'string' ? target.includes('slug') : true
}

export function prismaShowroomRepo(db: ShowroomDb): ShowroomRepo {
  return {
    findListingsOwnedBy: (userId, ids) =>
      db.listing.findMany({
        where: { id: { in: ids }, userId },
        select: { id: true, userId: true, type: true, status: true, isSeed: true, expiresAt: true },
      }),

    countShowrooms: (userId) => db.showroomPresentation.count({ where: { userId } }),

    async create(data) {
      try {
        // One nested write = one atomic operation: collection + items + presentation.
        // The collection starts INACTIVE so a draft never leaks via /collections/{id}.
        const created = await db.productCollection.create({
          data: {
            userId: data.userId,
            title: data.title,
            description: null,
            isActive: false,
            items: { create: data.listingIds.map((listingId, i) => ({ listingId, sortOrder: i })) },
            showroom: {
              create: {
                userId: data.userId, slug: data.slug, introduction: data.introduction, introSource: data.introSource,
                purpose: data.purpose, styleKey: data.styleKey, highlights: JSON.stringify(data.highlights), status: 'DRAFT',
              },
            },
          },
          select: { showroom: { select: SELECT } },
        })
        return toRow(created.showroom!)
      } catch (err) {
        if (isSlugConflict(err)) throw new SlugTakenError()
        throw err
      }
    },

    async findOwned(id, userId) {
      const r = await db.showroomPresentation.findFirst({ where: { id, userId }, select: SELECT })
      return r ? toRow(r) : null
    },

    async listOwned(userId) {
      const rows = await db.showroomPresentation.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 100, select: SELECT })
      return rows.map(toRow)
    },

    async update(id, userId, patch) {
      const current = await db.showroomPresentation.findFirst({ where: { id, userId }, select: { id: true, collectionId: true } })
      if (!current) return null
      const showroomData: Prisma.ShowroomPresentationUpdateWithoutCollectionInput = {
        ...(patch.introduction !== undefined ? { introduction: patch.introduction } : {}),
        ...(patch.introSource !== undefined ? { introSource: patch.introSource } : {}),
        ...(patch.purpose !== undefined ? { purpose: patch.purpose } : {}),
        ...(patch.styleKey !== undefined ? { styleKey: patch.styleKey } : {}),
        ...(patch.highlights !== undefined ? { highlights: JSON.stringify(patch.highlights) } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.publishedAt !== undefined ? { publishedAt: patch.publishedAt } : {}),
      }
      await db.productCollection.update({
        where: { id: current.collectionId, userId },
        data: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
          ...(patch.listingIds !== undefined
            ? { items: { deleteMany: {}, create: patch.listingIds.map((listingId, i) => ({ listingId, sortOrder: i })) } }
            : {}),
          ...(Object.keys(showroomData).length > 0 ? { showroom: { update: showroomData } } : {}),
        },
      })
      const fresh = await db.showroomPresentation.findFirst({ where: { id, userId }, select: SELECT })
      return fresh ? toRow(fresh) : null
    },

    async deleteOwned(id, userId) {
      const current = await db.showroomPresentation.findFirst({ where: { id, userId }, select: { collectionId: true } })
      if (!current) return false
      // Deleting the collection cascades to the presentation and item links.
      // Listings themselves are never touched.
      const res = await db.productCollection.deleteMany({ where: { id: current.collectionId, userId } })
      return res.count > 0
    },

    async findPublishedBySlug(slug, now) {
      const r = await db.showroomPresentation.findFirst({
        where: { slug, status: 'PUBLISHED', collection: { is: publicCollectionVisibilityWhere(now) } },
        select: {
          ...SELECT,
          user: { select: { id: true, name: true, profile: { select: { businessName: true, photoUrl: true, area: true, county: true, shopCode: true, category: true } } } },
        },
      })
      if (!r) return null
      const items = await db.productCollectionItem.findMany({
        where: { collectionId: r.collectionId, listing: { is: publicListingWhere(r.userId, now) } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: 100,
        select: {
          listing: {
            select: {
              id: true, title: true, description: true, category: true, taxonomyId: true, brand: true, model: true,
              attributes: true, price: true, compareAtPrice: true, currency: true, unit: true, priceNegotiable: true,
              photos: true, availabilityStatus: true, publishedAt: true,
            },
          },
        },
      })
      const { user, ...own } = r
      return {
        showroom: toRow(own as Row),
        shop: {
          id: user.id,
          name: user.profile?.businessName?.trim() || user.name,
          area: user.profile?.area ?? null,
          county: user.profile?.county ?? null,
          shopCode: user.profile?.shopCode ?? null,
          photoUrl: user.profile?.photoUrl ?? null,
          category: user.profile?.category ?? null,
        },
        listings: items.map((i) => i.listing),
      }
    },
  }
}
