import { route, jsonOk, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'

type Params = { params: Promise<{ id: string; itemId: string }> }

export async function DELETE(_request: Request, { params }: Params) {
  return route(async () => {
    const { id, itemId } = await params
    const user = await requireUser('Sign in as the shop owner to manage this showroom')
    if (user.id !== id) throw new ApiError(403, 'Only this shop owner can remove showroom items')

    const deleted = await db.showroomItem.deleteMany({
      where: { id: itemId, userId: user.id },
    })
    if (deleted.count === 0) throw new ApiError(404, 'Showroom item not found')
    return jsonOk({ ok: true })
  })
}
