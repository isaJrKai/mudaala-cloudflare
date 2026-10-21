import { route, jsonOk, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { SHOP_OWNER_INCLUDE, serializeListing } from '@/lib/listings'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  return route(async () => {
    const { id } = await context.params
    const collection = await db.productCollection.findFirst({
      where: { id, isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }] },
      select: {
        id: true,
        userId: true,
        title: true,
        description: true,
        coverPhotoUrl: true,
        startsAt: true,
        endsAt: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            country: true,
            profile: { select: { businessName: true, photoUrl: true, area: true, county: true } },
          },
        },
      },
    })
    if (!collection) throw new ApiError(404, 'This collection is not available')
    const items = await db.productCollectionItem.findMany({
      where: {
        collectionId: id,
        listing: {
          is: {
            userId: collection.userId,
            status: 'ACTIVE',
            type: 'OFFER',
            isSeed: false,
            expiresAt: { gt: new Date() },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { listing: { include: SHOP_OWNER_INCLUDE } },
    })
    const { user, userId, ...publicCollection } = collection
    return jsonOk({
      collection: publicCollection,
      shop: {
        id: user.id,
        name: user.profile?.businessName?.trim() || user.name,
        photoUrl: user.profile?.photoUrl ?? null,
        area: user.profile?.area ?? null,
        county: user.profile?.county ?? null,
        country: user.country ?? 'UG',
      },
      items: items.map((item) => ({ ...item, listing: serializeListing(item.listing) })),
    })
  })
}
