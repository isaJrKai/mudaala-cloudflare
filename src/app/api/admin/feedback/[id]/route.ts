// PATCH /api/admin/feedback/:id - triage a feedback item and keep an audit trail.
import { route, jsonOk, parseBody, ApiError } from '@/lib/api'
import { requireAdmin } from '@/lib/admin'
import { feedbackAdminUpdateSchema } from '@/lib/validation'
import { db } from '@/lib/db'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const admin = await requireAdmin('Only the Mudaala admin can update feedback')
    const { id } = await params
    const changes = await parseBody(request, feedbackAdminUpdateSchema)
    const existing = await db.feedback.findUnique({ where: { id }, select: { id: true } })
    if (!existing) throw new ApiError(404, 'This feedback item no longer exists')

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
