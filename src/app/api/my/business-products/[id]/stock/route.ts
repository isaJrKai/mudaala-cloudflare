import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { stockMovementSchema } from '@/lib/business-records'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await context.params
    const product = await db.businessProduct.findFirst({ where: { id, userId: user.id }, select: { id: true } })
    if (!product) throw new ApiError(404, 'Product not found')
    const movements = await db.stockMovement.findMany({
      where: { userId: user.id, productId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return jsonOk({
      movements: movements.map((movement) => ({
        ...movement,
        quantityDelta: Number(movement.quantityDelta),
        createdAt: movement.createdAt.toISOString(),
      })),
    })
  })
}

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await context.params
    const data = await parseBody(request, stockMovementSchema)
    const add = data.type === 'RESTOCK' || data.type === 'RETURN' ||
      ((data.type === 'ADJUSTMENT' || data.type === 'CORRECTION') && data.direction === 'ADD')
    const delta = add ? data.quantity : -data.quantity

    const movement = await db.$transaction(async (tx) => {
      const product = await tx.businessProduct.findFirst({
        where: { id, userId: user.id, archived: false },
        select: { id: true },
      })
      if (!product) throw new ApiError(404, 'Active product not found')

      const changed = await tx.businessProduct.updateMany({
        where: {
          id,
          userId: user.id,
          ...(delta < 0 ? { stockOnHand: { gte: data.quantity.toFixed(3) } } : {}),
        },
        data: { stockOnHand: delta > 0 ? { increment: data.quantity.toFixed(3) } : { decrement: data.quantity.toFixed(3) } },
      })
      if (changed.count !== 1) throw new ApiError(409, 'There is not enough recorded stock for that adjustment')

      return tx.stockMovement.create({
        data: {
          userId: user.id,
          productId: id,
          type: data.type,
          quantityDelta: delta.toFixed(3),
          note: data.note?.trim() || null,
        },
      })
    })
    return jsonOk({
      movement: {
        ...movement,
        quantityDelta: Number(movement.quantityDelta),
        createdAt: movement.createdAt.toISOString(),
      },
    }, 201)
  })
}
