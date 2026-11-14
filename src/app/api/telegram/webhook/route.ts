import { createHash, timingSafeEqual } from 'node:crypto'
import { ApiError, jsonOk, route } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type TelegramMessage = {
  text?: string
  chat?: { id?: number; type?: string }
  from?: { id?: number }
}
type TelegramUpdate = { update_id?: number; message?: TelegramMessage }

function secretMatches(expected: string, supplied: string | null): boolean {
  if (!supplied) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(supplied)
  return a.length === b.length && timingSafeEqual(a, b)
}

function telegramKey(id: number): string {
  const digest = createHash('sha256').update(String(id)).digest('hex')
  return 'telegram:user:' + digest
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('Telegram bot is not configured')
  const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error('Telegram sendMessage failed with HTTP ' + response.status)
  const result = await response.json() as { ok?: boolean }
  if (!result.ok) throw new Error('Telegram rejected sendMessage')
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let body = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new ApiError(413, 'Payload too large')
      }
      body += decoder.decode(value, { stream: true })
    }
    body += decoder.decode()
    return body
  } finally {
    reader.releaseLock()
  }
}

// AppSetting is also used by unrelated application features. Keep Telegram
// housekeeping narrowly scoped and bounded so webhook traffic cannot trigger
// an unbounded table scan or delete another feature's settings.
async function cleanupTelegramRecords(): Promise<void> {
  const now = Date.now()
  const staleUpdates = await db.appSetting.findMany({
    where: { key: { startsWith: 'telegram:update:' }, updatedAt: { lt: new Date(now - 48 * 60 * 60 * 1000) } },
    select: { key: true },
    take: 100,
  })
  if (staleUpdates.length) {
    await db.appSetting.deleteMany({ where: { key: { in: staleUpdates.map((item) => item.key) } } })
  }
  const staleCodes = await db.appSetting.findMany({
    where: { key: { startsWith: 'telegram:link-code:' }, updatedAt: { lt: new Date(now - 60 * 60 * 1000) } },
    select: { key: true },
    take: 100,
  })
  if (staleCodes.length) {
    await db.appSetting.deleteMany({ where: { key: { in: staleCodes.map((item) => item.key) } } })
  }
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat?.id
  const telegramUserId = message.from?.id
  const text = (message.text || '').trim()
  if (!chatId || !telegramUserId || !text || message.chat?.type !== 'private') return

  const parts = text.split(/\s+/)
  const command = (parts[0] || '').split('@')[0].toLowerCase()
  if (command === '/start' || command === '/help') {
    await sendMessage(chatId, 'Welcome to Mudaala Merchant Assistant.\n\n/link CODE — connect this Telegram account to your Mudaala shop.\n/shop — get your public shop link.\n/products — view your active products.\n/help — show these commands.\n\nTo connect, sign in to Mudaala, generate a Telegram link code in Account, then send /link followed by that code here.')
    return
  }

  if (command === '/link') {
    const code = (parts[1] || '').toUpperCase()
    if (!/^[A-F0-9]{10}$/.test(code)) {
      await sendMessage(chatId, 'That link code is not valid. Generate a fresh code in your Mudaala Account and send /link CODE.')
      return
    }
    const codeHash = createHash('sha256').update(code).digest('hex')
    const key = 'telegram:link-code:' + codeHash
    const record = await db.appSetting.findUnique({ where: { key } })
    if (!record) {
      await sendMessage(chatId, 'That code is invalid or has already been used. Generate a new one in your Mudaala Account.')
      return
    }
    let payload: { userId?: unknown; expiresAt?: unknown }
    try { payload = JSON.parse(record.value) as typeof payload } catch { payload = {} }
    if (typeof payload.userId !== 'string' || typeof payload.expiresAt !== 'string' || !Number.isFinite(Date.parse(payload.expiresAt)) || Date.parse(payload.expiresAt) <= Date.now()) {
      await db.appSetting.deleteMany({ where: { key } })
      await sendMessage(chatId, 'That code has expired. Generate a new one in your Mudaala Account.')
      return
    }
    const user = await db.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, name: true, profile: { select: { businessName: true, shopCode: true } } },
    })
    if (!user) {
      await db.appSetting.deleteMany({ where: { key } })
      await sendMessage(chatId, 'The Mudaala account for that code could not be found. Generate a new code.')
      return
    }
    // Consume the one-time code before creating the account mapping. A concurrent
    // webhook delivery can therefore win only once.
    const consumed = await db.appSetting.deleteMany({ where: { key } })
    if (consumed.count !== 1) {
      await sendMessage(chatId, 'That code has already been used. Generate a new one in your Mudaala Account.')
      return
    }
    const mappingKey = telegramKey(telegramUserId)
    const existing = await db.appSetting.findUnique({ where: { key: mappingKey } })
    if (existing) {
      let old: { userId?: string } = {}
      try { old = JSON.parse(existing.value) as typeof old } catch { /* replace malformed mapping */ }
      if (old.userId && old.userId !== user.id) {
        await sendMessage(chatId, 'This Telegram account is already linked to another Mudaala account. Unlink it there before connecting a different shop.')
        return
      }
    }
    await db.appSetting.upsert({
      where: { key: mappingKey },
      create: { key: mappingKey, value: JSON.stringify({ userId: user.id, linkedAt: new Date().toISOString() }) },
      update: { value: JSON.stringify({ userId: user.id, linkedAt: new Date().toISOString() }) },
    })
    await sendMessage(chatId, 'Connected successfully to ' + (user.profile?.businessName || user.name) + '.\n\nSend /shop to get your shop link or /products to see active products.')
    return
  }

  const mapping = await db.appSetting.findUnique({ where: { key: telegramKey(telegramUserId) } })
  if (!mapping) {
    await sendMessage(chatId, 'Your Telegram account is not linked yet. Open Mudaala Account, generate a link code, then send /link CODE here.')
    return
  }
  let linked: { userId?: unknown }
  try { linked = JSON.parse(mapping.value) as typeof linked } catch { linked = {} }
  if (typeof linked.userId !== 'string') {
    await sendMessage(chatId, 'Your link needs to be refreshed. Generate a new code from Mudaala Account and link again.')
    return
  }

  const user = await db.user.findUnique({
    where: { id: linked.userId },
    select: { id: true, name: true, profile: { select: { businessName: true, shopCode: true } } },
  })
  if (!user) {
    await db.appSetting.deleteMany({ where: { key: telegramKey(telegramUserId) } })
    await sendMessage(chatId, 'The linked Mudaala account no longer exists. Link your account again.')
    return
  }

  if (command === '/shop') {
    await sendMessage(chatId, 'Your Mudaala shop: https://mudaala.store/#/shop/' + encodeURIComponent(user.id))
    return
  }
  if (command === '/products') {
    const listings = await db.listing.findMany({
      where: { userId: user.id, status: 'ACTIVE', isSeed: false, expiresAt: { gt: new Date() } },
      select: { title: true, price: true, currency: true, county: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    })
    if (!listings.length) {
      await sendMessage(chatId, 'You have no active products yet. Add products on Mudaala, then come back here to check your catalogue.')
      return
    }
    const lines = listings.map((item) => '- ' + item.title + ' — ' + (item.price === null ? 'Ask seller' : item.currency + ' ' + item.price.toLocaleString('en-UG')) + ' (' + item.county + ')')
    await sendMessage(chatId, 'Your latest active products:\n\n' + lines.join('\n') + '\n\nManage products on https://mudaala.store')
    return
  }
  await sendMessage(chatId, 'I did not recognise that command. Send /help to see what I can do.')
}

export async function POST(request: Request) {
  return route(async () => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!secret || !secretMatches(secret, request.headers.get('x-telegram-bot-api-secret-token'))) {
      throw new ApiError(401, 'Unauthorized')
    }
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (Number.isFinite(contentLength) && contentLength > 64 * 1024) throw new ApiError(413, 'Payload too large')
    const raw = await readBoundedBody(request, 64 * 1024)
    let update: TelegramUpdate
    try { update = JSON.parse(raw) as TelegramUpdate } catch { throw new ApiError(400, 'Invalid update') }
    if (!update || typeof update !== 'object' || !Number.isSafeInteger(update.update_id) || (update.update_id as number) < 0 || !update.message || typeof update.message !== 'object') return jsonOk({ ok: true })
    if (update.update_id % 100 === 0) {
      await cleanupTelegramRecords().catch((error) => {
        console.error('[telegram] housekeeping failed:', error instanceof Error ? error.name : 'unknown error')
      })
    }
    const updateKey = 'telegram:update:' + update.update_id
    try {
      // Reserve the update before sending a reply so parallel Telegram retries
      // cannot execute the same command twice.
      await db.appSetting.create({ data: { key: updateKey, value: new Date().toISOString() } })
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') return jsonOk({ ok: true })
      throw error
    }
    try {
      const chatId = update.message.chat?.id
      if (chatId) {
        const verdict = await hit('telegram:chat:' + chatId, 30, 60 * 1000)
        if (!verdict.ok) return jsonOk({ ok: true })
      }
      await handleMessage(update.message)
      return jsonOk({ ok: true })
    } catch (error) {
      await db.appSetting.deleteMany({ where: { key: updateKey } }).catch(() => undefined)
      throw error
    }
  })
}
