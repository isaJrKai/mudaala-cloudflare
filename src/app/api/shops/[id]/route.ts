import { NextRequest } from 'next/server'
import { route, jsonOk, ApiError } from '@/lib/api'
import { getShopPage } from '@/lib/shop'
import { getSessionUser } from '@/lib/auth'
import { isAdminUser } from '@/lib/admin'
import { recordShopDailyEvent } from '@/lib/listing-analytics'

type Params = { params: Promise<{ id: string }> }

// Public shop page - the seller's own space: identity, trust checklist and
// their full ACTIVE catalogue. No sign-in for buyers, ever.
export async function GET(_request: NextRequest, { params }: Params) {
  return route(async () => {
    const { id } = await params
    const data = await getShopPage(id)
    if (!data) throw new ApiError(404, 'This shop does not exist')

    const viewer = await getSessionUser()
    if (!viewer || (viewer.id !== id && !isAdminUser(viewer))) {
      // Daily aggregates contain no viewer identity. A telemetry failure must
      // not prevent buyers from opening the public shop.
      await recordShopDailyEvent({ ownerId: id, event: 'SHOP_VIEW' }).catch(() => undefined)
    }
    return jsonOk(data)
  })
}
