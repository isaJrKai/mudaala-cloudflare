import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { ApiError, jsonOk, route, parseBody } from '@/lib/api'
import { db } from '@/lib/db'
import { createSession, setSessionCookie, toPublicUser } from '@/lib/auth'
import { getClientIp } from '@/lib/client-ip'
import { hit } from '@/lib/rate-limit'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({ initData: z.string().min(1).max(8192) })

function telegramUserKey(id: number): string {
  return 'telegram:user:' + createHash('sha256').update(String(id)).digest('hex')
}

function verifyInitData(initData: string, botToken: string): { id: number } {
  const params = new URLSearchParams(initData)
  const receivedHash = params.get('hash')
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new ApiError(401, 'Open this page from the Mudaala Merchant bot in Telegram.')
  }

  const fields = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + '=' + value)
    .join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expectedHash = createHmac('sha256', secretKey).update(fields).digest()
  const suppliedHash = Buffer.from(receivedHash, 'hex')
  if (suppliedHash.length !== expectedHash.length || !timingSafeEqual(suppliedHash, expectedHash)) {
    throw new ApiError(401, 'Telegram could not verify this launch. Close the Mini App and open it again.')
  }

  const authDate = Number(params.get('auth_date'))
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isInteger(authDate) || authDate > now + 30 || now - authDate > 10 * 60) {
    throw new ApiError(401, 'This Telegram launch has expired. Close the Mini App and open it again.')
  }

  let user: unknown
  try { user = JSON.parse(params.get('user') || 'null') } catch { user = null }
  if (!user || typeof user !== 'object' || !Number.isSafeInteger((user as { id?: unknown }).id) || Number((user as { id: number }).id) <= 0) {
    throw new ApiError(401, 'Telegram user information is missing. Reopen the Mini App from the bot.')
  }
  return { id: Number((user as { id: number }).id) }
}

export async function POST(request: Request) {
  return route(async () => {
    const ip = getClientIp(request)
    const verdict = await hit('telegram-mini-app:ip:' + ip, 20, 60_000)
    if (!verdict.ok) throw new ApiError(429, 'Too many attempts. Please wait a moment and try again.')

    const { initData } = await parseBody(request, schema)
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) throw new ApiError(503, 'Telegram sign-in is temporarily unavailable.')

    const telegramUser = verifyInitData(initData, botToken)
    const mapping = await db.appSetting.findUnique({ where: { key: telegramUserKey(telegramUser.id) } })
    if (!mapping) {
      throw new ApiError(403, 'Your Telegram account is not linked to a Mudaala shop yet. Open the bot and connect your account first.')
    }

    let linked: { userId?: unknown }
    try { linked = JSON.parse(mapping.value) as typeof linked } catch { linked = {} }
    if (typeof linked.userId !== 'string') {
      throw new ApiError(403, 'Your Telegram connection needs to be renewed. Link your account again in the bot.')
    }

    const user = await db.user.findUnique({ where: { id: linked.userId } })
    if (!user) {
      throw new ApiError(403, 'The linked Mudaala account could not be found. Connect your account again.')
    }
    if (user.suspendedAt) throw new ApiError(403, 'This Mudaala account is currently restricted. Submit an appeal through the site feedback form.')

    const session = await createSession(user.id)
    await setSessionCookie(session.token, session.expiresAt)
    const response = jsonOk({ user: toPublicUser(user) })
    response.headers.set('Cache-Control', 'no-store, private')
    return response
  })
}
