import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { productCollectionItemReorderSchema } from '@/lib/product-collections'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser()
    const { id: collectionId } = await context.params
    const { items } = await parseBody(request, productCollectionItemReorderSchema)
    const collection = await db.productCollection.findFirst({ where: { id: collectionId, userId: user.id }, select: { id: true } })
    if (!collection) throw new ApiError(404, 'Collection not found')
    const ids = items.map((item) => item.id)
    const ownedItems = await db.productCollectionItem.findMany({
      where: { collectionId, id: { in: ids }, listing: { is: { userId: user.id } } },
      select: { id: true },
    })
    if (ownedItems.length !== ids.length) throw new ApiError(404, 'One or more collection items were not found')
    await db.$transaction(items.map((item) => db.productCollectionItem.updateMany({
      where: { id: item.id, collectionId },
      data: { sortOrder: item.sortOrder },
    })))
    return jsonOk({ reordered: true })
  })
}
