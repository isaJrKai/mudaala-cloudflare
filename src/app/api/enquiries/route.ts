import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const createSchema = z.object({
  listingId: z.string().min(1).max(128),
  message: z.string().trim().min(1).max(1200),
})

export async function GET() {
  return route(async () => {
    const user = await requireUser()
    const items = await db.enquiry.findMany({
      where: { OR: [{ merchantId: user.id }, { shopperId: user.id }] },
      include: {
        listing: { select: { id: true, title: true, status: true } },
        merchant: { select: { profile: { select: { businessName: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, senderType: true, createdAt: true, deliveryStatus: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    })
    return jsonOk({ enquiries: items.map((item) => ({
      id: item.id,
      status: item.status,
      followUpConsentAt: item.followUpConsentAt,
      role: item.merchantId === user.id ? 'MERCHANT' : 'SHOPPER',
      listing: item.listing,
      shopName: item.merchant.profile?.businessName || 'Mudaala shop',
      lastMessage: item.messages[0] || null,
      lastMessageAt: item.lastMessageAt,
    })) })
  })
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const limit = await hit('enquiry:create:user:' + user.id, 12, 10 * 60 * 1000)
    if (!limit.ok) throw new ApiError(429, 'Please wait before sending another enquiry.')
    const body = await parseBody(request, createSchema)
    const listing = await db.listing.findFirst({
      where: {
        id: body.listingId,
        type: 'OFFER',
        status: 'ACTIVE',
        isSeed: false,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        userId: true,
        title: true,
        user: { select: { name: true, profile: { select: { businessName: true } } } },
      },
    })
    if (!listing) throw new ApiError(404, 'This product is no longer available.')
    if (listing.userId === user.id) throw new ApiError(409, 'You cannot send an enquiry to your own shop.')

    const created = await db.$transaction(async (tx) => {
      const existing = await tx.enquiry.findFirst({
        where: {
          listingId: listing.id,
          merchantId: listing.userId,
          shopperId: user.id,
          status: 'OPEN',
        },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true },
      })
      const enquiry = existing ?? await tx.enquiry.create({
        data: {
          listingId: listing.id,
          merchantId: listing.userId,
          shopperId: user.id,
          status: 'OPEN',
          contactChannel: 'IN_APP',
        },
        select: { id: true },
      })
      const message = await tx.enquiryMessage.create({
        data: {
          enquiryId: enquiry.id,
          senderType: 'SHOPPER',
          senderUserId: user.id,
          body: body.message,
          deliveryStatus: 'SENT',
        },
        select: { id: true, body: true, senderType: true, createdAt: true, deliveryStatus: true },
      })
      await tx.enquiry.update({ where: { id: enquiry.id }, data: { lastMessageAt: message.createdAt } })
      await tx.notification.create({
        data: {
          userId: listing.userId,
          type: 'NEW_ENQUIRY',
          category: 'SOCIAL',
          priority: 'HIGH',
          title: 'New customer enquiry',
          body: (user.name || 'A customer') + ' sent a message about ' + listing.title + '.',
          listingId: listing.id,
          dedupeKey: 'enquiry-message:' + message.id,
        },
      })
      return { id: enquiry.id, message }
    })

    return jsonOk({
      enquiry: { id: created.id, listingId: listing.id, shopName: listing.user.profile?.businessName || 'Mudaala shop' },
      message: created.message,
    }, 201)
  })
}
