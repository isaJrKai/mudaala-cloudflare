import { NextRequest } from 'next/server'
import { route, jsonOk, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(_request: NextRequest, { params }: Params) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await params

    // Delete atomically within the ownership boundary. A findUnique() followed
    // by delete() races when a user double-clicks, has two tabs open, or a
    // retry overlaps another deletion: Prisma then throws P2025 and the API
    // incorrectly reports a 503. deleteMany returns count=0 for both a missing
    // and foreign record, so those cases stay indistinguishable to the caller.
    const result = await db.savedSearch.deleteMany({
      where: { id, userId: user.id },
    })
    if (result.count === 0) {
      throw new ApiError(404, 'Saved search not found')
    }

    return jsonOk({ ok: true })
  })
}
