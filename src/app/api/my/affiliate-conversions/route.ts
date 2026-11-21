import { Prisma } from '@prisma/client'
import { route, jsonOk, parseBody, requireSeller, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { mvpConversionCreateSchema } from '@/lib/mvp-affiliates'

export async function GET() {
  return route(async () => {
    const user = await requireSeller()
    const conversions = await db.affiliateConversion.findMany({
      where: { merchantId: user.id },
      include: {
        mvp: { select: { id: true, name: true } },
        listing: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return jsonOk({ conversions: conversions.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      productSubtotal: Number(item.productSubtotal),
      commissionAmount: Number(item.commissionAmount),
      commissionValueSnapshot: Number(item.commissionValueSnapshot),
    })) })
  })
}

export async function POST(request: Request) {
  return route(async () => {
    const merchant = await requireSeller()
    const limit = await hit('mvp-conversion:create:' + merchant.id, 100, 60 * 60 * 1000)
    if (!limit.ok) throw new ApiError(429, 'You have recorded several partner sales recently. Try again later.')
    const data = await parseBody(request, mvpConversionCreateSchema)
    const referral = await db.affiliateReferral.findUnique({
      where: { code: data.referralCode },
      include: {
        partnership: {
          include: {
            offer: { include: { listing: { select: { id: true, userId: true, title: true, currency: true } } } },
          },
        },
      },
    })
    if (!referral) throw new ApiError(404, 'MVP referral code not found.')
    const partnership = referral.partnership
    const offer = partnership.offer
    if (offer.merchantId !== merchant.id || offer.listing.userId !== merchant.id) throw new ApiError(404, 'This referral does not belong to your shop.')
    if (!['APPROVED', 'PAUSED'].includes(partnership.status)) throw new ApiError(409, 'This MVP partnership is not active.')
    if (partnership.mvpId === merchant.id) throw new ApiError(409, 'Your own account cannot earn a commission from your shop.')
    if (offer.listing.currency !== offer.currency) throw new ApiError(409, 'The product currency has changed. Review this offer before recording a sale.')

    let enquiry = null
    if (data.enquiryId) {
      enquiry = await db.enquiry.findFirst({
        where: { id: data.enquiryId, listingId: offer.listingId, merchantId: merchant.id, affiliateReferralId: referral.id },
        select: { id: true, shopperId: true },
      })
      if (!enquiry) throw new ApiError(400, 'That enquiry is not linked to this MVP referral.')
      if (enquiry.shopperId === partnership.mvpId) throw new ApiError(409, 'An MVP cannot earn commission on their own purchase.')
    }

    const liveNow = offer.status === 'ACTIVE' &&
      (!offer.startsAt || offer.startsAt <= new Date()) &&
      (!offer.endsAt || offer.endsAt > new Date())
    if (!liveNow && !enquiry) throw new ApiError(409, 'This offer is not active. Use the original customer enquiry to record a sale from an earlier referral.')

    const subtotal = new Prisma.Decimal(data.productSubtotal.toFixed(2))
    const quantity = new Prisma.Decimal(data.quantity.toFixed(3))
    const value = new Prisma.Decimal(partnership.acceptedCommissionValue)
    const commission = partnership.acceptedCommissionType === 'PERCENT'
      ? subtotal.mul(value).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : quantity.mul(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    if (commission.lte(0) || commission.gt(subtotal)) throw new ApiError(400, 'The calculated partner reward is not valid for this sale.')
    const created = await db.$transaction(async (tx) => {
      const previous = await tx.affiliateConversion.findUnique({ where: { idempotencyKey: data.idempotencyKey } })
      if (previous) {
        if (previous.merchantId !== merchant.id) throw new ApiError(409, 'That request reference has already been used.')
        return { conversion: previous, replayed: true }
      }
      const conversion = await tx.affiliateConversion.create({
        data: {
          referralId: referral.id,
          partnershipId: partnership.id,
          offerId: offer.id,
          merchantId: merchant.id,
          mvpId: partnership.mvpId,
          listingId: offer.listingId,
          enquiryId: enquiry?.id ?? null,
          merchantOrderReference: data.merchantOrderReference?.trim() || null,
          idempotencyKey: data.idempotencyKey,
          quantity: quantity.toFixed(3),
          productSubtotal: subtotal.toFixed(2),
          commissionAmount: commission.toFixed(2),
          currency: offer.currency,
          commissionTypeSnapshot: partnership.acceptedCommissionType,
          commissionValueSnapshot: value.toFixed(2),
        },
      })
      await tx.affiliateConversionEvent.create({
        data: { conversionId: conversion.id, actorId: merchant.id, eventType: 'CONFIRMED', reason: 'Merchant reported a completed sale and confirmed the partner referral.' },
      })
      await tx.notification.create({
        data: {
          userId: partnership.mvpId,
          type: 'MVP_SALE_RECORDED',
          category: 'SOCIAL',
          priority: 'NORMAL',
          title: 'A shop recorded a sale from your recommendation',
          body: 'Your partner reward is waiting for the shop to clear it after its customer terms are met.',
          actionUrl: '/#/mvps',
          actionLabel: 'View your activity',
          dedupeKey: 'mvp-sale:' + conversion.id,
        },
      })
      return { conversion, replayed: false }
    })
    return jsonOk({
      conversion: {
        ...created.conversion,
        quantity: Number(created.conversion.quantity),
        productSubtotal: Number(created.conversion.productSubtotal),
        commissionAmount: Number(created.conversion.commissionAmount),
      },
      replayed: created.replayed,
    }, created.replayed ? 200 : 201)
  })
}
