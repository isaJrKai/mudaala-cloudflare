import { NextRequest } from 'next/server'
import { route, jsonOk, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(_request: NextRequest, { params }: Params) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await params
    // Delete atomically within the ownership boundary. Concurrent deletes
    // return a controlled 404 instead of surfacing Prisma P2025 as a 503.
    const result = await db.savedSearch.deleteMany({ where: { id, userId: user.id } })
    if (result.count === 0) throw new ApiError(404, 'Saved search not found')
    return jsonOk({ ok: true })
  })
}
