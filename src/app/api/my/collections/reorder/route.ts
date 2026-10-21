import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { productCollectionReorderSchema } from '@/lib/product-collections'

export async function PATCH(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const { items } = await parseBody(request, productCollectionReorderSchema)
    const ids = items.map((item) => item.id)
    const owned = await db.productCollection.findMany({
      where: { userId: user.id, id: { in: ids } },
      select: { id: true },
    })
    if (owned.length !== ids.length) throw new ApiError(404, 'One or more collections were not found')
    await db.$transaction(items.map((item) => db.productCollection.updateMany({
      where: { id: item.id, userId: user.id },
      data: { sortOrder: item.sortOrder },
    })))
    return jsonOk({ reordered: true })
  })
}
