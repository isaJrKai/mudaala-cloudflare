import { route, jsonOk, parseBody, requireSeller, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { mvpConversionUpdateSchema } from '@/lib/mvp-affiliates'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const merchant = await requireSeller()
    const { id } = await context.params
    const data = await parseBody(request, mvpConversionUpdateSchema)
    const conversion = await db.affiliateConversion.findFirst({ where: { id, merchantId: merchant.id } })
    if (!conversion) throw new ApiError(404, 'Partner sale not found')

    let nextStatus = conversion.status
    let eventType = data.action
    const update: Record<string, unknown> = {}
    if (data.action === 'CLEAR') {
      if (!['PENDING', 'DISPUTED'].includes(conversion.status)) throw new ApiError(409, 'Only a waiting or resolved disputed reward can be cleared.')
      nextStatus = 'CLEARED'
      update.status = nextStatus
      update.clearedAt = new Date()
      update.statusReason = data.reason?.trim() || null
    } else if (data.action === 'RECORD_PAYMENT') {
      if (conversion.status !== 'CLEARED') throw new ApiError(409, 'Clear the reward before recording its payment.')
      nextStatus = 'PAID'
      update.status = nextStatus
      update.paidAt = new Date()
      update.paymentChannel = data.paymentChannel
      update.paymentReference = data.paymentReference
    } else {
      if (!['PENDING', 'CLEARED', 'DISPUTED'].includes(conversion.status)) throw new ApiError(409, 'This reward can no longer be reversed.')
      nextStatus = 'REVERSED'
      update.status = nextStatus
      update.statusReason = data.reason
    }
    const result = await db.$transaction(async (tx) => {
      const changed = await tx.affiliateConversion.updateMany({
        where: { id, merchantId: merchant.id, status: conversion.status },
        data: update,
      })
      if (changed.count !== 1) throw new ApiError(409, 'This partner reward has changed. Refresh and try again.')
      const updated = await tx.affiliateConversion.findUniqueOrThrow({ where: { id } })
      await tx.affiliateConversionEvent.create({
        data: { conversionId: id, actorId: merchant.id, eventType, reason: data.action === 'REVERSE' ? data.reason : data.action === 'CLEAR' ? (data.reason || 'Merchant confirmed the customer terms are complete.') : 'Merchant recorded a direct payment. This is a merchant record, not a payment verified by Mudaala.' },
      })
      return updated
    })
    return jsonOk({
      conversion: {
        ...result,
        quantity: Number(result.quantity),
        productSubtotal: Number(result.productSubtotal),
        commissionAmount: Number(result.commissionAmount),
      },
      note: data.action === 'RECORD_PAYMENT' ? 'Payment recorded by the shop. Mudaala has not independently verified the transfer.' : undefined,
    })
  })
}
