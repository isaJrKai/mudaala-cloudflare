// POST /api/admin/shops/:id/restriction - restrict or restore a shop profile.
import { route, jsonOk, parseBody, ApiError } from '@/lib/api'
import { requireAdmin, isAdminUser } from '@/lib/admin'
import { adminAccountRestrictionSchema } from '@/lib/validation'
import { db } from '@/lib/db'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const admin = await requireAdmin('Only a Mudaala administrator can restrict shops')
    const { id } = await params
    const { action, reason } = await parseBody(request, adminAccountRestrictionSchema)
    const profile = await db.businessProfile.findUnique({
      where: { id },
      select: {
        id: true, businessName: true, isSeed: true,
        user: { select: { id: true, isSeed: true, phone: true, shopRestrictedAt: true } },
      },
    })
    if (!profile || profile.isSeed || profile.user.isSeed) throw new ApiError(404, 'This shop could not be found')
    if (profile.user.id === admin.id || isAdminUser({ id: profile.user.id, phone: profile.user.phone })) {
      throw new ApiError(409, 'Administrator accounts cannot be restricted from this control')
    }
    if (action === 'SUSPEND' && profile.user.shopRestrictedAt) throw new ApiError(409, 'This shop is already restricted')
    if (action === 'REINSTATE' && !profile.user.shopRestrictedAt) throw new ApiError(409, 'This shop is not currently restricted')

    await db.$transaction(async (tx) => {
      if (action === 'SUSPEND') {
        await tx.user.update({
          where: { id: profile.user.id },
          data: { shopRestrictedAt: new Date(), shopRestrictionReason: reason, shopRestrictedBy: admin.id },
        })
        await tx.notification.create({
          data: {
            userId: profile.user.id, type: 'SHOP_RESTRICTED', category: 'SYSTEM', priority: 'HIGH',
            title: 'Your Mudaala shop has been restricted',
            body: 'Your shop and merchant-management tools are temporarily unavailable following an administrative review. Your buyer account remains available. Contact Mudaala support if you believe this is a mistake.',
          },
        })
      } else {
        await tx.user.update({
          where: { id: profile.user.id },
          data: { shopRestrictedAt: null, shopRestrictionReason: null, shopRestrictedBy: null },
        })
        await tx.notification.create({
          data: {
            userId: profile.user.id, type: 'SHOP_REINSTATED', category: 'SYSTEM', priority: 'HIGH',
            title: 'Your Mudaala shop has been reinstated',
            body: 'Your shop restriction has been lifted after review. Sign in again if you were asked to refresh your session.',
          },
        })
      }
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: action === 'SUSPEND' ? 'RESTRICT_SHOP' : 'REINSTATE_SHOP',
          targetType: 'SHOP',
          targetId: profile.id,
          reason,
          metadata: { shopName: profile.businessName, ownerId: profile.user.id },
        },
      })
    })
    return jsonOk({ ok: true, action, shopId: profile.id })
  })
}
