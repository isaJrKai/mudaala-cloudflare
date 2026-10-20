import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { businessProductCreateSchema } from '@/lib/business-records'

function serializeProduct(product: {
  id: string; name: string; sku: string | null; unit: string; currency: string
  sellingPrice: { toString(): string }; costPrice: { toString(): string } | null
  stockOnHand: { toString(): string }; reorderLevel: { toString(): string }; trackInventory: boolean; archived: boolean
  createdAt: Date; updatedAt: Date
}) {
  return {
    ...product,
    sellingPrice: Number(product.sellingPrice),
    costPrice: product.costPrice === null ? null : Number(product.costPrice),
    stockOnHand: Number(product.stockOnHand),
    reorderLevel: Number(product.reorderLevel),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  }
}

export async function GET() {
  return route(async () => {
    const user = await requireUser()
    const products = await db.businessProduct.findMany({
      where: { userId: user.id },
      orderBy: [{ archived: 'asc' }, { updatedAt: 'desc' }],
    })
    return jsonOk({ products: products.map(serializeProduct) })
  })
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const data = await parseBody(request, businessProductCreateSchema)
    let product
    try {
      product = await db.$transaction(async (tx) => {
        const created = await tx.businessProduct.create({
          data: {
            userId: user.id,
            name: data.name,
            sku: data.sku?.trim() || null,
            unit: data.unit,
            currency: data.currency,
            sellingPrice: data.sellingPrice.toFixed(2),
            costPrice: data.costPrice == null ? null : data.costPrice.toFixed(2),
            stockOnHand: data.openingStock.toFixed(3),
            reorderLevel: data.reorderLevel.toFixed(3),
            trackInventory: data.trackInventory,
          },
        })
        if (data.openingStock > 0) {
          await tx.stockMovement.create({
            data: { userId: user.id, productId: created.id, type: 'OPENING', quantityDelta: data.openingStock.toFixed(3), note: 'Opening stock recorded when product was created' },
          })
        }
        return created
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new ApiError(409, 'That SKU is already used by another product in your business')
      }
      throw error
    }
    return jsonOk({ product: serializeProduct(product) }, 201)
  })
}
