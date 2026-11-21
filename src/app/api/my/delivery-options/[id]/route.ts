import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireSeller, route } from '@/lib/api'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }
const updateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  method: z.enum(['PICKUP', 'SELLER_DELIVERY', 'COURIER']).optional(),
  district: z.string().trim().max(80).nullable().optional(),
  area: z.string().trim().max(100).nullable().optional(),
  fee: z.number().finite().min(0).max(100_000_000).optional(),
  minDays: z.number().int().min(0).max(60).optional(),
  maxDays: z.number().int().min(0).max(60).optional(),
  isActive: z.boolean().optional(),
}).refine((value) => value.minDays === undefined || value.maxDays === undefined || value.maxDays >= value.minDays, {
  message: 'Maximum delivery days must be at least the minimum',
  path: ['maxDays'],
})

export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const seller = await requireSeller()
    const { id } = await context.params
    const data = await parseBody(request, updateSchema)
    const existing = await db.deliveryOption.findFirst({ where: { id, sellerId: seller.id } })
    if (!existing) throw new ApiError(404, 'Delivery option not found')
    const minDays = data.minDays ?? existing.minDays
    const maxDays = data.maxDays ?? existing.maxDays
    if (maxDays < minDays) throw new ApiError(400, 'Maximum delivery days must be at least the minimum')
    const option = await db.deliveryOption.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.method !== undefined ? { method: data.method } : {}),
        ...(data.district !== undefined ? { district: data.district?.trim() || null } : {}),
        ...(data.area !== undefined ? { area: data.area?.trim() || null } : {}),
        ...(data.fee !== undefined ? { fee: data.fee.toFixed(2) } : {}),
        ...(data.minDays !== undefined ? { minDays: data.minDays } : {}),
        ...(data.maxDays !== undefined ? { maxDays: data.maxDays } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    })
    return jsonOk({ option: { ...option, fee: Number(option.fee) } })
  })
}

export async function DELETE(_request: Request, context: Context) {
  return route(async () => {
    const seller = await requireSeller()
    const { id } = await context.params
    const changed = await db.deliveryOption.updateMany({
      where: { id, sellerId: seller.id },
      data: { isActive: false },
    })
    if (!changed.count) throw new ApiError(404, 'Delivery option not found')
    return jsonOk({ ok: true })
  })
}
