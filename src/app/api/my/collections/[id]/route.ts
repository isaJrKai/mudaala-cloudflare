import { route, jsonOk, requireUser, parseBody, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { productCollectionUpdateSchema } from '@/lib/product-collections'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await context.params
    const data = await parseBody(request, productCollectionUpdateSchema)
    const updated = await db.productCollection.updateMany({
      where: { id, userId: user.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        ...(data.coverPhotoUrl !== undefined ? { coverPhotoUrl: data.coverPhotoUrl } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    })
    if (updated.count === 0) throw new ApiError(404, 'Collection not found')
    const collection = await db.productCollection.findFirst({ where: { id, userId: user.id } })
    if (!collection) throw new ApiError(404, 'Collection not found')
    return jsonOk({ collection })
  })
}

export async function DELETE(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await context.params
    const deleted = await db.productCollection.deleteMany({ where: { id, userId: user.id } })
    if (deleted.count === 0) throw new ApiError(404, 'Collection not found')
    return jsonOk({ deleted: true })
  })
}
