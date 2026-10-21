import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { productCollectionItemUpdateSchema } from '@/lib/product-collections'

type Context = { params: Promise<{ id: string; itemId: string }> }

export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser()
    const { id: collectionId, itemId } = await context.params
    const data = await parseBody(request, productCollectionItemUpdateSchema)
    const collection = await db.productCollection.findFirst({ where: { id: collectionId, userId: user.id }, select: { id: true } })
    if (!collection) throw new ApiError(404, 'Collection not found')
    const updated = await db.productCollectionItem.updateMany({
      where: { id: itemId, collectionId, listing: { is: { userId: user.id } } },
      data: { sortOrder: data.sortOrder },
    })
    if (updated.count === 0) throw new ApiError(404, 'Collection item not found')
    const item = await db.productCollectionItem.findFirst({ where: { id: itemId, collectionId, listing: { is: { userId: user.id } } }, select: { id: true, collectionId: true, listingId: true, sortOrder: true, createdAt: true } })
    if (!item) throw new ApiError(404, 'Collection item not found')
    return jsonOk({ item })
  })
}

export async function DELETE(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser()
    const { id: collectionId, itemId } = await context.params
    const collection = await db.productCollection.findFirst({ where: { id: collectionId, userId: user.id }, select: { id: true } })
    if (!collection) throw new ApiError(404, 'Collection not found')
    const deleted = await db.productCollectionItem.deleteMany({ where: { id: itemId, collectionId, listing: { is: { userId: user.id } } } })
    if (deleted.count === 0) throw new ApiError(404, 'Collection item not found')
    return jsonOk({ deleted: true })
  })
}
