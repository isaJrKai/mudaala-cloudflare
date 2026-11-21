import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

const actionSchema = z.object({
  action: z.enum(['ACCEPT', 'REJECT', 'MARK_PAID', 'PROCESSING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETE']),
  paymentMethod: z.enum(['CASH', 'MTN_MOMO', 'AIRTEL_MONEY', 'OTHER']).optional(),
  paymentReference: z.string().trim().max(120).optional(),
  sellerNote: z.string().trim().max(1000).optional(),
})

export async function GET(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await context.params
    const order = await db.commerceOrder.findFirst({
      where: { id, OR: [{ buyerId: user.id }, { sellerId: user.id }] },
      include: {
        items: true,
        reservations: true,
        seller: { select: { profile: { select: { businessName: true, phone: true, whatsapp: true } } } },
        buyer: { select: { name: true } },
      },
    })
    if (!order) throw new ApiError(404, 'Order not found')
    const isBuyer = order.buyerId === user.id
    return jsonOk({
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        paymentReference: order.paymentReference,
        currency: order.currency,
        subtotal: Number(order.subtotal),
        deliveryFee: Number(order.deliveryFee),
        total: Number(order.total),
        deliveryMethod: order.deliveryMethod,
        deliveryEstimate: order.deliveryEstimate,
        deliveryAddress: order.deliveryAddress,
        buyerNote: order.buyerNote,
        sellerNote: order.sellerNote,
        createdAt: order.createdAt.toISOString(),
        acceptedAt: order.acceptedAt?.toISOString() ?? null,
        paidAt: order.paidAt?.toISOString() ?? null,
        completedAt: order.completedAt?.toISOString() ?? null,
        role: isBuyer ? 'BUYER' : 'SELLER',
        seller: isBuyer ? order.seller.profile : null,
        buyerName: isBuyer ? null : order.buyer.name,
        items: order.items.map((item) => ({
          id: item.id,
          listingId: item.listingId,
          variantId: item.variantId,
          title: item.productTitle,
          variantLabel: item.variantLabel,
          variantOptions: item.variantOptions,
          sku: item.sku,
          photoUrl: item.photoUrl,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          lineTotal: Number(item.lineTotal),
        })),
      },
    })
  })
}

export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const seller = await requireUser('Sign in to manage orders')
    const { id } = await context.params
    const body = await parseBody(request, actionSchema)

    const result = await db.$transaction(async (tx) => {
      // Serialize seller actions against the expiry sweep for this order.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "CommerceOrder" WHERE "id" = ${id} FOR UPDATE`)
      const order = await tx.commerceOrder.findFirst({
        where: { id, sellerId: seller.id },
        include: { reservations: true, items: true },
      })
      if (!order) throw new ApiError(404, 'Order not found')
      const now = new Date()

      if (body.action === 'REJECT') {
        if (order.status !== 'PENDING_SELLER') throw new ApiError(409, 'Only an order awaiting seller confirmation can be rejected.')
        await tx.stockReservation.updateMany({
          where: { orderId: order.id, status: 'HELD' },
          data: { status: 'RELEASED', releasedAt: now },
        })
        return tx.commerceOrder.update({
          where: { id: order.id },
          data: { status: 'REJECTED', cancelledAt: now, sellerNote: body.sellerNote ?? null },
        })
      }

      if (body.action === 'ACCEPT') {
        if (order.status !== 'PENDING_SELLER') throw new ApiError(409, 'This order has already been reviewed.')
        const held = order.reservations.filter((reservation) => reservation.status === 'HELD')
        if (held.some((reservation) => reservation.expiresAt <= now)) {
          await tx.stockReservation.updateMany({
            where: { orderId: order.id, status: 'HELD' },
            data: { status: 'EXPIRED', releasedAt: now },
          })
          return tx.commerceOrder.update({ where: { id: order.id }, data: { status: 'EXPIRED' } })
        }
        const productIds = [...new Set(held.map((reservation) => reservation.businessProductId).filter((value): value is string => Boolean(value)))]
        if (productIds.length) {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "BusinessProduct" WHERE "id" IN (${Prisma.join(productIds)}) ORDER BY "id" FOR UPDATE`)
        }
        for (const reservation of held) {
          if (!reservation.businessProductId) continue
          const changed = await tx.businessProduct.updateMany({
            where: {
              id: reservation.businessProductId,
              userId: seller.id,
              archived: false,
              trackInventory: true,
              stockOnHand: { gte: reservation.quantity },
            },
            data: { stockOnHand: { decrement: reservation.quantity } },
          })
          if (changed.count !== 1) throw new ApiError(409, 'Recorded stock changed before this order could be accepted. Review inventory and try again.')
          const movementKey = 'order-deduction:' + reservation.orderItemId
          const existingMovement = await tx.stockMovement.findUnique({ where: { idempotencyKey: movementKey } })
          if (!existingMovement) {
            await tx.stockMovement.create({
              data: {
                userId: seller.id,
                productId: reservation.businessProductId,
                orderId: order.id,
                idempotencyKey: movementKey,
                type: 'ORDER',
                quantityDelta: reservation.quantity.neg(),
                note: 'Stock deducted for confirmed Mudaala order ' + order.orderNumber,
              },
            })
          }
        }
        await tx.stockReservation.updateMany({
          where: { orderId: order.id, status: 'HELD' },
          data: { status: 'COMMITTED', committedAt: now },
        })
        return tx.commerceOrder.update({
          where: { id: order.id },
          data: { status: 'ACCEPTED', acceptedAt: now, sellerNote: body.sellerNote ?? null },
        })
      }

      if (body.action === 'MARK_PAID') {
        if (!['ACCEPTED', 'AWAITING_PAYMENT', 'PROCESSING', 'READY', 'OUT_FOR_DELIVERY'].includes(order.status)) {
          throw new ApiError(409, 'The order must be accepted before payment can be recorded.')
        }
        if (order.paymentStatus === 'PAID') return order
        return tx.commerceOrder.update({
          where: { id: order.id },
          data: {
            paymentStatus: 'PAID',
            paidAt: now,
            paymentMethod: body.paymentMethod ?? 'OTHER',
            paymentReference: body.paymentReference?.trim() || null,
          },
        })
      }

      const transitions: Record<string, { from: string[]; to: string }> = {
        PROCESSING: { from: ['ACCEPTED'], to: 'PROCESSING' },
        READY: { from: ['ACCEPTED', 'PROCESSING'], to: 'READY' },
        OUT_FOR_DELIVERY: { from: ['READY'], to: 'OUT_FOR_DELIVERY' },
        COMPLETE: { from: ['READY', 'OUT_FOR_DELIVERY'], to: 'COMPLETED' },
      }
      const transition = transitions[body.action]
      if (!transition || !transition.from.includes(order.status)) {
        throw new ApiError(409, 'That order status change is not allowed.')
      }
      return tx.commerceOrder.update({
        where: { id: order.id },
        data: {
          status: transition.to,
          ...(transition.to === 'COMPLETED' ? { completedAt: now } : {}),
          ...(body.sellerNote !== undefined ? { sellerNote: body.sellerNote } : {}),
        },
      })
    }, { isolationLevel: 'Serializable' })

    if (result.status === 'EXPIRED') throw new ApiError(409, 'The stock reservation expired. Ask the buyer to place the order again.')
    return jsonOk({
      order: {
        id: result.id,
        orderNumber: result.orderNumber,
        status: result.status,
        paymentStatus: result.paymentStatus,
      },
    })
  })
}
