import { randomBytes } from 'node:crypto'
import { route, jsonOk, parseBody, requireSeller, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'

type Context = { params: Promise<{ id: string }> }
const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']) })

export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const user = await requireSeller()
    const { id } = await context.params
    const { decision } = await parseBody(request, decisionSchema)
    const result = await db.$transaction(async (tx) => {
      const partnership = await tx.affiliatePartnership.findFirst({
        where: { id, offer: { merchantId: user.id }, status: 'PENDING' },
        include: { offer: true, mvp: { select: { name: true } }, referral: true },
      })
      if (!partnership) throw new ApiError(404, 'This MVP request is no longer waiting for a response.')
      if (decision === 'REJECT') {
        const updated = await tx.affiliatePartnership.update({
          where: { id },
          data: { status: 'REJECTED' },
        })
        return { id: updated.id, status: updated.status, referralUrl: null }
      }
      const code = randomBytes(18).toString('base64url')
      const updated = await tx.affiliatePartnership.update({
        where: { id },
        data: {
          status: 'APPROVED',
          acceptedAt: new Date(),
          referral: partnership.referral ? undefined : { create: { code } },
        },
        include: { referral: { select: { code: true } } },
      })
      return { id: updated.id, status: updated.status, referralUrl: updated.referral ? 'https://mudaala.store/r/' + updated.referral.code : null }
    })
    return jsonOk({ partnership: result })
  })
}
