import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { mvpDisputeSchema } from '@/lib/mvp-affiliates'

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const mvp = await requireUser('Sign in to contact the shop about a partner reward')
    const { id } = await context.params
    const { reason } = await parseBody(request, mvpDisputeSchema)
    const conversion = await db.affiliateConversion.findFirst({ where: { id, mvpId: mvp.id } })
    if (!conversion) throw new ApiError(404, 'Partner reward not found')
    if (!['PENDING', 'CLEARED'].includes(conversion.status)) throw new ApiError(409, 'This reward cannot be disputed in its current state.')
    const updated = await db.$transaction(async (tx) => {
      const changed = await tx.affiliateConversion.updateMany({
        where: { id, mvpId: mvp.id, status: conversion.status },
        data: { status: 'DISPUTED', statusReason: reason },
      })
      if (changed.count !== 1) throw new ApiError(409, 'This reward has changed. Refresh and try again.')
      await tx.affiliateConversionEvent.create({ data: { conversionId: id, actorId: mvp.id, eventType: 'DISPUTED', reason } })
      await tx.notification.create({
        data: {
          userId: conversion.merchantId,
          type: 'MVP_REWARD_DISPUTED',
          category: 'SOCIAL',
          priority: 'HIGH',
          title: 'An MVP has a question about a reward',
          body: 'Review the partner reward and respond in Mudaala.',
          actionUrl: '/#/mvps',
          actionLabel: 'Review reward',
          dedupeKey: 'mvp-dispute:' + id,
        },
      })
      return tx.affiliateConversion.findUniqueOrThrow({ where: { id } })
    })
    return jsonOk({ conversion: { id: updated.id, status: updated.status } })
  })
}
