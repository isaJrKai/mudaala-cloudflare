import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { businessSaleVoidSchema } from '@/lib/validation'

type Params = { params: Promise<{ id: string }> }

// Sales are never hard-deleted. Voiding preserves the record and, when the
// sale adjusted stock, creates a compensating movement in the same transaction.
export async function POST(request: Request, { params }: Params) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await params
    const data = await parseBody(request, businessSaleVoidSchema)

    const result = await db.$transaction(async (tx) => {
      const sale = await tx.businessSale.findFirst({
        where: { id, userId: user.id },
        include: { stockMovement: true },
      })
      if (!sale) throw new ApiError(404, 'Recorded sale not found')
      if (sale.status !== 'COMPLETED') throw new ApiError(409, 'This sale has already been voided')

      const changed = await tx.businessSale.updateMany({
        where: { id, userId: user.id, status: 'COMPLETED' },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: data.reason },
      })
      if (changed.count !== 1) throw new ApiError(409, 'This sale has already changed. Refresh and try again.')

      let reversalId: string | null = null
      if (sale.stockMovement) {
        const reversal = await tx.stockMovement.create({
          data: {
            userId: user.id,
            listingId: sale.listingId,
            productTitle: sale.productTitle,
            quantityDelta: -Number(sale.stockMovement.quantityDelta.toString()),
            unit: sale.unit,
            reason: 'CORRECTION',
            note: `Reversal for voided sale ${sale.id}: ${data.reason}`,
            occurredAt: new Date(),
          },
          select: { id: true },
        })
        reversalId = reversal.id
      }
      return { id: sale.id, status: 'VOIDED', voidedAt: new Date().toISOString(), reversalId }
    })

    return jsonOk({ sale: result })
  })
}
