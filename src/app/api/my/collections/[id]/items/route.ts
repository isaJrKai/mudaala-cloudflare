import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { SHOP_OWNER_INCLUDE, serializeListing } from '@/lib/listings'
import { productCollectionItemCreateSchema } from '@/lib/product-collections'

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser()
    const { id: collectionId } = await context.params
    const data = await parseBody(request, productCollectionItemCreateSchema)
    const collection = await db.productCollection.findFirst({ where: { id: collectionId, userId: user.id }, select: { id: true } })
    if (!collection) throw new ApiError(404, 'Collection not found')

    const listing = await db.listing.findFirst({
      where: {
        id: data.listingId,
        userId: user.id,
        status: 'ACTIVE',
        type: 'OFFER',
        isSeed: false,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    })
    if (!listing) throw new ApiError(404, 'Only your own active offer listings can be added to a collection')

    const sortOrder = data.sortOrder ?? await db.productCollectionItem.count({ where: { collectionId } })
    try {
      const item = await db.productCollectionItem.create({
        data: { collectionId, listingId: listing.id, sortOrder },
        include: { listing: { include: SHOP_OWNER_INCLUDE } },
      })
      return jsonOk({ item: { ...item, listing: serializeListing(item.listing) } }, 201)
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new ApiError(409, 'That listing is already in this collection')
      }
      throw error
    }
  })
}
