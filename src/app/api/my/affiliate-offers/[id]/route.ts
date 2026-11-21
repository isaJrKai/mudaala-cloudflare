import { route, jsonOk, parseBody, requireSeller, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { mvpOfferUpdateSchema } from '@/lib/mvp-affiliates'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const user = await requireSeller()
    const { id } = await context.params
    const data = await parseBody(request, mvpOfferUpdateSchema)
    const offer = await db.affiliateOffer.findFirst({
      where: { id, merchantId: user.id },
      select: { id: true, status: true, commissionType: true },
    })
    if (!offer) throw new ApiError(404, 'MVP offer not found')
    const existingAccepted = await db.affiliatePartnership.count({
      where: { offerId: id, status: { in: ['APPROVED', 'PAUSED'] } },
    })
    // Existing MVPs keep the rate they accepted. The public offer can change
    // for new applicants, but accepted agreements are immutable snapshots.
    if (data.commissionValue !== undefined && existingAccepted > 0 && offer.status === 'ACTIVE') {
      throw new ApiError(409, 'This offer already has approved MVPs. Create a new offer to advertise a different rate.')
    }
    const updated = await db.affiliateOffer.update({
      where: { id },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.commissionValue !== undefined ? { commissionValue: data.commissionValue.toFixed(2) } : {}),
        ...(data.termsText !== undefined ? { termsText: data.termsText } : {}),
      },
    })
    return jsonOk({ offer: { ...updated, commissionValue: Number(updated.commissionValue) } })
  })
}
