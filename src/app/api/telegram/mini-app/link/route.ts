import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { ApiError, jsonOk, parseBody, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'
import { getClientIp } from '@/lib/client-ip'
import { hit } from '@/lib/rate-limit'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({ initData: z.string().min(1).max(8192) })

function telegramUserId(initData: string, botToken: string): number {
  const params = new URLSearchParams(initData)
  const receivedHash = params.get('hash')
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new ApiError(401, 'Telegram could not verify this launch. Close the Mini App and open it again.')
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
    throw new ApiError(401, 'Telegram could not verify this launch.')
  }

  const authDate = Number(params.get('auth_date'))
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isInteger(authDate) || authDate > now + 30 || now - authDate > 10 * 60) {
    throw new ApiError(401, 'This Telegram launch has expired. Close the Mini App and open it again.')
  }

  let user: unknown
  try { user = JSON.parse(params.get('user') || 'null') } catch { user = null }
  const id = user && typeof user === 'object' ? (user as { id?: unknown }).id : null
  if (!Number.isSafeInteger(id) || Number(id) <= 0) {
    throw new ApiError(401, 'Telegram user information is missing. Reopen the Mini App from the bot.')
  }
  return Number(id)
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser('Create or sign in to your Mudaala account first')
    const ip = getClientIp(request)
    const verdict = await hit('telegram-mini-app:link:' + ip, 10, 60_000)
    if (!verdict.ok) throw new ApiError(429, 'Too many linking attempts. Please wait and try again.')

    const { initData } = await parseBody(request, schema)
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) throw new ApiError(503, 'Telegram account linking is temporarily unavailable.')

    const id = telegramUserId(initData, botToken)
    const key = 'telegram:user:' + createHash('sha256').update(String(id)).digest('hex')
    const existing = await db.appSetting.findUnique({ where: { key } })
    if (existing) {
      let mapping: { userId?: unknown } = {}
      try { mapping = JSON.parse(existing.value) as typeof mapping } catch {
        throw new ApiError(409, 'This Telegram connection needs support before it can be changed.')
      }
      if (mapping.userId !== user.id) {
        throw new ApiError(409, 'This Telegram account is already connected to another Mudaala account. Contact support before changing the connection.')
      }
      // Same account: linking is idempotent and does not rotate the mapping.
    } else {
      try {
        // A unique insert, not an upsert: two concurrent account claims must
        // never overwrite one another's Telegram-to-Mudaala ownership.
        await db.appSetting.create({
          data: { key, value: JSON.stringify({ userId: user.id, linkedAt: new Date().toISOString() }) },
        })
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') throw error
        const raced = await db.appSetting.findUnique({ where: { key } })
        let racedMapping: { userId?: unknown } = {}
        try { racedMapping = JSON.parse(raced?.value || '{}') as typeof racedMapping } catch { /* reject malformed concurrent claim */ }
        if (racedMapping.userId !== user.id) {
          throw new ApiError(409, 'This Telegram account was connected to another Mudaala account at the same time. Contact support if this was unexpected.')
        }
      }
    }
    const response = jsonOk({ linked: true })
    response.headers.set('Cache-Control', 'no-store, private')
    return response
  })
}
