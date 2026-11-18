import { z } from 'zod'
import { route, jsonOk, parseBody, ApiError } from '@/lib/api'
import { getSessionUser } from '@/lib/auth'
import { getClientIp } from '@/lib/client-ip'
import { hit } from '@/lib/rate-limit'
import { normalizePhone } from '@/lib/validation'
import { db } from '@/lib/db'

const createSchema = z.object({
  targetType: z.enum(['USER', 'SHOP', 'LISTING']),
  targetReference: z.string().trim().min(1).max(120).optional(),
  contact: z.string().trim().min(1).max(30),
  title: z.string().trim().min(4).max(120),
  statement: z.string().trim().min(20).max(3000),
})

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function POST(request: Request) {
  return route(async () => {
    const data = await parseBody(request, createSchema)
    const phone = normalizePhone(data.contact)
    if (!phone) throw new ApiError(400, 'Enter the registered Mudaala phone number, including its country code')
    const sessionUser = await getSessionUser()
    const ip = getClientIp(request)
    const limit = await hit(`appeals:create:${ip}`, 4, 60 * 60 * 1000)
    if (!limit.ok) throw new ApiError(429, 'Too many appeal attempts. Please try again later.')

    let ownerId = ''
    let targetId = ''
    let targetReference: string | null = data.targetReference?.trim() ?? null

    if (data.targetType === 'USER') {
      const target = await db.user.findUnique({ where: { phone }, select: { id: true, suspendedAt: true } })
      if (!target?.suspendedAt) throw new ApiError(404, 'We could not match an active account restriction to those details')
      ownerId = target.id
      targetId = target.id
    } else if (data.targetType === 'SHOP') {
      const shopCode = (targetReference ?? '').toUpperCase()
      const target = await db.businessProfile.findUnique({ where: { shopCode }, select: { id: true, moderationStatus: true, userId: true, user: { select: { phone: true } } } })
      if (!target || target.user.phone !== phone || target.moderationStatus !== 'HIDDEN') throw new ApiError(404, 'We could not match a hidden shop to those details')
      ownerId = target.userId
      targetId = target.id
      targetReference = shopCode
    } else {
      const target = await db.listing.findUnique({ where: { id: targetReference ?? '' }, select: { id: true, status: true, userId: true, user: { select: { phone: true } } } })
      if (!target || target.user.phone !== phone || target.status !== 'HIDDEN') throw new ApiError(404, 'We could not match a hidden listing to those details')
      ownerId = target.userId
      targetId = target.id
    }

    if (sessionUser && sessionUser.id !== ownerId) throw new ApiError(403, 'You can only appeal a restriction on your own account or shop')
    const openCase = await db.appealCase.findFirst({
      where: { ownerId, targetType: data.targetType, targetId, status: { in: ['OPEN', 'IN_REVIEW', 'WAITING_ON_OWNER'] } },
      select: { id: true },
    })
    if (openCase) throw new ApiError(409, 'An appeal for this restriction is already open. Use its existing case reference.')

    const accessToken = randomToken()
    const accessTokenHash = await sha256(accessToken)
    const appealCase = await db.$transaction(async (tx) => {
      const created = await tx.appealCase.create({
        data: {
          ownerId, targetType: data.targetType, targetId, targetReference,
          title: data.title, statement: data.statement, accessTokenHash,
          messages: { create: { senderId: ownerId, senderRole: 'OWNER', body: data.statement } },
          events: { create: { eventType: 'CREATED', actorId: sessionUser?.id ?? ownerId, details: { targetType: data.targetType } } },
        },
        select: { id: true, status: true, createdAt: true },
      })
      const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean)
      const admins = adminIds.length ? await tx.user.findMany({ where: { id: { in: adminIds } }, select: { id: true } }) : []
      if (admins.length) await tx.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id, type: 'NEW_APPEAL', category: 'SYSTEM', priority: 'HIGH',
          title: 'New restriction appeal',
          body: 'A new appeal case is waiting for review in the admin dashboard.',
          actionUrl: '/admin/appeals', actionLabel: 'Review appeal',
        })),
      })
      return created
    })

    return jsonOk({
      appealCase: { ...appealCase, accessToken },
      message: 'Your appeal has been submitted. Keep the private case access code so you can follow updates and reply to the review team.',
    }, 201)
  })
}

export async function GET(request: Request) {
  return route(async () => {
    const user = await getSessionUser()
    if (!user) throw new ApiError(401, 'Sign in or use your private appeal access code to view a case')
    const cases = await db.appealCase.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, targetType: true, targetReference: true, title: true, status: true, priority: true, decision: true, decisionReason: true, createdAt: true, updatedAt: true },
    })
    return jsonOk({ appealCases: cases })
  })
}
