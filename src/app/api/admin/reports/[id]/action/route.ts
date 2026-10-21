// POST /api/admin/reports/:id/action - moderator decisions.
// A strike is created only by explicit CONFIRM_VIOLATION, never by a raw report
// or automatic multi-report hide. The unique reportId makes confirmation idempotent.
import { route, jsonOk, parseBody, ApiError } from '@/lib/api'
import { requireAdmin } from '@/lib/admin'
import { reportActionSchema } from '@/lib/validation'
import { db } from '@/lib/db'
import { shouldSendFormalPolicyWarning } from '@/lib/policy-violations'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const admin = await requireAdmin('Only the Mudaala admin can act on reports')
    const { id } = await params
    const { action, policyCategory } = await parseBody(request, reportActionSchema)
    const report = await db.report.findUnique({ where: { id }, select: { id: true, targetType: true, targetId: true, reason: true, status: true } })
    if (!report) throw new ApiError(404, 'This report no longer exists')

    if (action === 'CONFIRM_VIOLATION') {
      const prior = await db.policyViolation.findUnique({ where: { reportId: report.id } })
      if (prior && prior.reversedAt === null) {
        const count = await db.policyViolation.count({ where: { userId: prior.userId, reversedAt: null } })
        return jsonOk({ ok: true, action, alreadyConfirmed: true, confirmedViolationCount: count })
      }
      if (prior) throw new ApiError(409, 'This case was previously overturned. Review a new report if there is new evidence.')
      if (report.status !== 'OPEN') throw new ApiError(409, 'Only an open report can be confirmed as a new violation')

      const target = report.targetType === 'LISTING'
        ? await db.listing.findUnique({ where: { id: report.targetId }, select: { id: true, userId: true, title: true, status: true } })
        : await db.businessProfile.findUnique({ where: { id: report.targetId }, select: { id: true, userId: true, businessName: true } })
      if (!target) throw new ApiError(404, 'The reported listing or shop no longer exists')

      let confirmedViolationCount = 0
      await db.$transaction(async (tx) => {
        await tx.policyViolation.create({
          data: {
            userId: target.userId,
            reportId: report.id,
            targetType: report.targetType,
            targetId: report.targetId,
            policyCategory: policyCategory ?? report.reason,
            confirmedBy: admin.id,
          },
        })

        // A confirmed listing violation also hides an active listing. Shop
        // profile-level hiding is not supported yet; the owner's violation is
        // still recorded and the limitation remains documented.
        if (report.targetType === 'LISTING' && 'status' in target && target.status === 'ACTIVE') {
          await tx.listing.update({ where: { id: target.id }, data: { status: 'HIDDEN' } })
          await tx.notification.create({
            data: {
              userId: target.userId,
              type: 'LISTING_HIDDEN',
              title: 'A listing was hidden after review',
              body: 'Our team reviewed a report and confirmed that this listing broke Mudaala policy, so it has been hidden. You can appeal this decision using “Report a bug / Send feedback” in the site footer.',
              listingId: target.id,
            },
          })
          await tx.auditLog.create({
            data: { actorId: admin.id, action: 'HIDE_LISTING', targetType: 'LISTING', targetId: target.id },
          })
        }

        await tx.report.update({ where: { id: report.id }, data: { status: 'ACTIONED' } })
        await tx.auditLog.create({
          data: { actorId: admin.id, action: 'CONFIRM_POLICY_VIOLATION', targetType: 'REPORT', targetId: report.id },
        })
        confirmedViolationCount = await tx.policyViolation.count({ where: { userId: target.userId, reversedAt: null } })

        // Formal warning threshold is the fourth confirmed violation (>3).
        // Notification and warningSentAt are committed atomically with the strike.
        if (shouldSendFormalPolicyWarning(confirmedViolationCount)) {
          await tx.notification.create({
            data: {
              userId: target.userId,
              type: 'POLICY_WARNING',
              title: 'Formal marketplace policy warning',
              body: `Our moderators have confirmed ${confirmedViolationCount} policy violations on your account. The latest confirmed case concerns: ${(policyCategory ?? report.reason).replaceAll('_', ' ').toLowerCase()}. Please follow Mudaala’s marketplace rules. Further confirmed violations may lead to account restrictions. If you believe this decision is wrong, appeal using “Report a bug / Send feedback” in the site footer and mention this warning.`,
            },
          })
          await tx.policyViolation.update({ where: { reportId: report.id }, data: { warningSentAt: new Date() } })
        }
      }, { isolationLevel: 'Serializable' })

      return jsonOk({ ok: true, action, confirmedViolationCount, warningSent: shouldSendFormalPolicyWarning(confirmedViolationCount) })
    }

    if (action === 'REVERSE_VIOLATION') {
      const violation = await db.policyViolation.findUnique({ where: { reportId: report.id } })
      if (!violation) throw new ApiError(409, 'There is no confirmed violation to overturn for this report')
      if (violation.reversedAt) {
        const count = await db.policyViolation.count({ where: { userId: violation.userId, reversedAt: null } })
        return jsonOk({ ok: true, action, alreadyReversed: true, confirmedViolationCount: count })
      }
      let confirmedViolationCount = 0
      await db.$transaction(async (tx) => {
        await tx.policyViolation.update({
          where: { reportId: report.id },
          data: { reversedAt: new Date(), reversedBy: admin.id },
        })
        confirmedViolationCount = await tx.policyViolation.count({ where: { userId: violation.userId, reversedAt: null } })
        await tx.notification.create({
          data: {
            userId: violation.userId,
            type: 'POLICY_WARNING_REVERSED',
            title: 'A policy decision was overturned',
            body: `After review, the confirmed violation linked to your report case was overturned. Your active confirmed-violation count is now ${confirmedViolationCount}. Any previous warning remains in your notification history, but this case no longer counts against your account.`,
          },
        })
        await tx.auditLog.create({
          data: { actorId: admin.id, action: 'REVERSE_POLICY_VIOLATION', targetType: 'REPORT', targetId: report.id },
        })
      }, { isolationLevel: 'Serializable' })
      return jsonOk({ ok: true, action, confirmedViolationCount })
    }

    if (action === 'DISMISS') {
      await db.$transaction(async (tx) => {
        await tx.report.update({ where: { id: report.id }, data: { status: 'DISMISSED' } })
        await tx.auditLog.create({ data: { actorId: admin.id, action: 'DISMISS_REPORT', targetType: 'REPORT', targetId: report.id } })
      })
      return jsonOk({ ok: true, action })
    }

    if (report.targetType !== 'LISTING') {
      throw new ApiError(409, 'Only listing reports can hide or restore a listing. Shop profile-level moderation is not available yet.')
    }
    const listing = await db.listing.findUnique({ where: { id: report.targetId }, select: { id: true, userId: true, title: true, status: true } })
    if (!listing) throw new ApiError(404, 'This listing no longer exists')
    if (action === 'HIDE') {
      await db.$transaction(async (tx) => {
        if (listing.status === 'ACTIVE') {
          await tx.listing.update({ where: { id: listing.id }, data: { status: 'HIDDEN' } })
          await tx.notification.create({
            data: { userId: listing.userId, type: 'LISTING_HIDDEN', title: `Your listing "${listing.title}" was hidden`, body: 'Our team hid this listing while reviewing reports. A report alone is not a confirmed policy violation. If you believe this was a mistake, appeal using “Report a bug / Send feedback” in the site footer.', listingId: listing.id },
          })
        }
        await tx.report.update({ where: { id: report.id }, data: { status: 'ACTIONED' } })
        await tx.auditLog.create({ data: { actorId: admin.id, action: 'HIDE_LISTING', targetType: 'LISTING', targetId: listing.id } })
      })
    } else if (action === 'RESTORE') {
      await db.$transaction(async (tx) => {
        if (listing.status === 'HIDDEN') await tx.listing.update({ where: { id: listing.id }, data: { status: 'ACTIVE' } })
        await tx.report.update({ where: { id: report.id }, data: { status: 'ACTIONED' } })
        await tx.auditLog.create({ data: { actorId: admin.id, action: 'RESTORE_LISTING', targetType: 'LISTING', targetId: listing.id } })
      })
    }
    return jsonOk({ ok: true, action })
  })
}
