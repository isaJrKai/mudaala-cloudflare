import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

// Create or continue a private, in-app buyer-to-merchant conversation.
// The enquiry is durable even when the merchant is offline; Telegram is not
// required for this channel.
export async function POST(request: Request) {
  return route(async () => {
    const shopper = await requireUser('Sign in to message this seller')
    const limit = await hit('enquiry:create:user:' + shopper.id, 10, 5 * 60 * 1000)
    if (!limit.ok) throw new ApiError(429, 'Please wait a few minutes before sending another enquiry.')

    const body = await parseBody(request, z.object({
      listingId: z.string().trim().min(1).max(128),
      message: z.string().trim().min(1).max(1200),
    }))
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
        title: true,
        userId: true,
        user: { select: { profile: { select: { businessName: true } } } },
      },
    })
    if (!listing) throw new ApiError(404, 'This product is no longer available.')
    if (listing.userId === shopper.id) throw new ApiError(409, 'You cannot send an enquiry to your own shop.')
    if (!listing.user.profile) throw new ApiError(409, 'This seller does not have an active shop.')

    const created = await db.$transaction(async (tx) => {
      let enquiry = await tx.enquiry.findFirst({
        where: {
          listingId: listing.id,
          merchantId: listing.userId,
          shopperId: shopper.id,
          status: 'OPEN',
          contactChannel: 'WEB',
        },
        select: { id: true },
      })
      if (!enquiry) {
        enquiry = await tx.enquiry.create({
          data: {
            listingId: listing.id,
            merchantId: listing.userId,
            shopperId: shopper.id,
            contactChannel: 'WEB',
          },
          select: { id: true },
        })
      }

      const message = await tx.enquiryMessage.create({
        data: {
          enquiryId: enquiry.id,
          senderType: 'SHOPPER',
          senderUserId: shopper.id,
          body: body.message,
          // For WEB, SENT means durably accepted into the Mudaala thread;
          // it does not claim that the merchant has read the message.
          deliveryStatus: 'SENT',
        },
        select: { id: true, createdAt: true },
      })
      await tx.enquiry.update({
        where: { id: enquiry.id },
        data: { lastMessageAt: message.createdAt },
      })
      await tx.notification.create({
        data: {
          userId: listing.userId,
          type: 'NEW_ENQUIRY',
          category: 'SOCIAL',
          priority: 'HIGH',
          title: 'New customer enquiry',
          body: shopper.name + ' sent a message about ' + listing.title + '.',
          listingId: listing.id,
          actionUrl: '/#/enquiries',
          actionLabel: 'Open enquiry',
          dedupeKey: 'enquiry-message:' + message.id,
        },
      })
      return { enquiryId: enquiry.id, messageId: message.id }
    }, { isolationLevel: 'Serializable' })

    return jsonOk({
      enquiry: { id: created.enquiryId, listingId: listing.id, listingTitle: listing.title },
      messageId: created.messageId,
      shopName: listing.user.profile.businessName || 'Mudaala shop',
    }, 201)
  })
}
