// Marks the user's Home visit. The Home dashboard fires this ONCE per mount,
// after its data has loaded, so "new matches since last visit" has a stable
// reference point: numbers on screen never zero themselves mid-visit.

import { route, jsonOk, requireSeller } from '@/lib/api'
import { db } from '@/lib/db'

export async function POST() {
  return route(async () => {
    const user = await requireSeller('Sign in to continue')
    const now = new Date()
    await db.user.update({ where: { id: user.id }, data: { lastHomeVisitAt: now } })
    return jsonOk({ ok: true, lastHomeVisitAt: now.toISOString() })
  })
}
