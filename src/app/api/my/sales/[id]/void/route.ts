import { route, jsonOk, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'

type Context = { params: Promise<{ id: string }> }

export async function POST(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await context.params

    const result = await db.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id, userId: user.id },
        include: { items: true },
      })
      if (!sale) throw new ApiError(404, 'Sale not found')
      if (sale.status !== 'COMPLETED') throw new ApiError(409, 'This sale has already been voided')

      const movements = await tx.stockMovement.findMany({
        where: { userId: user.id, saleId: sale.id, type: 'SALE' },
      })

      // Restore stock only for items whose original sale actually decremented
      // tracked inventory. The reversal itself is another immutable movement.
      for (const movement of movements) {
        const reversal = -Number(movement.quantityDelta)
        await tx.businessProduct.updateMany({
          where: { id: movement.productId, userId: user.id },
          data: { stockOnHand: { increment: reversal.toFixed(3) } },
        })
        await tx.stockMovement.create({
          data: {
            userId: user.id,
            productId: movement.productId,
            saleId: sale.id,
            type: 'CORRECTION',
            quantityDelta: reversal.toFixed(3),
            note: `Stock reversal for voided sale ${sale.id}`,
          },
        })
      }

      const updated = await tx.sale.updateMany({
        where: { id: sale.id, userId: user.id, status: 'COMPLETED' },
        data: { status: 'VOIDED', notes: sale.notes ? `${sale.notes}\nVoided by seller` : 'Voided by seller' },
      })
      if (updated.count !== 1) throw new ApiError(409, 'This sale has already been changed')
      return { id: sale.id, status: 'VOIDED' }
    })

    return jsonOk({ sale: result })
  })
}
