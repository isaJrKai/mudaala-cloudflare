import { z } from 'zod'
import { route, jsonOk, parseBody, ApiError } from '@/lib/api'
import { getSessionUser } from '@/lib/auth'
import { requireAdmin, isAdminUser } from '@/lib/admin'
import { applyShopModeration } from '@/lib/admin-shop-moderation'
import { db } from '@/lib/db'

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function authorizeCase(request: Request, caseId: string) {
  const appealCase = await db.appealCase.findUnique({ where: { id: caseId }, select: { id: true, ownerId: true, accessTokenHash: true } })
  if (!appealCase) throw new ApiError(404, 'Appeal case not found')
  const admin = await requireAdmin('Only a Mudaala moderator can access moderator case controls').catch(() => null)
  if (admin) return { appealCase, admin, owner: false }
  const user = await getSessionUser()
  if (user?.id === appealCase.ownerId) return { appealCase, admin: null, owner: true }
  const token = request.headers.get('x-appeal-access-token')?.trim()
  if (token && appealCase.accessTokenHash && await sha256(token) === appealCase.accessTokenHash) return { appealCase, admin: null, owner: true }
  throw new ApiError(403, 'You do not have access to this appeal case')
}

const messageSchema = z.object({
  body: z.string().trim().min(1).max(3000),
  evidenceUrls: z.array(z.string().url().max(1000).refine((value) => value.startsWith('https://'), 'Evidence links must use HTTPS')).max(5).optional(),
})
const adminUpdateSchema = z.object({
  status: z.enum(['OPEN', 'IN_REVIEW', 'WAITING_ON_OWNER', 'CLOSED']).optional(),
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).optional(),
  assignedAdminId: z.string().trim().min(1).nullable().optional(),
  decision: z.enum(['UPHELD', 'REVERSED']).optional(),
  decisionReason: z.string().trim().min(10).max(1000).optional(),
}).refine((value) => value.decision === undefined || Boolean(value.decisionReason && value.decisionReason.length >= 10), {
  message: 'A decision requires a reason of at least 10 characters',
})

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const { id } = await params
    const access = await authorizeCase(request, id)
    const appealCase = await db.appealCase.findUnique({
      where: { id },
      include: {
        messages: { where: access.owner ? { internal: false } : {}, orderBy: { createdAt: 'asc' }, include: { sender: { select: { name: true } } } },
        events: { orderBy: { createdAt: 'asc' } },
        owner: { select: { name: true, phone: true } },
        assignedAdmin: { select: { name: true } },
      },
    })
    if (!appealCase) throw new ApiError(404, 'Appeal case not found')
    return jsonOk({ appealCase })
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const { id } = await params
    const access = await authorizeCase(request, id)
    const data = await parseBody(request, messageSchema)
    if (access.appealCase.ownerId !== (access.owner ? (await getSessionUser())?.id ?? access.appealCase.ownerId : access.appealCase.ownerId)) {
      throw new ApiError(403, 'You cannot reply to this case')
    }
    const current = await db.appealCase.findUnique({ where: { id }, select: { status: true, ownerId: true } })
    if (!current || ['DECIDED', 'CLOSED'].includes(current.status)) throw new ApiError(409, 'This appeal case is closed to new messages')
    const created = await db.$transaction(async (tx) => {
      const message = await tx.appealCaseMessage.create({
        data: {
          caseId: id, senderId: access.admin?.id ?? current.ownerId,
          senderRole: access.admin ? 'MODERATOR' : 'OWNER',
          body: data.body, evidenceUrls: JSON.stringify(data.evidenceUrls ?? []),
        },
      })
      const nextStatus = access.admin ? 'WAITING_ON_OWNER' : 'IN_REVIEW'
      await tx.appealCase.update({ where: { id }, data: { status: nextStatus } })
      await tx.appealCaseEvent.create({
        data: { caseId: id, actorId: access.admin?.id ?? current.ownerId, eventType: (data.evidenceUrls?.length ?? 0) ? 'EVIDENCE_ADDED' : 'MESSAGE_ADDED', details: { senderRole: access.admin ? 'MODERATOR' : 'OWNER', evidenceCount: data.evidenceUrls?.length ?? 0 } },
      })
      const recipientId = access.admin ? current.ownerId : (await tx.appealCase.findUnique({ where: { id }, select: { assignedAdminId: true } }))?.assignedAdminId
      if (recipientId) await tx.notification.create({
        data: { userId: recipientId, type: 'APPEAL_MESSAGE', category: 'SYSTEM', priority: 'HIGH', title: 'New appeal case message', body: 'There is a new message in an appeal case. Open the appeal case to respond.', actionUrl: access.admin ? '/notifications' : '/admin/appeals', actionLabel: 'Open case' },
      })
      return message
    })
    return jsonOk({ message: { id: created.id, createdAt: created.createdAt } }, 201)
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const admin = await requireAdmin('Only a Mudaala moderator can update appeal cases')
    const { id } = await params
    const changes = await parseBody(request, adminUpdateSchema)
    const existing = await db.appealCase.findUnique({ where: { id } })
    if (!existing) throw new ApiError(404, 'Appeal case not found')
    if (existing.decision || ['DECIDED', 'CLOSED'].includes(existing.status)) throw new ApiError(409, 'This appeal case has already been decided or closed')

    if (changes.assignedAdminId && changes.assignedAdminId !== 'SELF') {
      const assignee = await db.user.findUnique({ where: { id: changes.assignedAdminId }, select: { id: true, phone: true } })
      if (!assignee || !isAdminUser(assignee)) throw new ApiError(400, 'Choose an active Mudaala administrator')
    }
    await db.$transaction(async (tx) => {
      if (changes.decision) {
        const reason = changes.decisionReason!
        if (changes.decision === 'REVERSED') {
          if (existing.targetType === 'USER') {
            const target = await tx.user.findUnique({ where: { id: existing.targetId }, select: { id: true, suspendedAt: true } })
            if (!target?.suspendedAt) throw new ApiError(409, 'This account is no longer suspended')
            await tx.user.update({ where: { id: target.id }, data: { suspendedAt: null, suspensionReason: null, suspendedBy: null } })
            await tx.auditLog.create({ data: { actorId: admin.id, action: 'REINSTATE_ACCOUNT', targetType: 'USER', targetId: target.id, reason } })
            await tx.notification.create({ data: { userId: target.id, type: 'ACCOUNT_REINSTATED', category: 'SYSTEM', priority: 'HIGH', title: 'Your Mudaala account has been reinstated', body: 'Your appeal was accepted. You can sign in again using your usual login details.' } })
          } else if (existing.targetType === 'SHOP') {
            const shop = await tx.businessProfile.findUnique({ where: { id: existing.targetId }, select: { id: true, moderationStatus: true, userId: true } })
            if (!shop || shop.moderationStatus !== 'HIDDEN') throw new ApiError(409, 'This shop is no longer hidden')
            await tx.policyViolation.updateMany({ where: { targetType: 'SHOP', targetId: shop.id, reversedAt: null }, data: { reversedAt: new Date(), reversedBy: admin.id, activeKey: null } })
            const result = await applyShopModeration(tx, { profileId: shop.id, actorId: admin.id, action: 'RESTORE', reason })
            if (!result.ok) throw new ApiError(409, result.error)
            await tx.notification.create({ data: { userId: shop.userId, type: 'SHOP_RESTORED', category: 'SYSTEM', priority: 'HIGH', title: 'Your shop has been restored', body: 'Your appeal was accepted and your shop is visible to buyers again.' } })
          } else {
            const listing = await tx.listing.findUnique({ where: { id: existing.targetId }, select: { id: true, userId: true, status: true } })
            if (!listing || listing.status !== 'HIDDEN') throw new ApiError(409, 'This listing is no longer hidden')
            await tx.policyViolation.updateMany({ where: { targetType: 'LISTING', targetId: listing.id, reversedAt: null }, data: { reversedAt: new Date(), reversedBy: admin.id, activeKey: null } })
            await tx.listing.update({ where: { id: listing.id }, data: { status: 'ACTIVE' } })
            await tx.auditLog.create({ data: { actorId: admin.id, action: 'RESTORE_LISTING', targetType: 'LISTING', targetId: listing.id, reason } })
            await tx.notification.create({ data: { userId: listing.userId, type: 'LISTING_RESTORED', category: 'SYSTEM', priority: 'HIGH', title: 'Your listing has been restored', body: 'Your appeal was accepted and the listing is visible to buyers again.', listingId: listing.id } })
          }
        } else {
          await tx.notification.create({ data: { userId: existing.ownerId, type: 'APPEAL_UPHELD', category: 'SYSTEM', priority: 'HIGH', title: 'Your appeal has been reviewed', body: 'The restriction remains in place after review. Open your appeal case to read the decision.' } })
        }
        await tx.appealCase.update({ where: { id }, data: { decision: changes.decision, decisionReason: reason, decidedBy: admin.id, decidedAt: new Date(), status: 'DECIDED' } })
        await tx.auditLog.create({ data: { actorId: admin.id, action: changes.decision === 'REVERSED' ? 'APPEAL_REVERSED' : 'APPEAL_UPHELD', targetType: 'APPEAL_CASE', targetId: id, reason } })
        await tx.appealCaseEvent.create({ data: { caseId: id, actorId: admin.id, eventType: 'DECIDED', details: { decision: changes.decision, reason } } })
      } else {
        await tx.appealCase.update({ where: { id }, data: { status: changes.status, priority: changes.priority, assignedAdminId: changes.assignedAdminId === 'SELF' ? admin.id : changes.assignedAdminId } })
        if (changes.assignedAdminId !== undefined) await tx.appealCaseEvent.create({ data: { caseId: id, actorId: admin.id, eventType: 'ASSIGNED', details: { assignedAdminId: changes.assignedAdminId === 'SELF' ? admin.id : changes.assignedAdminId } } })
        if (changes.status) await tx.appealCaseEvent.create({ data: { caseId: id, actorId: admin.id, eventType: 'STATUS_CHANGED', details: { status: changes.status } } })
      }
    })
    return jsonOk({ ok: true })
  })
}
