import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { ApiError, jsonOk, parseBody, route } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'\nimport { getClientIp } from '@/lib/client-ip'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return route(async () => {
    const body = await parseBody(request, z.object({ listingId: z.string().min(1).max(128) }))
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const limit = await hit('telegram:contact-token:' + forwarded, 10, 60 * 60 * 1000)
    if (!limit.ok) throw new ApiError(429, 'Please wait before starting another seller enquiry.')
    const listing = await db.listing.findFirst({
      where: { id: body.listingId, type: 'OFFER', status: 'ACTIVE', isSeed: false, expiresAt: { gt: new Date() } },
      select: { id: true, userId: true, title: true },
    })
    if (!listing) throw new ApiError(404, 'This listing is no longer available.')
    const setting = await db.appSetting.findUnique({ where: { key: 'telegram:merchant:' + listing.userId } })
    if (!setting) throw new ApiError(409, 'This seller has not enabled Telegram enquiries. Try their phone or WhatsApp contact instead.')
    let merchant: { enabled?: unknown; activatedAt?: unknown; chatId?: unknown }
    try { merchant = JSON.parse(setting.value) as typeof merchant } catch { merchant = {} }
    if (merchant.enabled !== true || typeof merchant.activatedAt !== 'string' || !Number.isSafeInteger(merchant.chatId)) {
      throw new ApiError(409, 'This seller is not currently accepting Telegram enquiries. Try their phone or WhatsApp contact instead.')
    }
    const raw = randomBytes(24).toString('base64url')
    const tokenHash = createHash('sha256').update(raw).digest('hex')
    await db.enquiryContactToken.create({
      data: { tokenHash, listingId: listing.id, merchantId: listing.userId, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    })
    return jsonOk({
      url: 'https://t.me/MudaalaMerchantbot?start=' + raw,
      expiresInSeconds: 600,
      listingTitle: listing.title,
    }, 201)
  })
}
