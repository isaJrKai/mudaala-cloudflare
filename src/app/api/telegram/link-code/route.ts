import { createHash, randomBytes } from 'node:crypto'
import { ApiError, jsonOk, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser('Sign in to connect Telegram')
    const ip = getClientIp(request)
    const ipLimit = await hit('telegram-link:ip:' + ip, 10, 60 * 60 * 1000)
    const userLimit = await hit('telegram-link:user:' + user.id, 5, 60 * 60 * 1000)
    if (!ipLimit.ok || !userLimit.ok) throw new ApiError(429, 'Please wait before generating another Telegram link code')

    const code = randomBytes(5).toString('hex').toUpperCase()
    const codeHash = createHash('sha256').update(code).digest('hex')
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    await db.appSetting.upsert({
      where: { key: 'telegram:link-code:' + codeHash },
      create: { key: 'telegram:link-code:' + codeHash, value: JSON.stringify({ userId: user.id, expiresAt: expiresAt.toISOString() }) },
      update: { value: JSON.stringify({ userId: user.id, expiresAt: expiresAt.toISOString() }) },
    })
    return jsonOk({ code, expiresAt: expiresAt.toISOString() }, 201)
  })
}
