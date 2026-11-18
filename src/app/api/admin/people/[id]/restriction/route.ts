// POST /api/admin/people/:id/restriction - suspend or reinstate an account.
import { route, jsonOk, parseBody, ApiError } from '@/lib/api'
import { requireAdmin, isAdminUser } from '@/lib/admin'
import { adminAccountRestrictionSchema } from '@/lib/validation'
import { db } from '@/lib/db'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const admin = await requireAdmin('Only a Mudaala administrator can restrict accounts')
    const { id } = await params
    const { action, reason } = await parseBody(request, adminAccountRestrictionSchema)
    if (id === admin.id) throw new ApiError(409, 'You cannot restrict your own administrator account')

    const target = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, isSeed: true, suspendedAt: true },
    })
    if (!target || target.isSeed) throw new ApiError(404, 'This account could not be found')
    const fullTarget = await db.user.findUnique({ where: { id }, select: { id: true, phone: true } })
    if (fullTarget && isAdminUser(fullTarget)) throw new ApiError(409, 'Administrator accounts cannot be restricted from this control')

    if (action === 'SUSPEND' && target.suspendedAt) {
      throw new ApiError(409, 'This account is already suspended')
    }
    if (action === 'REINSTATE' && !target.suspendedAt) {
      throw new ApiError(409, 'This account is not currently suspended')
    }

    await db.$transaction(async (tx) => {
      if (action === 'SUSPEND') {
        await tx.user.update({
          where: { id },
          data: { suspendedAt: new Date(), suspensionReason: reason, suspendedBy: admin.id },
        })
        // Revoke every device immediately. Reinstatement requires a fresh login.
        await tx.session.deleteMany({ where: { userId: id } })
      } else {
        await tx.user.update({
          where: { id },
          data: { suspendedAt: null, suspensionReason: null, suspendedBy: null },
        })
        await tx.notification.create({
          data: {
            userId: id,
            type: 'ACCOUNT_REINSTATED',
            category: 'SYSTEM',
            priority: 'HIGH',
            title: 'Your Mudaala account has been reinstated',
            body: 'Your account restriction has been lifted after review. Sign in again to continue using Mudaala.',
          },
        })
      }
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: action === 'SUSPEND' ? 'SUSPEND_ACCOUNT' : 'REINSTATE_ACCOUNT',
          targetType: 'USER',
          targetId: id,
          reason,
          metadata: { accountName: target.name },
        },
      })
    })

    return jsonOk({ ok: true, action, userId: id })
  })
}
