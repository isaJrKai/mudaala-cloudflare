// GET /api/admin/audit - bounded, privacy-minimized administrative history.
import { route, jsonOk, ApiError } from '@/lib/api'
import { requireAdmin } from '@/lib/admin'
import { db } from '@/lib/db'
import type { NextRequest } from 'next/server'

const TARGET_TYPES = ['LISTING', 'SHOP', 'REPORT', 'FEEDBACK', 'USER', 'SYSTEM'] as const

export async function GET(request: NextRequest) {
  return route(async () => {
    await requireAdmin('Only the Mudaala admin can view audit history')
    const params = request.nextUrl.searchParams
    const rawPage = params.get('page') ?? '1'
    const page = Number(rawPage)
    if (!/^\\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1 || page > 10000) {
      throw new ApiError(400, 'Invalid audit page')
    }
    const action = (params.get('action') ?? '').trim().slice(0, 80)
    const targetType = (params.get('targetType') ?? '').trim().toUpperCase()
    const q = (params.get('q') ?? '').trim().slice(0, 80)
    if (action && !/^[A-Z0-9_]+$/.test(action)) throw new ApiError(400, 'Invalid audit action filter')
    if (targetType && !TARGET_TYPES.includes(targetType as typeof TARGET_TYPES[number])) {
      throw new ApiError(400, 'Invalid audit target filter')
    }
    const where = {
      ...(action ? { action } : {}),
      ...(targetType ? { targetType } : {}),
      ...(q ? { targetId: { contains: q, mode: 'insensitive' as const } } : {}),
    }
    const [events, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 50,
        take: 50,
        select: { id: true, actorId: true, action: true, targetType: true, targetId: true, createdAt: true },
      }),
      db.auditLog.count({ where }),
    ])
    const actorIds = [...new Set(events.map((event) => event.actorId).filter(Boolean))] as string[]
    const actors = actorIds.length
      ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : []
    const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]))
    return jsonOk({
      events: events.map((event) => ({
        id: event.id,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        createdAt: event.createdAt,
        actor: event.actorId ? (actorNames.get(event.actorId) ?? 'Former admin account') : 'System',
      })),
      page,
      pageSize: 50,
      total,
      totalPages: Math.max(1, Math.ceil(total / 50)),
    })
  })
}
