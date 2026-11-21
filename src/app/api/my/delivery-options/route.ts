import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireSeller, route } from '@/lib/api'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const optionSchema = z.object({
  name: z.string().trim().min(2).max(80),
  method: z.enum(['PICKUP', 'SELLER_DELIVERY', 'COURIER']).default('SELLER_DELIVERY'),
  district: z.string().trim().max(80).optional().nullable(),
  area: z.string().trim().max(100).optional().nullable(),
  fee: z.number().finite().min(0).max(100_000_000),
  minDays: z.number().int().min(0).max(60),
  maxDays: z.number().int().min(0).max(60),
}).refine((value) => value.maxDays >= value.minDays, {
  message: 'Maximum delivery days must be at least the minimum',
  path: ['maxDays'],
})

export async function GET() {
  return route(async () => {
    const seller = await requireSeller()
    const options = await db.deliveryOption.findMany({
      where: { sellerId: seller.id },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    })
    return jsonOk({ options: options.map((option) => ({
      ...option,
      fee: Number(option.fee),
      createdAt: option.createdAt.toISOString(),
      updatedAt: option.updatedAt.toISOString(),
    })) })
  })
}

export async function POST(request: Request) {
  return route(async () => {
    const seller = await requireSeller()
    const data = await parseBody(request, optionSchema)
    const option = await db.deliveryOption.create({
      data: {
        sellerId: seller.id,
        name: data.name,
        method: data.method,
        district: data.district?.trim() || null,
        area: data.area?.trim() || null,
        fee: data.fee.toFixed(2),
        minDays: data.minDays,
        maxDays: data.maxDays,
      },
    })
    return jsonOk({ option: { ...option, fee: Number(option.fee) } }, 201)
  })
}

