import { route, jsonOk, parseBody, requireSeller, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { mvpOfferCreateSchema } from '@/lib/mvp-affiliates'

export async function GET() {
  return route(async () => {
    const user = await requireSeller()
    const offers = await db.affiliateOffer.findMany({
      where: { merchantId: user.id },
      include: {
        listing: { select: { id: true, title: true, price: true, currency: true, photos: true, status: true } },
        partnerships: {
          include: {
            mvp: { select: { id: true, name: true } },
            referral: { select: { code: true, clickCount: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        _count: { select: { conversions: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
    return jsonOk({ offers: offers.map((offer) => ({
      ...offer,
      commissionValue: Number(offer.commissionValue),
      partnerships: offer.partnerships.map((partner) => ({
        ...partner,
        acceptedCommissionValue: Number(partner.acceptedCommissionValue),
      })),
    })) })
  })
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireSeller()
    const limit = await hit('mvp-offer:create:' + user.id, 20, 60 * 60 * 1000)
    if (!limit.ok) throw new ApiError(429, 'You have created several offers recently. Try again later.')
    const data = await parseBody(request, mvpOfferCreateSchema)
    const listing = await db.listing.findFirst({
      where: {
        id: data.listingId,
        userId: user.id,
        type: 'OFFER',
        status: 'ACTIVE',
        isSeed: false,
        expiresAt: { gt: new Date() },
        user: { profile: { is: { moderationStatus: 'ACTIVE', isSeed: false } } },
      },
      select: { id: true, currency: true },
    })
    if (!listing) throw new ApiError(404, 'Choose one of your active products from an active shop.')
    const existing = await db.affiliateOffer.findFirst({
      where: { listingId: listing.id, status: 'ACTIVE' },
      select: { id: true },
    })
    if (existing) throw new ApiError(409, 'This product already has an active MVP offer. Pause it before creating another.')
    const offer = await db.affiliateOffer.create({
      data: {
        merchantId: user.id,
        listingId: listing.id,
        commissionType: data.commissionType,
        commissionValue: data.commissionValue.toFixed(2),
        currency: listing.currency,
        applicationMode: data.applicationMode,
        attributionWindowDays: data.attributionWindowDays,
        termsText: data.termsText,
      },
      include: { listing: { select: { id: true, title: true } } },
    })
    return jsonOk({
      offer: { ...offer, commissionValue: Number(offer.commissionValue) },
    }, 201)
  })
}
