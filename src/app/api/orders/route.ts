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
  deliveryOptions: z.record(z.string(), z.string().trim().min(1).max(128)).optional(),
  deliveryAddress: z.object({
    district: z.string().trim().min(1).max(80),
    area: z.string().trim().max(100).optional(),
    addressLine: z.string().trim().min(3).max(240),
    contactPhone: z.string().trim().max(32).optional(),
  }).optional(),
  buyerNote: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(8).max(128),
})

type CheckoutItem = z.infer<typeof checkoutSchema>['items'][number]

function orderNumber() {
  return 'MD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomUUID().slice(0, 6).toUpperCase()
}

export async function GET() {
  return route(async () => {
    const user = await requireUser()
    const orders = await db.commerceOrder.findMany({
      where: { OR: [{ buyerId: user.id }, { sellerId: user.id }] },
      include: {
        items: true,
        seller: { select: { profile: { select: { businessName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return jsonOk({
      orders: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        role: order.buyerId === user.id ? 'BUYER' : 'SELLER',
        shopName: order.seller.profile?.businessName ?? 'Mudaala shop',
        status: order.status,
        paymentStatus: order.paymentStatus,
        currency: order.currency,
        total: Number(order.total),
        itemCount: order.items.length,
        createdAt: order.createdAt.toISOString(),
      })),
    })
  })
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
    })
    if (listings.length !== listingIds.length) throw new ApiError(409, 'One or more products are no longer available.')
    const sellerRecords = await db.user.findMany({
      where: { id: { in: [...new Set(listings.map((listing) => listing.userId))] } },
      select: { id: true, profile: { select: { businessName: true, moderationStatus: true } } },
    })
    const [variantRecords, businessProductRecords] = await Promise.all([
      db.listingVariant.findMany({
        where: { listingId: { in: listingIds } },
        include: { businessProduct: true },
        orderBy: { sortOrder: 'asc' },
      }),
      db.businessProduct.findMany({
        where: { listingId: { in: listingIds }, archived: false },
      }),
    ])
    const listingsWithInventory = listings.map((listing) => ({
      ...listing,
      user: sellerRecords.find((seller) => seller.id === listing.userId) ?? null,
      variants: variantRecords.filter((variant) => variant.listingId === listing.id),
      businessProducts: businessProductRecords.filter((product) => product.listingId === listing.id),
    }))
    const bySeller = new Map<string, Array<{ item: CheckoutItem; listing: typeof listingsWithInventory[number]; variant: typeof listingsWithInventory[number]['variants'][number] | null; product: typeof listingsWithInventory[number]['businessProducts'][number] | null; price: number }>>()

    for (const item of items) {
      const listing = listingsWithInventory.find((entry) => entry.id === item.listingId)!
      if (listing.userId === buyer.id) throw new ApiError(409, 'You cannot order products from your own shop.')
      if (!listing.user.profile || listing.user.profile.moderationStatus !== 'ACTIVE') throw new ApiError(409, 'This seller is not currently accepting orders.')
      const variant = item.variantId ? listing.variants.find((entry) => entry.id === item.variantId) ?? null : null
      if (item.variantId && !variant) throw new ApiError(400, 'A selected product option is no longer available.')
      if (listing.variants.length > 0 && !variant) throw new ApiError(400, 'Choose a product option before checkout.')
      if (variant?.availabilityStatus === 'OUT_OF_STOCK' || (!variant && listing.availabilityStatus === 'OUT_OF_STOCK')) {
        throw new ApiError(409, 'One of the selected products is out of stock.')
      }
      const rawPrice = variant?.price ?? listing.price
      const price = rawPrice === null || rawPrice === undefined ? null : Number(rawPrice)
      if (price === null || !Number.isFinite(price) || price < 0) {
        throw new ApiError(409, 'A seller must confirm the price before this product can be ordered.')
      }
      const product = variant
        ? variant.businessProduct
        : listing.businessProducts.find((entry) => entry.listingId === listing.id) ?? null
      if (product && product.userId !== listing.userId) throw new ApiError(409, 'The seller inventory link is invalid. Contact the seller.')
      if (variant && product && variant.trackInventory !== product.trackInventory) throw new ApiError(409, 'The seller must align this option’s stock tracking with its linked inventory record.')
      if (variant?.trackInventory && (!product || !product.trackInventory)) {
        throw new ApiError(409, 'This option is not yet connected to the seller’s stock records. Contact the seller before ordering.')
      }
      if (product?.trackInventory === false) {
        // Inventory intentionally not tracked for this product.
      }
      const group = bySeller.get(listing.userId) ?? []
      group.push({ item, listing, variant, product: product?.trackInventory ? product : null, price })
      bySeller.set(listing.userId, group)
    }

    const expectedKeys = [...bySeller.keys()].map((sellerId) => body.idempotencyKey + ':' + sellerId)
    let result: { orders: Array<{ id: string; orderNumber: string; status: string; total: Prisma.Decimal; currency: string }>; replayed: boolean }
    try {
      result = await db.$transaction(async (tx) => {
      const orders = await tx.commerceOrder.findMany({
        where: { buyerId: buyer.id, idempotencyKey: { in: expectedKeys } },
        include: { items: true },
      })
      if (orders.length) {
        if (orders.length !== expectedKeys.length) throw new ApiError(409, 'This checkout key was already used for a different basket. Refresh and try again.')
        return { orders, replayed: true }
      }

      const productTotals = new Map<string, number>()
      for (const group of bySeller.values()) {
        for (const line of group) {
          if (line.product) productTotals.set(line.product.id, (productTotals.get(line.product.id) ?? 0) + line.item.quantity)
        }
      }
      const productIds = [...productTotals.keys()]
      if (productIds.length) {
        // Serialize competing checkouts against the same inventory rows.
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "BusinessProduct" WHERE "id" IN (${Prisma.join(productIds)}) ORDER BY "id" FOR UPDATE`)
      }

      const lockedProducts = productIds.length
        ? await tx.businessProduct.findMany({ where: { id: { in: productIds }, archived: false, userId: { in: [...bySeller.keys()] } } })
        : []
      const lockedById = new Map(lockedProducts.map((product) => [product.id, product]))
      for (const group of bySeller.values()) {
        for (const line of group) {
          if (!line.product) continue
          const current = lockedById.get(line.product.id)
          const mappingIsCurrent = line.variant
            ? current?.listingVariantId === line.variant.id
            : current?.listingId === line.listing.id
          if (!mappingIsCurrent) throw new ApiError(409, 'The seller inventory link changed during checkout. Refresh the product and try again.')
        }
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
        const product = lockedById.get(productId)
        if (!product) throw new ApiError(409, 'A seller inventory record changed. Please refresh and try again.')
        const available = Number(product.stockOnHand) - (heldByProduct.get(productId) ?? 0)
        if (available + 0.000001 < requested) {
          throw new ApiError(409, 'There is not enough available stock for ' + product.name + '. Please reduce the quantity or contact the seller.')
        }
      }

      const createdOrders: Array<{ id: string; orderNumber: string; status: string; total: Prisma.Decimal; currency: string }> = []
      for (const [sellerId, group] of bySeller) {
        let deliveryOption: { id: string; name: string; method: string; fee: Prisma.Decimal; minDays: number; maxDays: number; district: string | null; area: string | null } | null = null
        const selectedDeliveryOptionId = body.deliveryOptions?.[sellerId] ?? (bySeller.size === 1 ? body.deliveryOptionId : undefined)
        if (selectedDeliveryOptionId) {
          deliveryOption = await tx.deliveryOption.findFirst({
            where: { id: selectedDeliveryOptionId, sellerId, isActive: true },
          })
          if (!deliveryOption) throw new ApiError(400, 'The selected delivery option is no longer available for this seller.')
        }
        const currency = group[0]!.listing.currency
        if (group.some((line) => line.listing.currency !== currency)) throw new ApiError(400, 'A single seller order must use one currency.')
        const subtotal = group.reduce((sum, line) => sum + line.price * line.item.quantity, 0)
        const deliveryFee = deliveryOption ? Number(deliveryOption.fee) : 0
        if (deliveryOption && deliveryOption.method !== 'PICKUP' && (!body.deliveryAddress || !body.deliveryAddress.contactPhone)) {
          throw new ApiError(400, 'Enter a delivery address and contact phone for this seller.')
        }
        if (deliveryOption?.district && body.deliveryAddress?.district.toLowerCase() !== deliveryOption.district.toLowerCase()) {
          throw new ApiError(400, 'This delivery option does not cover the selected district.')
        }
        const order = await tx.commerceOrder.create({
          data: {
            orderNumber: orderNumber(),
            buyerId: buyer.id,
            buyerName: buyer.name,
            sellerId,
            idempotencyKey: body.idempotencyKey + ':' + sellerId,
            currency,
            subtotal: subtotal.toFixed(2),
            deliveryFee: deliveryFee.toFixed(2),
            total: (subtotal + deliveryFee).toFixed(2),
            deliveryMethod: deliveryOption?.method ?? 'PICKUP',
            deliveryAddress: body.deliveryAddress ? body.deliveryAddress : undefined,
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
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
      if (code !== 'P2002' && code !== 'P2034') throw error
      const previous = await db.commerceOrder.findMany({
        where: { buyerId: buyer.id, idempotencyKey: { in: expectedKeys } },
      })
      if (previous.length === expectedKeys.length) {
        result = { orders: previous, replayed: true }
      } else if (code === 'P2034') {
        throw new ApiError(409, 'Inventory changed during checkout. Refresh the basket and try again.')
      } else {
        throw error
      }
    }

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
