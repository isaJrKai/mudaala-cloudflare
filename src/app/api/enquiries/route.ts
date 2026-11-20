import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type EnquiryInboxRow = {
  id: string
  status: string
  followUpConsentAt: Date | null
  merchantId: string
  shopperId: string | null
  listingId: string
  listingTitle: string
  listingStatus: string
  sellerPhone: string
  shopName: string | null
  messageBody: string | null
  messageSenderType: string | null
  messageCreatedAt: Date | null
  messageDeliveryStatus: string | null
  lastMessageAt: Date
}

export async function GET() {
  return route(async () => {
    const user = await requireUser()

    // Keep the inbox read to one indexed SQL query. Prisma's nested
    // relation include for 100 enquiries caused excessive Worker CPU use
    // when it also built a per-enquiry latest-message relation.
    const rows = await db.$queryRaw<EnquiryInboxRow[]>(Prisma.sql`
      SELECT
        e."id",
        e."status",
        e."followUpConsentAt",
        e."merchantId",
        e."shopperId",
        e."listingId",
        l."title" AS "listingTitle",
        l."status" AS "listingStatus",
        l."contactPhone" AS "sellerPhone",
        bp."businessName" AS "shopName",
        latest."body" AS "messageBody",
        latest."senderType" AS "messageSenderType",
        latest."createdAt" AS "messageCreatedAt",
        latest."deliveryStatus" AS "messageDeliveryStatus",
        e."lastMessageAt"
      FROM "Enquiry" e
      INNER JOIN "Listing" l ON l."id" = e."listingId"
      INNER JOIN "User" merchant ON merchant."id" = e."merchantId"
      LEFT JOIN "BusinessProfile" bp ON bp."userId" = merchant."id"
      LEFT JOIN LATERAL (
        SELECT m."body", m."senderType", m."createdAt", m."deliveryStatus"
        FROM "EnquiryMessage" m
        WHERE m."enquiryId" = e."id"
        ORDER BY m."createdAt" DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE e."merchantId" = ${user.id} OR e."shopperId" = ${user.id}
      ORDER BY e."lastMessageAt" DESC
      LIMIT 100
    `)

    return jsonOk({ enquiries: rows.map((item) => ({
      id: item.id,
      status: item.status,
      followUpConsentAt: item.followUpConsentAt,
      role: item.merchantId === user.id ? 'MERCHANT' : 'SHOPPER',
      listing: { id: item.listingId, title: item.listingTitle, status: item.listingStatus },
      // The seller's phone is revealed only to the buyer who already opened
      // this private enquiry. Merchant inboxes never receive shopper numbers.
      sellerPhone: item.shopperId === user.id ? item.sellerPhone : null,
      shopName: item.shopName || 'Mudaala shop',
      lastMessage: item.messageBody === null ? null : {
        body: item.messageBody,
        senderType: item.messageSenderType,
        createdAt: item.messageCreatedAt,
        deliveryStatus: item.messageDeliveryStatus,
      },
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
      variantId: z.string().trim().min(1).max(128).optional(),
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
        currency: true,
        price: true,
        variants: { select: { id: true, label: true, options: true, sku: true, price: true, availabilityStatus: true, trackInventory: true, stockQuantity: true } },
        user: { select: { profile: { select: { businessName: true } } } },
      },
    })
    if (!listing) throw new ApiError(404, 'This product is no longer available.')
    if (listing.userId === shopper.id) throw new ApiError(409, 'You cannot send an enquiry to your own shop.')
    if (!listing.user.profile) throw new ApiError(409, 'This seller does not have an active shop.')
    const selectedVariant = body.variantId
      ? listing.variants.find((variant) => variant.id === body.variantId)
      : null
    if (body.variantId && !selectedVariant) throw new ApiError(400, 'Choose a valid option for this product.')
    if (selectedVariant?.availabilityStatus === 'OUT_OF_STOCK' || (selectedVariant?.trackInventory && (selectedVariant.stockQuantity ?? 0) <= 0)) {
      throw new ApiError(409, 'That option is currently out of stock.')
    }
    const variantSnapshot = selectedVariant ? {
      id: selectedVariant.id,
      label: selectedVariant.label,
      options: selectedVariant.options,
      sku: selectedVariant.sku,
      price: selectedVariant.price ?? listing.price ?? null,
      currency: listing.currency,
      trackInventory: selectedVariant.trackInventory,
      stockQuantity: selectedVariant.stockQuantity,
      availabilityStatus: selectedVariant.availabilityStatus,
    } : undefined

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
            ...(selectedVariant ? { variantId: selectedVariant.id, variantSnapshot } : {}),
          },
          select: { id: true },
        })
      }

      const message = await tx.enquiryMessage.create({
        data: {
          enquiryId: enquiry.id,
          senderType: 'SHOPPER',
          senderUserId: shopper.id,
          body: body.message + (selectedVariant
            ? '\n\nSelected option: ' + selectedVariant.label + (selectedVariant.sku ? ' · SKU ' + selectedVariant.sku : '') + ' · Price: ' + (selectedVariant.price ?? listing.price ?? 'Ask seller') + ' ' + listing.currency
            : ''),
          // For WEB, SENT means durably accepted into the Mudaala thread;
          // it does not claim that the merchant has read the message.
          deliveryStatus: 'SENT',
        },
        select: { id: true, createdAt: true },
      })
      await tx.enquiry.update({
        where: { id: enquiry.id },
        data: {
          lastMessageAt: message.createdAt,
          variantId: selectedVariant?.id ?? null,
          variantSnapshot: selectedVariant ? variantSnapshot : Prisma.DbNull,
        },
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
