import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { ApiError, jsonOk, parseBody, route } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return route(async () => {
    const body = await parseBody(request, z.object({ listingId: z.string().min(1).max(128) }))
    const clientIp = getClientIp(request)
    const limit = await hit('telegram:contact-token:' + clientIp, 10, 60 * 60 * 1000)
    if (!limit.ok) throw new ApiError(429, 'Please wait before starting another seller enquiry.')
    const viewer = await getSessionUser()
    const listing = await db.listing.findFirst({
      where: { id: body.listingId, type: 'OFFER', status: 'ACTIVE', isSeed: false, expiresAt: { gt: new Date() } },
      select: { id: true, userId: true, title: true, user: { select: { profile: { select: { id: true } } } } },
    })
    if (!listing) throw new ApiError(404, 'This listing is no longer available.')
    if (!listing.user.profile) throw new ApiError(409, 'This seller does not have an active shop profile.')
    if (viewer?.id === listing.userId) throw new ApiError(409, 'You cannot send an enquiry to your own shop.')
    const setting = await db.appSetting.findUnique({ where: { key: 'telegram:merchant:' + listing.userId } })
    if (!setting) throw new ApiError(409, 'This seller has not enabled Telegram enquiries. Try their phone or WhatsApp contact instead.')
    let merchant: { enabled?: unknown; activatedAt?: unknown; chatId?: unknown }
    try { merchant = JSON.parse(setting.value) as typeof merchant } catch { merchant = {} }
    if (merchant.enabled !== true || typeof merchant.activatedAt !== 'string' || !Number.isSafeInteger(merchant.chatId)) {
      throw new ApiError(409, 'This seller is not currently accepting Telegram enquiries. Try their phone or WhatsApp contact instead.')
    }
    // Keep abandoned capabilities bounded even when webhook traffic is low.
    // Retain the most recent expired day for diagnostics and support.
    await db.enquiryContactToken.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    })
    const raw = randomBytes(24).toString('base64url')
    const tokenHash = createHash('sha256').update(raw).digest('hex')
    await db.enquiryContactToken.create({
      // The account is only attached after the Telegram identity proves the
    // same account through the one-time /link CODE flow in the bot.
    data: { tokenHash, listingId: listing.id, merchantId: listing.userId, shopperId: viewer?.id ?? null, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    })
    return jsonOk({
      url: 'https://t.me/MudaalaMerchantbot?start=' + raw,
      expiresInSeconds: 600,
      listingTitle: listing.title,
    }, 201)
  })
}
