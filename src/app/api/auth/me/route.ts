import { route, jsonOk } from '@/lib/api'
import { getSessionUser, toPublicUser } from '@/lib/auth'
import { isAdminUser } from '@/lib/admin'
import { db } from '@/lib/db'

export async function GET() {
  return route(async () => {
    const user = await getSessionUser()
    if (!user) return jsonOk({ user: null })
    const googleIdentity = await db.googleIdentity.findUnique({
      where: { userId_provider: { userId: user.id, provider: 'google' } },
      select: { id: true },
    })
    return jsonOk({ user: { ...toPublicUser(user), isAdmin: isAdminUser(user), googleLinked: Boolean(googleIdentity) } })
  })
}
