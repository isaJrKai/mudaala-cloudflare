import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { businessSaleCreateSchema } from '@/lib/validation'

const PAGE_SIZE = 50

function serializeSale(sale: {
  id: string; listingId: string | null; productTitle: string; quantity: { toString(): string }
  unit: string | null; unitPrice: { toString(): string }; unitCost: { toString(): string } | null
  currency: string; channel: string; note: string | null; occurredAt: Date; status: string
  voidedAt: Date | null; voidReason: string | null; createdAt: Date; stockMovement?: { id: string; quantityDelta: { toString(): string } } | null
}) {
  return {
    ...sale,
    quantity: Number(sale.quantity.toString()),
    unitPrice: Number(sale.unitPrice.toString()),
    unitCost: sale.unitCost === null ? null : Number(sale.unitCost.toString()),
    occurredAt: sale.occurredAt.toISOString(),
    voidedAt: sale.voidedAt?.toISOString() ?? null,
    createdAt: sale.createdAt.toISOString(),
    stockMovement: sale.stockMovement ? {
      id: sale.stockMovement.id,
      quantityDelta: Number(sale.stockMovement.quantityDelta.toString()),
    } : null,
  }
}

export async function GET(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const url = new URL(request.url)
    const page = Math.max(1, Math.min(10_000, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1))
    const [total, rows] = await Promise.all([
      db.businessSale.count({ where: { userId: user.id } }),
      db.businessSale.findMany({
        where: { userId: user.id },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { stockMovement: { select: { id: true, quantityDelta: true } } },
      }),
    ])
    return jsonOk({ sales: rows.map(serializeSale), page, pageSize: PAGE_SIZE, total, pageCount: Math.ceil(total / PAGE_SIZE) })
  })
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const data = await parseBody(request, businessSaleCreateSchema)

    const listing = data.listingId
      ? await db.listing.findFirst({
          where: { id: data.listingId, userId: user.id },
          select: { id: true, title: true, unit: true, currency: true },
        })
      : null
    if (data.listingId && !listing) throw new ApiError(404, 'That product was not found in your listings')

    const productTitle = listing?.title ?? data.productTitle?.trim()
    if (!productTitle) throw new ApiError(400, 'Enter the product name')
    const unit = listing ? listing.unit : (data.unit?.trim() || null)
    const currency = listing ? listing.currency : (data.currency ?? 'UGX')
    const occurredAt = data.occurredAt ? new Date(data.occurredAt) : new Date()
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) {
      throw new ApiError(400, 'Sale date cannot be in the future')
    }

    // Nested create is atomic: when stock adjustment is requested, the sale and
    // its linked stock movement are committed together or neither is committed.
    const sale = await db.businessSale.create({
      data: {
        userId: user.id,
        listingId: listing?.id ?? null,
        productTitle,
        quantity: data.quantity,
        unit,
        unitPrice: data.unitPrice,
        unitCost: data.unitCost ?? null,
        currency,
        channel: data.channel,
        note: data.note?.trim() || null,
        occurredAt,
        ...(data.adjustStock ? {
          stockMovement: {
            create: {
              userId: user.id,
              listingId: listing?.id ?? null,
              productTitle,
              quantityDelta: -data.quantity,
              unit,
              reason: 'SALE',
              note: 'Stock reduced by recorded sale',
              occurredAt,
            },
          },
        } : {}),
      },
      include: { stockMovement: { select: { id: true, quantityDelta: true } } },
    })
    return jsonOk({ sale: serializeSale(sale) }, 201)
  })
}
