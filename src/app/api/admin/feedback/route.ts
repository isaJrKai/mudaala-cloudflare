// GET /api/admin/feedback - private admin inbox for user feedback.
import { route, jsonOk, ApiError } from '@/lib/api'
import { requireAdmin } from '@/lib/admin'
import { db } from '@/lib/db'
import type { NextRequest } from 'next/server'

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'ALL'] as const

export async function GET(request: NextRequest) {
  return route(async () => {
    await requireAdmin('Only the Mudaala admin can read feedback')
    const requested = request.nextUrl.searchParams.get('status') ?? 'OPEN'
    if (!STATUSES.includes(requested as typeof STATUSES[number])) throw new ApiError(400, 'Invalid feedback status filter')
    const status = requested as typeof STATUSES[number]
    const feedback = await db.feedback.findMany({
      where: status === 'ALL' ? {} : { status },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { reporter: { select: { name: true } } },
    })
    const priorityRank: Record<string, number> = { URGENT: 3, HIGH: 2, NORMAL: 1 }
    feedback.sort((a, b) => (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0) || b.createdAt.getTime() - a.createdAt.getTime())
    return jsonOk({
      feedback: feedback.map((item) => ({
        id: item.id,
        category: item.category,
        title: item.title,
        description: item.description,
        pagePath: item.pagePath,
        userAgent: item.userAgent,
        contact: item.contact,
        status: item.status,
        priority: item.priority,
        adminNotes: item.adminNotes,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        reporterName: item.reporter?.name ?? 'Guest',
      })),
    })
  })
}
