import { route, jsonOk, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { publicCollectionVisibilityWhere } from '@/lib/collection-visibility'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  return route(async () => {
    const { id: shopId } = await context.params
    const shop = await db.user.findUnique({ where: { id: shopId }, select: { id: true } })
    if (!shop) throw new ApiError(404, 'This shop does not exist')
    const now = new Date()
    const collections = await db.productCollection.findMany({
      where: { userId: shopId, ...publicCollectionVisibilityWhere(now) }
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        items: {
          where: {
            listing: {
              is: { userId: shopId, status: 'ACTIVE', type: 'OFFER', isSeed: false, expiresAt: { gt: now } },
            },
          },
          select: { id: true, listing: { select: { photos: true } } },
        },
      },
    })
    return jsonOk({
      collections: collections.map(({ items, ...collection }) => ({
        id: collection.id,
        title: collection.title,
        description: collection.description,
        coverPhotoUrl: collection.coverPhotoUrl,
        sortOrder: collection.sortOrder,
        itemCount: items.length,
        coverImages: items.flatMap((item) => { try { const photos = JSON.parse(item.listing.photos) as unknown; return Array.isArray(photos) ? photos.filter((photo): photo is string => typeof photo === 'string' && photo.length > 0) : [] } catch { return [] } }).slice(0, 4),
      })),
    })
  })
}
