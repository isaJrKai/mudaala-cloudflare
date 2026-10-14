import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { CATEGORY_KEYS } from '@/lib/constants'
import { hit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { z } from 'zod'

const interestSchema = z.object({
  category: z.string().trim().min(1).max(64).refine((value) => CATEGORY_KEYS.includes(value), {
    message: 'Choose a valid Mudaala category',
  }),
})

// Category memory is private account data. Every query is scoped to the
// authenticated user; no userId is ever accepted from the request body.
export async function GET() {
  return route(async () => {
    const user = await requireUser()
    const interests = await db.categoryInterest.findMany({
      where: { userId: user.id },
      select: { category: true, score: true, lastSelectedAt: true },
      orderBy: [{ score: 'desc' }, { lastSelectedAt: 'desc' }],
    })
    return jsonOk({ interests })
  })
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const verdict = await hit(`category-interest:user:${user.id}`, 120, 60_000)
    if (!verdict.ok) throw new ApiError(429, 'You are browsing quickly. Please try again shortly.')
    const data = await parseBody(request, interestSchema)
    const existing = await db.categoryInterest.findUnique({
      where: { userId_category: { userId: user.id, category: data.category } },
      select: { score: true },
    })
    const score = Math.min(100, (existing?.score ?? 0) + 3)
    const interest = await db.categoryInterest.upsert({
      where: { userId_category: { userId: user.id, category: data.category } },
      create: { userId: user.id, category: data.category, score },
      update: { score, lastSelectedAt: new Date() },
      select: { category: true, score: true, lastSelectedAt: true },
    })
    return jsonOk({ interest })
  })
}

export async function DELETE() {
  return route(async () => {
    const user = await requireUser()
    await db.categoryInterest.deleteMany({ where: { userId: user.id } })
    return jsonOk({ reset: true })
  })
}
