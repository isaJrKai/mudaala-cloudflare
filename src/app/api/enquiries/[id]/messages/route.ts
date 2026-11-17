import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'
import { createHash } from 'node:crypto'
import { hit } from '@/lib/rate-limit'
import { telegramApiUrl } from '@/lib/telegram-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function deliverTelegram(chatId: number, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return false
  try {
    const response = await fetch(telegramApiUrl(token, 'sendMessage'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return false
    const result = await response.json() as { ok?: boolean }
    return result.ok === true
  } catch { return false }
}

export async function GET(_request: Request, { params }: Params) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await params
    const enquiry = await db.enquiry.findFirst({
      where: { id, OR: [{ merchantId: user.id }, { shopperId: user.id }] },
      select: { id: true },
    })
    if (!enquiry) throw new ApiError(404, 'Enquiry not found.')
    const messages = await db.enquiryMessage.findMany({
      where: { enquiryId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, senderType: true, body: true, deliveryStatus: true, createdAt: true },
    })
    return jsonOk({ messages })
  })
}

export async function POST(request: Request, { params }: Params) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await params
    const limit = await hit('enquiry:message:user:' + user.id, 20, 5 * 60 * 1000)
    if (!limit.ok) throw new ApiError(429, 'You are sending messages too quickly. Please wait a few minutes.')
    const body = await parseBody(request, z.object({ message: z.string().trim().min(1).max(1200) }))
    const enquiry = await db.enquiry.findFirst({
      where: { id, status: 'OPEN', OR: [{ merchantId: user.id }, { shopperId: user.id }] },
      select: { id: true, merchantId: true, shopperId: true, buyerTelegramHash: true, listingId: true, listing: { select: { title: true } } },
    })
    if (!enquiry) throw new ApiError(404, 'Open enquiry not found.')
    const senderType = enquiry.merchantId === user.id ? 'MERCHANT' : 'SHOPPER'
    const created = await db.enquiryMessage.create({
      data: { enquiryId: id, senderType, senderUserId: user.id, body: body.message, deliveryStatus: 'PENDING' },
      select: { id: true, senderType: true, body: true, createdAt: true },
    })
    await db.enquiry.update({ where: { id }, data: { lastMessageAt: created.createdAt } })

    const recipientId = senderType === 'MERCHANT' ? enquiry.shopperId : enquiry.merchantId
    if (recipientId) {
      await db.notification.create({
        data: {
          userId: recipientId,
          type: 'NEW_ENQUIRY_MESSAGE',
          category: 'SOCIAL',
          priority: 'HIGH',
          title: 'New message about ' + enquiry.listing.title,
          body: senderType === 'MERCHANT' ? 'The shop replied to your enquiry.' : 'A customer sent a message about a product.',
          listingId: enquiry.listingId,
          dedupeKey: 'enquiry-message:' + created.id,
        },
      }).catch(() => undefined)
    }

    let chatId: number | null = null
    if (senderType === 'MERCHANT') {
      const identityHash = enquiry.buyerTelegramHash || (enquiry.shopperId ? createHash('sha256').update(enquiry.shopperId).digest('hex') : null)
      if (identityHash) {
        const chatKey = enquiry.buyerTelegramHash
          ? 'telegram:buyer-chat:' + enquiry.buyerTelegramHash
          : 'telegram:chat:' + identityHash
        const record = await db.appSetting.findUnique({ where: { key: chatKey } })
        const value = record?.value ? Number(record.value) : NaN
        if (Number.isSafeInteger(value)) chatId = value
      }
    } else {
      const record = await db.appSetting.findUnique({ where: { key: 'telegram:merchant:' + enquiry.merchantId } })
      if (record) {
        try {
          const settings = JSON.parse(record.value) as { activatedAt?: unknown; chatId?: unknown }
          if (typeof settings.activatedAt === 'string' && Number.isSafeInteger(settings.chatId)) chatId = settings.chatId as number
        } catch { /* no active Telegram destination */ }
      }
    }
    const delivered = chatId !== null && await deliverTelegram(chatId, 'Mudaala enquiry · ' + enquiry.listing.title + '\n\n' + body.message)
    // A message persisted in Mudaala is available in both participants' inboxes.
    // Telegram is an optional relay, so an unlinked Telegram account is not a
    // failure of the in-app conversation.
    const deliveryStatus = chatId === null || delivered ? 'SENT' : 'FAILED'
    await db.enquiryMessage.update({ where: { id: created.id }, data: { deliveryStatus } })
    return jsonOk({ message: { ...created, deliveryStatus } }, 201)
  })
}
