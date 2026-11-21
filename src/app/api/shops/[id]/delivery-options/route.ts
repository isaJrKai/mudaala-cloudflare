import { ApiError, jsonOk, route } from '@/lib/api'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  return route(async () => {
    const { id } = await context.params
    const seller = await db.user.findFirst({
      where: { id, profile: { is: { moderationStatus: 'ACTIVE' } }, suspendedAt: null },
      select: { id: true },
    })
    if (!seller) throw new ApiError(404, 'Shop not found')
    const options = await db.deliveryOption.findMany({
      where: { sellerId: id, isActive: true },
      select: { id: true, name: true, method: true, district: true, area: true, fee: true, minDays: true, maxDays: true },
      orderBy: [{ fee: 'asc' }, { minDays: 'asc' }],
    })
    return jsonOk({ options: options.map((option) => ({ ...option, fee: Number(option.fee) })) })
  })
}
