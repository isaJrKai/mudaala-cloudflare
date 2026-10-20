import { route, jsonOk, parseBody, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { listingEngagementSchema } from '@/lib/business-records'
import { recordListingDailyEvent } from '@/lib/listing-analytics'
import { getSessionUser } from '@/lib/auth'
import { isAdminUser } from '@/lib/admin'
import { getClientIp } from '@/lib/client-ip'
import { hit } from '@/lib/rate-limit'

type Context = { params: Promise<{ id: string }> }
const MAX_EVENTS_PER_IP_PER_HOUR = 120
const EVENT_WINDOW_MS = 60 * 60 * 1000

// Count explicit customer actions as privacy-safe daily aggregates. This is
// deliberately not a purchase endpoint and stores no viewer identity or IP.
export async function POST(request: Request, context: Context) {
  return route(async () => {
    const { id } = await context.params
    const data = await parseBody(request, listingEngagementSchema)
    const listing = await db.listing.findFirst({
      where: { id, status: 'ACTIVE' },
      select: { id: true, userId: true, title: true },
    })
    if (!listing) throw new ApiError(404, 'This ad is no longer available')

    const viewer = await getSessionUser()
    // Owners previewing their own ad and admins inspecting it must not inflate
    // customer engagement figures. Response shape stays generic either way.
    if (viewer && (viewer.id === listing.userId || isAdminUser(viewer))) {
      return jsonOk({ recorded: false })
    }

    const ip = getClientIp(request)
    const verdict = await hit(`public-engagement:ip:${ip}`, MAX_EVENTS_PER_IP_PER_HOUR, EVENT_WINDOW_MS)
    if (!verdict.ok) throw new ApiError(429, 'Too many interactions. Please try again later.')

    await recordListingDailyEvent({
      listingId: listing.id,
      ownerId: listing.userId,
      listingTitle: listing.title,
      event: data.event,
    })
    return jsonOk({ recorded: true })
  })
}
