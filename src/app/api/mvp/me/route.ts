import { route, jsonOk, requireUser } from '@/lib/api'
import { db } from '@/lib/db'

export async function GET() {
  return route(async () => {
    const user = await requireUser('Sign in to see your MVP activity')
    const partnerships = await db.affiliatePartnership.findMany({
      where: { mvpId: user.id },
      include: {
        offer: {
          include: {
            listing: { select: { id: true, title: true, price: true, currency: true, photos: true, status: true } },
            merchant: { select: { id: true, name: true, profile: { select: { businessName: true } } } },
          },
        },
        referral: { select: { code: true, clickCount: true, lastClickedAt: true } },
        conversions: { orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, quantity: true, productSubtotal: true, commissionAmount: true, currency: true, status: true, confirmedAt: true, clearedAt: true, paidAt: true, paymentChannel: true, paymentReference: true, statusReason: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
    return jsonOk({
      partnerships: partnerships.map((partnership) => ({
        id: partnership.id,
        status: partnership.status,
        acceptedCommissionType: partnership.acceptedCommissionType,
        acceptedCommissionValue: Number(partnership.acceptedCommissionValue),
        acceptedCurrency: partnership.acceptedCurrency,
        acceptedTermsText: partnership.acceptedTermsText,
        acceptedAt: partnership.acceptedAt,
        referral: partnership.referral ? {
          url: 'https://mudaala.store/r/' + partnership.referral.code,
          code: partnership.referral.code,
          clickCount: partnership.referral.clickCount,
          lastClickedAt: partnership.referral.lastClickedAt,
        } : null,
        offer: {
          id: partnership.offer.id,
          status: partnership.offer.status,
          listing: partnership.offer.listing,
          merchantName: partnership.offer.merchant.profile?.businessName?.trim() || partnership.offer.merchant.name,
        },
        conversions: partnership.conversions.map((conversion) => ({
          ...conversion,
          quantity: Number(conversion.quantity),
          productSubtotal: Number(conversion.productSubtotal),
          commissionAmount: Number(conversion.commissionAmount),
        })),
      })),
    })
  })
}
