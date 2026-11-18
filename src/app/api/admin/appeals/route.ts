import { route, jsonOk, ApiError } from '@/lib/api'
import { requireAdmin } from '@/lib/admin'
import { db } from '@/lib/db'
import type { NextRequest } from 'next/server'

const STATUSES = ['OPEN', 'IN_REVIEW', 'WAITING_ON_OWNER', 'DECIDED', 'CLOSED', 'ALL'] as const

export async function GET(request: NextRequest) {
  return route(async () => {
    await requireAdmin('Only a Mudaala moderator can read appeal cases')
    const requested = request.nextUrl.searchParams.get('status') ?? 'OPEN'
    if (!STATUSES.includes(requested as typeof STATUSES[number])) throw new ApiError(400, 'Invalid appeal status filter')
    const status = requested as typeof STATUSES[number]
    const assigned = request.nextUrl.searchParams.get('assigned') ?? 'ALL'
    const cases = await db.appealCase.findMany({
      where: {
        ...(status === 'ALL' ? {} : { status }),
        ...(assigned === 'MINE' ? { assignedAdminId: (await requireAdmin()).id } : assigned === 'UNASSIGNED' ? { assignedAdminId: null } : {}),
      },
      orderBy: [{ priority: 'desc' }, { updatedAt: 'asc' }],
      take: 200,
      include: {
        owner: { select: { id: true, name: true, phone: true } },
        assignedAdmin: { select: { id: true, name: true } },
        _count: { select: { messages: true, events: true } },
      },
    })
    return jsonOk({ appealCases: cases })
  })
}
