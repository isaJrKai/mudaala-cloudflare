import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const checkoutSchema = z.object({
  items: z.array(z.object({
    listingId: z.string().trim().min(1).max(128),
    variantId: z.string().trim().min(1).max(128).optional(),
    quantity: z.number().finite().min(0.001).max(99)
      .refine((value) => Math.round(value * 1000) === value * 1000, 'Quantity must have at most three decimal places'),
  })).min(1).max(100),
  deliveryOptionId: z.string().trim().min(1).max(128).optional(),
  buyerNote: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(8).max(128),
})

type CheckoutItem = z.infer<typeof checkoutSchema>['items'][number]

function orderNumber() {
  return 'MD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomUUID().slice(0, 6).toUpperCase()
}

export async function POST(request: Request) {
  return route(async () => {
    const buyer = await requireUser('Sign in to place an order')
    const body = await parseBody(request, checkoutSchema)
    const now = new Date()

    // Duplicate listing/variant lines are collapsed before stock is checked.
    const collapsed = new Map<string, CheckoutItem>()
    for (const item of body.items) {
      const key = item.listingId + ':' + (item.variantId ?? '')
      const previous = collapsed.get(key)
      collapsed.set(key, { ...item, quantity: Number((item.quantity + (previous?.quantity ?? 0)).toFixed(3)) })
    }
    const items = [...collapsed.values()]
    const listingIds = [...new Set(items.map((item) => item.listingId))]
    const listings = await db.listing.findMany({
      where: {
        id: { in: listingIds },
        type: 'OFFER',
        status: 'ACTIVE',
        isSeed: false,
        expiresAt: { gt: now },
      },
      include: {
        user: { select: { id: true, profile: { select: { businessName: true, moderationStatus: true } } } },
        businessProducts: { where: { archived: false } },
        variants: { include: { businessProduct: true }, orderBy: { sortOrder: 'asc' } },
      },
    })
    if (listings.length !== listingIds.length) throw new ApiError(409, 'One or more products are no longer available.')
    const listingById = new Map(listings.map((listing) => [listing.id, listing]))
    const bySeller = new Map<string, Array<{ item: CheckoutItem; listing: typeof listings[number]; variant: typeof listings[number]['variants'][number] | null; product: typeof listings[number]['businessProducts'][number] | null; price: number }>>()

    for (const item of items) {
      const listing = listingById.get(item.listingId)!
      if (listing.userId === buyer.id) throw new ApiError(409, 'You cannot order products from your own shop.')
      if (!listing.user.profile || listing.user.profile.moderationStatus !== 'ACTIVE') throw new ApiError(409, 'This seller is not currently accepting orders.')
      const variant = item.variantId ? listing.variants.find((entry) => entry.id === item.variantId) ?? null : null
      if (item.variantId && !variant) throw new ApiError(400, 'A selected product option is no longer available.')
      if (listing.variants.length > 0 && !variant) throw new ApiError(400, 'Choose a product option before checkout.')
      if (variant?.availabilityStatus === 'OUT_OF_STOCK' || (!variant && listing.availabilityStatus === 'OUT_OF_STOCK')) {
        throw new ApiError(409, 'One of the selected products is out of stock.')
      }
      const price = variant?.price ?? listing.price
      if (price === null || price === undefined || !Number.isFinite(price) || price < 0) {
        throw new ApiError(409, 'A seller must confirm the price before this product can be ordered.')
      }
      const product = variant
        ? variant.businessProduct
        : listing.businessProducts.find((entry) => entry.listingId === listing.id) ?? null
      if (variant?.trackInventory && !product) {
        throw new ApiError(409, 'This option is not yet connected to the seller’s stock records. Contact the seller before ordering.')
      }
      if (product?.trackInventory === false) {
        // Inventory intentionally not tracked for this product.
      }
      const group = bySeller.get(listing.userId) ?? []
      group.push({ item, listing, variant, product: product?.trackInventory ? product : null, price })
      bySeller.set(listing.userId, group)
    }

    const result = await db.$transaction(async (tx) => {
      const orders = await tx.commerceOrder.findMany({
        where: { buyerId: buyer.id, idempotencyKey: { startsWith: body.idempotencyKey + ':' } },
        include: { items: true },
      })
      if (orders.length) return { orders, replayed: true }

      const productTotals = new Map<string, number>()
      for (const group of bySeller.values()) {
        for (const line of group) {
          if (line.product) productTotals.set(line.product.id, (productTotals.get(line.product.id) ?? 0) + line.item.quantity)
        }
      }
      const productIds = [...productTotals.keys()]
      if (productIds.length) {
        // Serialize competing checkouts against the same inventory rows.
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "BusinessProduct" WHERE "id" IN (${Prisma.join(productIds)}) FOR UPDATE`)
      }

      const heldByProduct = new Map<string, number>()
      for (const productId of productIds) {
        const held = await tx.stockReservation.aggregate({
          where: { businessProductId: productId, status: 'HELD', expiresAt: { gt: now } },
          _sum: { quantity: true },
        })
        heldByProduct.set(productId, Number(held._sum.quantity ?? 0))
      }
      for (const [productId, requested] of productTotals) {
        const product = [...bySeller.values()].flat().find((line) => line.product?.id === productId)?.product
        if (!product) continue
        const available = Number(product.stockOnHand) - (heldByProduct.get(productId) ?? 0)
        if (available + 0.000001 < requested) {
          throw new ApiError(409, 'There is not enough available stock for ' + product.name + '. Please reduce the quantity or contact the seller.')
        }
      }

      const createdOrders = []
      for (const [sellerId, group] of bySeller) {
        let deliveryOption: { id: string; name: string; method: string; fee: Prisma.Decimal; minDays: number; maxDays: number; district: string | null; area: string | null } | null = null
        if (body.deliveryOptionId) {
          deliveryOption = await tx.deliveryOption.findFirst({
            where: { id: body.deliveryOptionId, sellerId, isActive: true },
          })
          if (!deliveryOption) throw new ApiError(400, 'The selected delivery option is no longer available for this seller.')
        }
        const currency = group[0]!.listing.currency
        if (group.some((line) => line.listing.currency !== currency)) throw new ApiError(400, 'A single seller order must use one currency.')
        const subtotal = group.reduce((sum, line) => sum + line.price * line.item.quantity, 0)
        const deliveryFee = deliveryOption ? Number(deliveryOption.fee) : 0
        const order = await tx.commerceOrder.create({
          data: {
            orderNumber: orderNumber(),
            buyerId: buyer.id,
            sellerId,
            idempotencyKey: body.idempotencyKey + ':' + sellerId,
            currency,
            subtotal: subtotal.toFixed(2),
            deliveryFee: deliveryFee.toFixed(2),
            total: (subtotal + deliveryFee).toFixed(2),
            deliveryMethod: deliveryOption?.method ?? 'PICKUP',
            deliveryEstimate: deliveryOption ? {
              optionId: deliveryOption.id,
              optionName: deliveryOption.name,
              district: deliveryOption.district,
              area: deliveryOption.area,
              minDays: deliveryOption.minDays,
              maxDays: deliveryOption.maxDays,
              estimateOnly: true,
            } : undefined,
            buyerNote: body.buyerNote?.trim() || null,
            expiresAt: new Date(now.getTime() + 20 * 60 * 1000),
          },
        })
        for (const line of group) {
          const variantOptions = line.variant?.options ?? undefined
          const photoUrl = line.variant?.photos
            ? (() => { try { const photos = JSON.parse(line.variant.photos) as unknown; return Array.isArray(photos) && typeof photos[0] === 'string' ? photos[0] : null } catch { return null } })()
            : null
          const orderItem = await tx.commerceOrderItem.create({
            data: {
              orderId: order.id,
              listingId: line.listing.id,
              variantId: line.variant?.id ?? null,
              businessProductId: line.product?.id ?? null,
              productTitle: line.listing.title,
              variantLabel: line.variant?.label ?? null,
              variantOptions,
              sku: line.variant?.sku ?? line.product?.sku ?? null,
              photoUrl,
              unit: line.listing.unit ?? line.product?.unit ?? null,
              quantity: line.item.quantity.toFixed(3),
              unitPrice: line.price.toFixed(2),
              lineTotal: (line.price * line.item.quantity).toFixed(2),
            },
          })
          if (line.product) {
            await tx.stockReservation.create({
              data: {
                orderId: order.id,
                orderItemId: orderItem.id,
                businessProductId: line.product.id,
                variantId: line.variant?.id ?? null,
                quantity: line.item.quantity.toFixed(3),
                expiresAt: order.expiresAt!,
                idempotencyKey: 'order-hold:' + orderItem.id,
              },
            })
          }
        }
        createdOrders.push(order)
        await tx.notification.create({
          data: {
            userId: sellerId,
            type: 'NEW_ORDER',
            category: 'SOCIAL',
            priority: 'HIGH',
            title: 'New order received',
            body: 'A buyer placed order ' + order.orderNumber + '. Confirm availability and fulfilment.',
            actionUrl: '/#/orders',
            actionLabel: 'Review order',
            dedupeKey: 'new-order:' + order.id,
          },
        })
      }
      return { orders: createdOrders, replayed: false }
    }, { isolationLevel: 'Serializable' })

    return jsonOk({
      orders: result.orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: Number(order.total),
        currency: order.currency,
      })),
      replayed: result.replayed,
      reservationMinutes: 20,
    }, result.replayed ? 200 : 201)
  })
}
