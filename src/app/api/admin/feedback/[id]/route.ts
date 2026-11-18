// PATCH /api/admin/feedback/:id - triage feedback and decide restriction appeals.
import { route, jsonOk, parseBody, ApiError } from '@/lib/api'
import { requireAdmin } from '@/lib/admin'
import { feedbackAdminUpdateSchema } from '@/lib/validation'
import { applyShopModeration } from '@/lib/admin-shop-moderation'
import { db } from '@/lib/db'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const admin = await requireAdmin('Only the Mudaala admin can update feedback')
    const { id } = await params
    const changes = await parseBody(request, feedbackAdminUpdateSchema)
    const existing = await db.feedback.findUnique({
      where: { id },
      select: {
        id: true, category: true, appealTargetType: true, appealTargetId: true,
        appealDecision: true,
      },
    })
    if (!existing) throw new ApiError(404, 'This feedback item no longer exists')

    if (changes.appealDecision !== undefined) {
      if (existing.category !== 'APPEAL' || !existing.appealTargetType || !existing.appealTargetId) {
        throw new ApiError(409, 'This feedback item is not a linked restriction appeal')
      }
      if (existing.appealDecision) throw new ApiError(409, 'A decision has already been recorded for this appeal')
      const reason = changes.appealDecisionReason!
      await db.$transaction(async (tx) => {
        if (changes.appealDecision === 'REVERSED') {
          if (existing.appealTargetType === 'USER') {
            const target = await tx.user.findUnique({
              where: { id: existing.appealTargetId! },
              select: { id: true, suspendedAt: true },
            })
            if (!target?.suspendedAt) throw new ApiError(409, 'This account is no longer suspended')
            await tx.user.update({
              where: { id: target.id },
              data: { suspendedAt: null, suspensionReason: null, suspendedBy: null },
            })
            await tx.notification.create({
              data: {
                userId: target.id,
                type: 'ACCOUNT_REINSTATED',
                title: 'Your Mudaala account has been reinstated',
                body: 'Your appeal was accepted. You can sign in again using your usual login details.',
              },
            })
            await tx.auditLog.create({
              data: { actorId: admin.id, action: 'REINSTATE_ACCOUNT', targetType: 'USER', targetId: target.id, reason },
            })
          } else if (existing.appealTargetType === 'SHOP') {
            const shop = await tx.businessProfile.findUnique({
              where: { id: existing.appealTargetId! },
              select: { id: true, moderationStatus: true },
            })
            if (!shop || shop.moderationStatus !== 'HIDDEN') throw new ApiError(409, 'This shop is no longer hidden')
            const activeViolations = await tx.policyViolation.updateMany({
              where: { targetType: 'SHOP', targetId: shop.id, reversedAt: null },
              data: { reversedAt: new Date(), reversedBy: admin.id, activeKey: null },
            })
            if (activeViolations.count > 0) {
              await tx.auditLog.create({
                data: { actorId: admin.id, action: 'REVERSE_VIOLATION', targetType: 'SHOP', targetId: shop.id, reason },
              })
            }
            const result = await applyShopModeration(tx, {
              profileId: shop.id, actorId: admin.id, action: 'RESTORE', reason,
            })
            if (!result.ok) throw new ApiError(409, result.error)
          } else if (existing.appealTargetType === 'LISTING') {
            const listing = await tx.listing.findUnique({
              where: { id: existing.appealTargetId! },
              select: { id: true, userId: true, title: true, status: true },
            })
            if (!listing || listing.status !== 'HIDDEN') throw new ApiError(409, 'This listing is no longer hidden')
            const activeViolations = await tx.policyViolation.updateMany({
              where: { targetType: 'LISTING', targetId: listing.id, reversedAt: null },
              data: { reversedAt: new Date(), reversedBy: admin.id, activeKey: null },
            })
            if (activeViolations.count > 0) {
              await tx.auditLog.create({
                data: { actorId: admin.id, action: 'REVERSE_VIOLATION', targetType: 'LISTING', targetId: listing.id, reason },
              })
            }
            await tx.listing.update({ where: { id: listing.id }, data: { status: 'ACTIVE' } })
            await tx.notification.create({
              data: {
                userId: listing.userId,
                type: 'LISTING_RESTORED',
                title: 'Your listing has been restored',
                body: 'Your appeal was accepted and the listing is visible to buyers again.',
                listingId: listing.id,
              },
            })
            await tx.auditLog.create({
              data: { actorId: admin.id, action: 'RESTORE_LISTING', targetType: 'LISTING', targetId: listing.id, reason },
            })
          }
        }

        await tx.feedback.update({
          where: { id },
          data: {
            appealDecision: changes.appealDecision,
            appealDecisionReason: reason,
            status: 'RESOLVED',
          },
        })
        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: changes.appealDecision === 'REVERSED' ? 'APPEAL_REVERSED' : 'APPEAL_UPHELD',
            targetType: 'FEEDBACK',
            targetId: id,
            reason,
          },
        })
      })
      return jsonOk({ ok: true, appealDecision: changes.appealDecision })
    }

    await db.$transaction(async (tx) => {
      await tx.feedback.update({ where: { id }, data: changes })
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: 'UPDATE_FEEDBACK',
          targetType: 'FEEDBACK',
          targetId: id,
        },
      })
    })
    return jsonOk({ ok: true })
  })
}
