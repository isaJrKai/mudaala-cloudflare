import { route, jsonOk, parseBody, ApiError } from '@/lib/api'
import { requireAdmin, isAdminUser } from '@/lib/admin'
import { adminShopModerationSchema } from '@/lib/validation'
import { applyShopModeration } from '@/lib/admin-shop-moderation'
import { db } from '@/lib/db'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const admin = await requireAdmin('Only a Mudaala administrator can moderate shops')
    const { id } = await params
    const { action, reason } = await parseBody(request, adminShopModerationSchema)
    const profile = await db.businessProfile.findUnique({
      where: { id },
      select: { id: true, isSeed: true, user: { select: { id: true, phone: true } } },
    })
    if (!profile || profile.isSeed) throw new ApiError(404, 'This shop could not be found')
    if (profile.user.id === admin.id || isAdminUser(profile.user)) {
      throw new ApiError(409, 'Administrator shops cannot be restricted from this control')
    }

    const result = await db.$transaction((tx) => applyShopModeration(tx, {
      profileId: id,
      actorId: admin.id,
      action,
      reason,
    }))
    if (!result.ok) throw new ApiError(409, result.error)
    return jsonOk({ ok: true, action, status: result.status, changed: result.changed })
  })
}
