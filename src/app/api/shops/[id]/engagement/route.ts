import { route, jsonOk, parseBody, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { listingEngagementSchema } from '@/lib/business-records'
import { recordShopDailyEvent } from '@/lib/listing-analytics'
import { getSessionUser } from '@/lib/auth'
import { isAdminUser } from '@/lib/admin'
import { getClientIp } from '@/lib/client-ip'
import { hit } from '@/lib/rate-limit'

type Context = { params: Promise<{ id: string }> }
const MAX_EVENTS_PER_IP_PER_HOUR = 120
const EVENT_WINDOW_MS = 60 * 60 * 1000

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const { id } = await context.params
    const data = await parseBody(request, listingEngagementSchema)
    const shopOwner = await db.user.findUnique({ where: { id }, select: { id: true } })
    if (!shopOwner) throw new ApiError(404, 'This shop is no longer available')

    const viewer = await getSessionUser()
    if (viewer && (viewer.id === id || isAdminUser(viewer))) {
      return jsonOk({ recorded: false })
    }

    const ip = getClientIp(request)
    const verdict = await hit(`public-engagement:ip:${ip}`, MAX_EVENTS_PER_IP_PER_HOUR, EVENT_WINDOW_MS)
    if (!verdict.ok) throw new ApiError(429, 'Too many interactions. Please try again later.')

    await recordShopDailyEvent({
      ownerId: id,
      event: data.event === 'CALL_CLICK'
        ? 'CALL_CLICK'
        : data.event === 'WHATSAPP_CLICK'
          ? 'WHATSAPP_CLICK'
          : 'SHARE_CLICK',
    })
    return jsonOk({ recorded: true })
  })
}
