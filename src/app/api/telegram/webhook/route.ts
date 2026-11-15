import { createHash, timingSafeEqual } from 'node:crypto'
import { ApiError, jsonOk, route } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { replyToTelegramMerchant } from '@/lib/telegram-assistant'
import { recordTelegramActivation } from '@/lib/telegram-merchant'

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

async function sendMessage(chatId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('Telegram bot is not configured')
  const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error('Telegram sendMessage failed with HTTP ' + response.status)
  const result = await response.json() as { ok?: boolean }
  if (!result.ok) throw new Error('Telegram rejected sendMessage')
}

async function setShopMenuButton(chatId: number): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('Telegram bot is not configured')
  const response = await fetch('https://api.telegram.org/bot' + token + '/setChatMenuButton', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      menu_button: {
        type: 'web_app',
        text: 'My Shop',
        web_app: { url: 'https://mudaala.store/telegram' },
      },
    }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error('Telegram setChatMenuButton failed with HTTP ' + response.status)
  const result = await response.json() as { ok?: boolean }
  if (!result.ok) throw new Error('Telegram rejected setChatMenuButton')
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

const shopKeyboard = {
  keyboard: [[{ text: 'Open My Shop', web_app: { url: 'https://mudaala.store/telegram' } }]],
  resize_keyboard: true,
  is_persistent: true,
}

async function searchListings(chatId: number, rawQuery: string): Promise<void> {
  const query = rawQuery.trim().slice(0, 120)
  if (!query) {
    await sendMessage(chatId, 'What are you looking for? Try /search shoes or /search building materials.')
    return
  }
  const limit = await hit('telegram:search:' + chatId, 12, 60 * 60 * 1000)
  if (!limit.ok) {
    await sendMessage(chatId, 'You have made several searches recently. Please try again in a little while.')
    return
  }
  const terms = [...new Set(query.toLocaleLowerCase().normalize('NFKC')
    .split(/\\s+/)
    .map((term) => term.replace(/[^\\p{L}\\p{N}-]/gu, ''))
    .filter((term) => term.length >= 2))].slice(0, 5)
  if (!terms.length) {
    await sendMessage(chatId, 'Please include a product or service name with at least two letters.')
    return
  }
  const listings = await db.listing.findMany({
    where: {
      type: 'OFFER',
      status: 'ACTIVE',
      isSeed: false,
      expiresAt: { gt: new Date() },
      AND: terms.map((term) => ({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
          { category: { contains: term, mode: 'insensitive' } },
          { county: { contains: term, mode: 'insensitive' } },
          { area: { contains: term, mode: 'insensitive' } },
        ],
      })),
    },
    select: {
      id: true, title: true, price: true, currency: true, county: true, area: true,
      user: { select: { profile: { select: { businessName: true } } } },
    },
    orderBy: [{ refreshedAt: 'desc' }, { publishedAt: 'desc' }],
    take: 5,
  })
  if (!listings.length) {
    await sendMessage(chatId, 'I could not find an active Mudaala listing matching “' + query + '”. Try fewer or different words. You can also browse at https://mudaala.store.')
    return
  }
  const lines = listings.map((item, index) => {
    const price = item.price === null ? 'Ask seller' : item.currency + ' ' + item.price.toLocaleString('en-UG')
    const location = [item.area, item.county].filter(Boolean).join(', ')
    const shop = item.user.profile?.businessName
    return (index + 1) + '. ' + item.title + '\\n' + price + (location ? ' · ' + location : '') + (shop ? '\\nShop: ' + shop : '')
  })
  const inline_keyboard = listings.map((item) => [{
    text: 'View ' + item.title.slice(0, 32),
    url: 'https://mudaala.store/l/' + encodeURIComponent(item.id),
  }])
  await sendMessage(chatId, 'Active Mudaala listings for “' + query + '”:\\n\\n' + lines.join('\\n\\n') + '\\n\\nOpen a listing to see its details and contact the seller.', { inline_keyboard })
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat?.id
  const telegramUserId = message.from?.id
  const text = (message.text || '').trim()
  if (!chatId || !telegramUserId || !text || message.chat?.type !== 'private') return

  const parts = text.split(/\s+/)
  const command = (parts[0] || '').split('@')[0].toLowerCase()
  if (command === '/start' || command === '/help') {
    if (command === '/start') await recordTelegramActivation(telegramUserId, chatId).catch((error) => console.warn('[telegram] activation record failed:', error instanceof Error ? error.message : 'unknown error'))
    await setShopMenuButton(chatId).catch((error) => console.warn('[telegram] could not set shop menu button:', error instanceof Error ? error.message : 'unknown error'))
    await sendMessage(chatId, 'Welcome to Mudaala Merchant.\n\nOpen your shop workspace to manage your catalogue, shop details and performance.\n\n/link CODE - connect an existing Mudaala account.\n/shop - open your merchant workspace.\n/publicshop - get your public customer-facing shop link.\n/products - view your active products.\n/help - show these commands.\n\nNew to Mudaala? Tap Open My Shop to register and set up your shop inside Telegram.', shopKeyboard)
    return
  }

  if (command === '/search') {
    await searchListings(chatId, parts.slice(1).join(' '))
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
      select: { id: true, name: true, profile: { select: { businessName: true, shopCode: true, category: true, county: true, area: true, description: true } } },
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
    await recordTelegramActivation(telegramUserId, chatId)
    await sendMessage(chatId, 'Connected successfully to ' + (user.profile?.businessName || user.name) + '.\n\nYour merchant workspace is ready. Open it below to manage your shop.', shopKeyboard)
    return
  }

  if (command === '/shop') {
    await setShopMenuButton(chatId).catch((error) => console.warn('[telegram] could not set shop menu button:', error instanceof Error ? error.message : 'unknown error'))
    await sendMessage(chatId, 'Open your Mudaala merchant workspace to manage your shop, products and performance.', shopKeyboard)
    return
  }

  const mapping = await db.appSetting.findUnique({ where: { key: telegramKey(telegramUserId) } })
  if (!mapping) {
    const answer = await replyToTelegramMerchant({ telegramUserId, text })
    await sendMessage(chatId, answer, shopKeyboard)
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
    select: { id: true, name: true, profile: { select: { businessName: true, shopCode: true, category: true, county: true, area: true, description: true } } },
  })
  if (!user) {
    await db.appSetting.deleteMany({ where: { key: telegramKey(telegramUserId) } })
    await sendMessage(chatId, 'The linked Mudaala account no longer exists. Link your account again.')
    return
  }

  if (command === '/publicshop') {
    await sendMessage(chatId, 'Your public Mudaala shop link: https://mudaala.store/#/shop/' + encodeURIComponent(user.id))
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
      await sendMessage(chatId, 'You have no active products yet. Open your merchant workspace to create your first listing.', shopKeyboard)
      return
    }
    const lines = listings.map((item) => '- ' + item.title + ' - ' + (item.price === null ? 'Ask seller' : item.currency + ' ' + item.price.toLocaleString('en-UG')) + ' (' + item.county + ')')
    await sendMessage(chatId, 'Your latest active products:\n\n' + lines.join('\n') + '\n\nOpen your merchant workspace to add or manage products.', shopKeyboard)
    return
  }
  const answer = await replyToTelegramMerchant({
    telegramUserId,
    text,
    shop: user.profile ? {
      businessName: user.profile.businessName,
      category: user.profile.category,
      county: user.profile.county,
      area: user.profile.area,
      description: user.profile.description,
      shopCode: user.profile.shopCode,
    } : null,
  })
  await sendMessage(chatId, answer, shopKeyboard)
}

export async function POST(request: Request) {
  return route(async () => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET
    const suppliedSecret = request.headers.get('x-telegram-bot-api-secret-token')
    const authenticated = Boolean(secret && secretMatches(secret, suppliedSecret))
    if (!authenticated) {
      // Never log either secret or a digest. These metadata-only diagnostics
      // distinguish a missing runtime binding from a value/transport mismatch.
      console.warn('[telegram] webhook authentication rejected', {
        expectedPresent: Boolean(secret),
        expectedLength: secret?.length ?? 0,
        suppliedPresent: Boolean(suppliedSecret),
        suppliedLength: suppliedSecret?.length ?? 0,
      })
      throw new ApiError(401, 'Unauthorized')
    }
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (Number.isFinite(contentLength) && contentLength > 64 * 1024) throw new ApiError(413, 'Payload too large')
    const raw = await readBoundedBody(request, 64 * 1024)
    let update: TelegramUpdate
    try { update = JSON.parse(raw) as TelegramUpdate } catch { throw new ApiError(400, 'Invalid update') }
    const updateId = update?.update_id
    if (!update || typeof update !== 'object' || typeof updateId !== 'number' || !Number.isSafeInteger(updateId) || updateId < 0 || !update.message || typeof update.message !== 'object') return jsonOk({ ok: true })
    if (updateId % 100 === 0) {
      await cleanupTelegramRecords().catch((error) => {
        console.error('[telegram] housekeeping failed:', error instanceof Error ? error.name : 'unknown error')
      })
    }
    const updateKey = 'telegram:update:' + updateId
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
