import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { businessProductUpdateSchema } from '@/lib/business-records'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await context.params
    const data = await parseBody(request, businessProductUpdateSchema)
    const existing = await db.businessProduct.findFirst({ where: { id, userId: user.id } })
    if (!existing) throw new ApiError(404, 'Product not found')

    let product
    try {
      product = await db.businessProduct.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.sku !== undefined ? { sku: data.sku?.trim() || null } : {}),
        ...(data.unit !== undefined ? { unit: data.unit } : {}),
        ...(data.sellingPrice !== undefined ? { sellingPrice: data.sellingPrice.toFixed(2) } : {}),
        ...(data.costPrice !== undefined ? { costPrice: data.costPrice === null ? null : data.costPrice.toFixed(2) } : {}),
        ...(data.trackInventory !== undefined ? { trackInventory: data.trackInventory } : {}),
        ...(data.archived !== undefined ? { archived: data.archived } : {}),
      },
    })
    return jsonOk({
      product: {
        ...product,
        sellingPrice: Number(product.sellingPrice),
        costPrice: product.costPrice === null ? null : Number(product.costPrice),
        stockOnHand: Number(product.stockOnHand),
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
      },
    })
  })
}
