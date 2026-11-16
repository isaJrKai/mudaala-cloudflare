import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { ApiError, jsonOk, route } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { replyToTelegramMerchant } from '@/lib/telegram-assistant'
import { recordTelegramActivation } from '@/lib/telegram-merchant'
import { telegramApiUrl } from '@/lib/telegram-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type TelegramMessage = {
  text?: string
  chat?: { id?: number; type?: string }
  from?: { id?: number }
}
type TelegramCallbackQuery = { id?: string; data?: string; from?: { id?: number }; message?: TelegramMessage }
type TelegramUpdate = { update_id?: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery }

function secretMatches(expected: string, supplied: string | null): boolean {
  if (!supplied) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(supplied)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Telegram numeric IDs are enumerable. An unkeyed SHA-256 digest can be
// reversed by brute force, so buyer identity hashes must be keyed and
// domain-separated. This key is already required by production settings.
function buyerIdentityHash(telegramUserId: number): string {
  const key = process.env.SETTINGS_ENCRYPTION_KEY ?? process.env.SETTINGS_ENC_KEY
  if (!key) throw new Error('Settings encryption key is required to protect Telegram buyer identity')
  return createHmac('sha256', key)
    .update('mudaala:telegram-buyer:v1:', 'utf8')
    .update(String(telegramUserId), 'utf8')
    .digest('hex')
}

function telegramKey(id: number): string {
  const digest = createHash('sha256').update(String(id)).digest('hex')
  return 'telegram:user:' + digest
}

function telegramAccountKey(userId: string): string {
  return 'telegram:account:' + userId
}

function telegramChatKey(telegramUserId: number): string {
  const digest = createHash('sha256').update(String(telegramUserId)).digest('hex')
  return 'telegram:chat:' + digest
}

function telegramBuyerChatKey(telegramUserId: number): string {
  return 'telegram:buyer-chat:' + buyerIdentityHash(telegramUserId)
}

async function linkedMudaalaUserId(telegramUserId: number): Promise<string | null> {
  const mappingKey = telegramKey(telegramUserId)
  const mapping = await db.appSetting.findUnique({ where: { key: mappingKey } })
  if (!mapping) return null
  try {
    const value = JSON.parse(mapping.value) as { userId?: unknown }
    if (typeof value.userId !== 'string') return null
    const accountKey = telegramAccountKey(value.userId)
    const reverse = await db.appSetting.findUnique({ where: { key: accountKey } })
    if (reverse) return reverse.value === mappingKey ? value.userId : null

    // Backward-compatible lazy adoption: legacy accounts with exactly one
    // Telegram mapping remain linked; ambiguous legacy multi-links are denied
    // until the account owner links again and chooses one identity.
    const mappings = await db.appSetting.findMany({
      where: { key: { startsWith: 'telegram:user:' } },
      select: { key: true, value: true },
    })
    const owned = mappings.filter((item) => {
      try { return (JSON.parse(item.value) as { userId?: unknown }).userId === value.userId } catch { return false }
    })
    if (owned.length !== 1 || owned[0]?.key !== mappingKey) return null
    await db.appSetting.create({ data: { key: accountKey, value: mappingKey } }).catch((error) => {
      if ((error as { code?: string })?.code !== 'P2002') throw error
    })
    const adopted = await db.appSetting.findUnique({ where: { key: accountKey } })
    return adopted?.value === mappingKey ? value.userId : null
  } catch {
    return null
  }
}

async function sendMessage(chatId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('Telegram bot is not configured')
  const response = await fetch(telegramApiUrl(token, 'sendMessage'), {
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
  const response = await fetch(telegramApiUrl(token, 'setChatMenuButton'), {
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
  const staleConversations = await db.appSetting.findMany({
    where: { key: { startsWith: 'telegram:conversation:' }, updatedAt: { lt: new Date(now - 24 * 60 * 60 * 1000) } },
    select: { key: true },
    take: 100,
  })
  if (staleConversations.length) {
    await db.appSetting.deleteMany({ where: { key: { in: staleConversations.map((item) => item.key) } } })
  }
  // Keep short-lived contact capabilities bounded without deleting recent
  // records needed to explain an expired or already-used enquiry link.
  await db.enquiryContactToken.deleteMany({ where: { expiresAt: { lt: new Date(now - 24 * 60 * 60 * 1000) } } })
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
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}-]/gu, ''))
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
      id: true, title: true, price: true, currency: true, county: true, area: true, availabilityStatus: true, availabilityUpdatedAt: true,
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
    const reported = item.availabilityStatus === 'IN_STOCK' ? 'in stock' : item.availabilityStatus === 'AVAILABLE_ON_ORDER' ? 'available on order' : item.availabilityStatus === 'OUT_OF_STOCK' ? 'out of stock' : null
    const updated = item.availabilityUpdatedAt ? ' · seller update ' + item.availabilityUpdatedAt.toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
    const availability = reported ? 'Seller reports ' + reported + updated : 'Availability not confirmed'
    return (index + 1) + '. ' + item.title + '\n' + price + ' · ' + availability + (location ? ' · ' + location : '') + (shop ? '\nShop: ' + shop : '')
  })
  const inline_keyboard = listings.map((item) => [{
    text: 'View ' + item.title.slice(0, 32),
    url: 'https://mudaala.store/l/' + encodeURIComponent(item.id),
  }])
  await sendMessage(chatId, 'Active Mudaala listings for “' + query + '”:\n\n' + lines.join('\n\n') + '\n\nOpen a listing to see its details and contact the seller.', { inline_keyboard })
}


async function answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('Telegram bot is not configured')
  const response = await fetch(telegramApiUrl(token, 'answerCallbackQuery'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: true }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error('Telegram answerCallbackQuery failed')
  const result = await response.json() as { ok?: boolean }
  if (!result.ok) throw new Error('Telegram rejected callback acknowledgement')
}

async function startListingEnquiry(chatId: number, telegramUserId: number, rawToken: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{24,48}$/.test(rawToken)) {
    await sendMessage(chatId, 'That enquiry link is invalid or expired. Return to the product page and try again.')
    return
  }
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const capability = await db.enquiryContactToken.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    include: { listing: { select: { id: true, userId: true, type: true, isSeed: true, title: true, price: true, currency: true, county: true, area: true, status: true, expiresAt: true } } },
  })
  if (!capability || capability.listing.type !== 'OFFER' || capability.listing.isSeed || capability.listing.userId !== capability.merchantId || capability.listing.status !== 'ACTIVE' || capability.listing.expiresAt <= new Date()) {
    await sendMessage(chatId, 'That enquiry link has expired or the product is no longer active. Please return to Mudaala and try again.')
    return
  }
  if (capability.shopperId && await linkedMudaalaUserId(telegramUserId) !== capability.shopperId) {
    await sendMessage(chatId, 'This enquiry link was created from a signed-in Mudaala account. Link this same account to Telegram with /link CODE, then open the product link again.')
    return
  }
  const location = [capability.listing.area, capability.listing.county].filter(Boolean).join(', ')
  const price = capability.listing.price === null ? 'Ask seller' : capability.listing.currency + ' ' + capability.listing.price.toLocaleString('en-UG')
  await sendMessage(chatId,
    'You are enquiring about this Mudaala listing:\n\n' + capability.listing.title + '\n' + price + (location ? '\n' + location : '') + '\n\nSend an enquiry to this seller? The seller will be notified only after you confirm.',
    { inline_keyboard: [[{ text: 'Confirm enquiry', callback_data: 'enq:' + rawToken }], [{ text: 'Cancel', callback_data: 'enq-cancel' }]] })
}

async function confirmListingEnquiry(query: TelegramCallbackQuery): Promise<void> {
  const callbackId = query.id
  const chatId = query.message?.chat?.id
  const telegramUserId = query.from?.id
  const data = query.data || ''
  if (!callbackId) return
  if (!chatId || !telegramUserId || query.message?.chat?.type !== 'private' || chatId !== telegramUserId) {
    await answerCallbackQuery(callbackId, 'Open this enquiry from your own private chat with Mudaala.')
    return
  }
  if (data === 'enq-cancel') {
    await answerCallbackQuery(callbackId, 'Enquiry cancelled.')
    await sendMessage(chatId, 'No enquiry was sent. You can continue browsing Mudaala.')
    return
  }
  const rawToken = data.startsWith('enq:') ? data.slice(4) : ''
  if (!/^[A-Za-z0-9_-]{24,48}$/.test(rawToken)) {
    await answerCallbackQuery(callbackId, 'This enquiry link is invalid.')
    return
  }

  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const buyerHash = buyerIdentityHash(telegramUserId)
  const result = await db.$transaction(async (tx) => {
    const now = new Date()
    const capability = await tx.enquiryContactToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      include: {
        listing: {
          select: { id: true, userId: true, type: true, isSeed: true, title: true, status: true, expiresAt: true },
        },
      },
    })
    if (!capability) return { kind: 'invalid' as const }

    // Revalidate the exact listing and owner at confirmation time. A token
    // cannot outlive a delisted, expired, seeded or reassigned product.
    if (
      capability.listing.type !== 'OFFER' ||
      capability.listing.isSeed ||
      capability.listing.userId !== capability.merchantId ||
      capability.listing.status !== 'ACTIVE' ||
      capability.listing.expiresAt <= now
    ) return { kind: 'listing' as const }

    // A browser login is not proof of Telegram identity. Account-bound tokens
    // require the same Telegram account to have completed /link CODE.
    if (capability.shopperId) {
      const mapping = await tx.appSetting.findUnique({ where: { key: telegramKey(telegramUserId) } })
      let linkedUserId: string | null = null
      try {
        const parsed = JSON.parse(mapping?.value || '{}') as { userId?: unknown }
        if (typeof parsed.userId === 'string') linkedUserId = parsed.userId
      } catch { /* invalid mapping is not proof of identity */ }
      if (linkedUserId !== capability.shopperId) return { kind: 'identity' as const }
    }

    // Seller opt-in is checked inside the same transaction that consumes the
    // capability, so a stale opt-in read cannot create a new enquiry.
    const sellerSetting = await tx.appSetting.findUnique({
      where: { key: 'telegram:merchant:' + capability.merchantId },
    })
    let merchantChatId: number | null = null
    if (sellerSetting) {
      try {
        const settings = JSON.parse(sellerSetting.value) as { enabled?: unknown; activatedAt?: unknown; chatId?: unknown }
        if (settings.enabled === true && typeof settings.activatedAt === 'string' && Number.isSafeInteger(settings.chatId)) {
          merchantChatId = settings.chatId as number
        }
      } catch { /* malformed settings cannot receive enquiries */ }
    }
    if (merchantChatId === null) return { kind: 'seller' as const }

    const consumed = await tx.enquiryContactToken.updateMany({
      where: { id: capability.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    if (consumed.count !== 1) return { kind: 'used' as const }

    const enquiry = await tx.enquiry.create({
      data: {
        listingId: capability.listingId,
        merchantId: capability.merchantId,
        shopperId: capability.shopperId,
        buyerTelegramHash: buyerHash,
        contactChannel: 'TELEGRAM',
        messages: { create: { senderType: 'SHOPPER', body: 'Hello, I am interested in this listing.', deliveryStatus: 'PENDING' } },
      },
      include: { messages: true },
    })
    return { kind: 'created' as const, enquiry, merchantChatId, listingTitle: capability.listing.title }
  }, { isolationLevel: 'Serializable' })

  if (result.kind === 'invalid' || result.kind === 'listing') {
    await answerCallbackQuery(callbackId, 'This enquiry link has expired or the listing is no longer active.')
    return
  }
  if (result.kind === 'identity') {
    await answerCallbackQuery(callbackId, 'Link the same Mudaala account before confirming this enquiry.')
    await sendMessage(chatId, 'This enquiry link belongs to a signed-in Mudaala account. Link that same account with /link CODE before confirming.')
    return
  }
  if (result.kind === 'seller') {
    await answerCallbackQuery(callbackId, 'The seller is no longer accepting Telegram enquiries.')
    await sendMessage(chatId, 'The seller is no longer accepting Telegram enquiries. Please use the phone or WhatsApp contact on the listing.')
    return
  }
  if (result.kind === 'used') {
    await answerCallbackQuery(callbackId, 'This enquiry link has already been used.')
    return
  }

  await answerCallbackQuery(callbackId, 'Your enquiry has been created.')
  try {
    await sendMessage(result.merchantChatId,
      'New Mudaala enquiry\nProduct: ' + result.listingTitle + '\nBuyer: private Mudaala shopper\nEnquiry reference: ' + result.enquiry.id + '\n\nReply with /reply ' + result.enquiry.id + ' your message.',
      shopKeyboard)
    await db.enquiryMessage.update({ where: { id: result.enquiry.messages[0]!.id }, data: { deliveryStatus: 'SENT' } })
  } catch {
    await db.enquiryMessage.update({ where: { id: result.enquiry.messages[0]!.id }, data: { deliveryStatus: 'FAILED' } })
    await sendMessage(chatId, 'Your enquiry was saved, but Telegram could not notify the seller right now. Please use the phone or WhatsApp contact on the listing as an alternative.')
    return
  }
  await sendMessage(chatId, 'Your enquiry has been sent to the seller. Mudaala has kept your Telegram identity private.\n\nIf the seller replies, respond with /respond ' + result.enquiry.id + ' your message.')
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat?.id
  const telegramUserId = message.from?.id
  const text = (message.text || '').trim()
  if (!chatId || !telegramUserId || !text || message.chat?.type !== 'private') return

  const parts = text.split(/\s+/)
  const command = (parts[0] || '').split('@')[0].toLowerCase()
  const identityHash = createHash('sha256').update(String(telegramUserId)).digest('hex')
  if (command === '/start' || command === '/help') {
    if (command === '/start') {
      await recordTelegramActivation(telegramUserId, chatId).catch((error) => console.warn('[telegram] activation record failed:', error instanceof Error ? error.message : 'unknown error'))
      await db.appSetting.upsert({
        where: { key: 'telegram:chat:' + identityHash },
        create: { key: 'telegram:chat:' + identityHash, value: String(chatId) },
        update: { value: String(chatId) },
      })
      await db.appSetting.upsert({
        where: { key: telegramBuyerChatKey(telegramUserId) },
        create: { key: telegramBuyerChatKey(telegramUserId), value: String(chatId) },
        update: { value: String(chatId) },
      })
      if (parts[1]) {
        await startListingEnquiry(chatId, telegramUserId, parts[1])
        return
      }
    }
    await setShopMenuButton(chatId).catch((error) => console.warn('[telegram] could not set shop menu button:', error instanceof Error ? error.message : 'unknown error'))
    await sendMessage(chatId, 'Welcome to Mudaala.\n\nFind real products and shops with /search followed by what you need. Open a listing to view details and contact its seller.\n\nIf you run a shop, connect your Mudaala account with /link CODE, then use /shop or /products to manage it.\n\n/search <product> - find active Mudaala listings.\n/link CODE - connect your Mudaala account.\n/unlink - disconnect this Telegram account.\n/shop - open your merchant workspace.\n/publicshop - get your public shop link.\n/products - view your active products.\n/enquiries - view shopper enquiries.\n/messages - view your buyer enquiries.\n/reply ID message - reply to a shopper enquiry.\n/respond ID message - reply as a shopper.\n/followup ID yes|no - allow or revoke seller follow-up.\n/help - show these commands.', shopKeyboard)
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
    const mappingKey = telegramKey(telegramUserId)
    const now = new Date()
    try {
      await db.$transaction(async (tx) => {
        // Re-read and consume the exact one-time code inside the transaction.
        // If a concurrent request wins, this transaction rolls back in full.
        const liveCode = await tx.appSetting.findUnique({ where: { key } })
        if (!liveCode || liveCode.value !== record.value) throw new Error('TELEGRAM_LINK_CODE_USED')
        const livePayload = JSON.parse(liveCode.value) as { userId?: unknown; expiresAt?: unknown }
        if (livePayload.userId !== user.id || typeof livePayload.expiresAt !== 'string' || !Number.isFinite(Date.parse(livePayload.expiresAt)) || Date.parse(livePayload.expiresAt) <= now.getTime()) {
          throw new Error('TELEGRAM_LINK_CODE_EXPIRED')
        }

        const existing = await tx.appSetting.findUnique({ where: { key: mappingKey } })
        let previous: { userId?: string } = {}
        if (existing) {
          try { previous = JSON.parse(existing.value) as typeof previous } catch { /* malformed mapping can be repaired */ }
          if (previous.userId && previous.userId !== user.id) throw new Error('TELEGRAM_ALREADY_LINKED')
        }

        const consumed = await tx.appSetting.deleteMany({ where: { key, value: record.value } })
        if (consumed.count !== 1) throw new Error('TELEGRAM_LINK_CODE_USED')

        // Revoke every other Telegram identity previously attached to this
        // Mudaala account before making the new identity authoritative.
        const accountMappings = await tx.appSetting.findMany({
          where: { key: { startsWith: 'telegram:user:' } },
          select: { key: true, value: true },
        })
        const staleKeys = accountMappings.filter((item) => {
          if (item.key === mappingKey) return false
          try { return (JSON.parse(item.value) as { userId?: unknown }).userId === user.id } catch { return false }
        }).map((item) => item.key)
        if (staleKeys.length) {
          // A revoked identity must not remain a delivery destination for old
          // buyer enquiries. Remove its hashed chat route in the same transaction.
          const staleChatKeys = staleKeys.map((item) => 'telegram:chat:' + item.slice('telegram:user:'.length))
          await tx.appSetting.deleteMany({ where: { key: { in: [...staleKeys, ...staleChatKeys] } } })
        }

        const mappingValue = JSON.stringify({ userId: user.id, linkedAt: now.toISOString() })
        if (existing) {
          await tx.appSetting.update({ where: { key: mappingKey }, data: { value: mappingValue } })
        } else {
          // The unique key is the final concurrency guard: two different
          // account codes cannot race to overwrite one Telegram identity.
          await tx.appSetting.create({ data: { key: mappingKey, value: mappingValue } })
        }
        await tx.appSetting.upsert({
          where: { key: telegramAccountKey(user.id) },
          create: { key: telegramAccountKey(user.id), value: mappingKey },
          update: { value: mappingKey },
        })

        const merchantKey = 'telegram:merchant:' + user.id
        const merchantRecord = await tx.appSetting.findUnique({ where: { key: merchantKey } })
        let merchantSettings: { enabled?: unknown; activatedAt?: unknown; chatId?: unknown } = {}
        try { merchantSettings = JSON.parse(merchantRecord?.value || '{}') as typeof merchantSettings } catch { /* repair malformed settings */ }
        const nextSettings = {
          ...merchantSettings,
          chatId,
          activatedAt: typeof merchantSettings.activatedAt === 'string' ? merchantSettings.activatedAt : now.toISOString(),
        }
        await tx.appSetting.upsert({
          where: { key: merchantKey },
          create: { key: merchantKey, value: JSON.stringify(nextSettings) },
          update: { value: JSON.stringify(nextSettings) },
        })
      }, { isolationLevel: 'Serializable' })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'TELEGRAM_ALREADY_LINKED' || (error as { code?: string })?.code === 'P2002') {
        await sendMessage(chatId, 'This Telegram account is already linked to another Mudaala account. Unlink it there before connecting a different shop.')
        return
      }
      if (code === 'TELEGRAM_LINK_CODE_EXPIRED') {
        await sendMessage(chatId, 'That code has expired. Generate a new one in your Mudaala Account.')
        return
      }
      if (code === 'TELEGRAM_LINK_CODE_USED') {
        await sendMessage(chatId, 'That code has already been used. Generate a new one in your Mudaala Account.')
        return
      }
      throw error
    }
    await sendMessage(chatId, 'Connected successfully to ' + (user.profile?.businessName || user.name) + '.\n\nYour merchant workspace is ready. Open it below to manage your shop.', shopKeyboard)
    return
  }

  if (command === '/unlink') {
    const linkedUserId = await linkedMudaalaUserId(telegramUserId)
    if (!linkedUserId) {
      await sendMessage(chatId, 'This Telegram account is not currently linked to a Mudaala account.')
      return
    }
    const mappingKey = telegramKey(telegramUserId)
    await db.$transaction(async (tx) => {
      const reverseKey = telegramAccountKey(linkedUserId)
      const reverse = await tx.appSetting.findUnique({ where: { key: reverseKey } })
      if (reverse?.value === mappingKey) {
        await tx.appSetting.delete({ where: { key: reverseKey } })
      }
      await tx.appSetting.deleteMany({ where: { key: { in: [mappingKey, telegramChatKey(telegramUserId), telegramBuyerChatKey(telegramUserId)] } } })
      const merchantKey = 'telegram:merchant:' + linkedUserId
      const merchantRecord = await tx.appSetting.findUnique({ where: { key: merchantKey } })
      if (merchantRecord) {
        let settings: { enabled?: unknown; chatId?: unknown; activatedAt?: unknown } = {}
        try { settings = JSON.parse(merchantRecord.value) as typeof settings } catch { /* malformed settings are disabled */ }
        if (settings.chatId === chatId) {
          await tx.appSetting.update({
            where: { key: merchantKey },
            data: { value: JSON.stringify({ ...settings, enabled: false, chatId: null, activatedAt: null }) },
          })
        }
      }
    })
    await sendMessage(chatId, 'Your Telegram account has been disconnected from Mudaala. Merchant Telegram enquiries have been switched off. You can reconnect any time using a fresh /link CODE.')
    return
  }

  if (command === '/followup') {
    const enquiryId = parts[1] || ''
    const choice = (parts[2] || '').toLowerCase()
    if (!enquiryId || !['yes', 'no'].includes(choice)) {
      await sendMessage(chatId, 'Choose explicitly: /followup ENQUIRY_ID yes or /followup ENQUIRY_ID no')
      return
    }
    const buyerHash = buyerIdentityHash(telegramUserId)
    const changed = await db.enquiry.updateMany({
      where: { id: enquiryId, buyerTelegramHash: buyerHash, status: 'OPEN' },
      data: { followUpConsentAt: choice === 'yes' ? new Date() : null },
    })
    if (!changed.count) {
      await sendMessage(chatId, 'That open enquiry was not found for your Telegram account.')
      return
    }
    await sendMessage(chatId, choice === 'yes' ? 'You allowed the seller to send a later follow-up for this enquiry. You can revoke this any time with /followup ' + enquiryId + ' no.' : 'Seller follow-up permission has been turned off for this enquiry.')
    return
  }

  if (command === '/shop') {
    await setShopMenuButton(chatId).catch((error) => console.warn('[telegram] could not set shop menu button:', error instanceof Error ? error.message : 'unknown error'))
    await sendMessage(chatId, 'Open your Mudaala merchant workspace to manage your shop, products and performance.', shopKeyboard)
    return
  }

  const mapping = await db.appSetting.findUnique({ where: { key: telegramKey(telegramUserId) } })
  if (!mapping || await linkedMudaalaUserId(telegramUserId) === null) {
    if (command === '/messages') {
      const buyerHash = buyerIdentityHash(telegramUserId)
      const enquiries = await db.enquiry.findMany({
        where: { buyerTelegramHash: buyerHash, status: 'OPEN' },
        include: { listing: { select: { title: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { lastMessageAt: 'desc' },
        take: 10,
      })
      if (!enquiries.length) {
        await sendMessage(chatId, 'You have no open Mudaala enquiries yet.')
        return
      }
      const lines = enquiries.map((item) => item.listing.title + '\n' + 'Latest: ' + (item.messages[0]?.body || 'Enquiry created') + '\n' + '/respond ' + item.id + ' your message')
      await sendMessage(chatId, 'Your recent Mudaala enquiries:\n\n' + lines.join('\n\n'))
      return
    }
    if (command === '/respond') {
      const enquiryId = parts[1] || ''
      const replyText = parts.slice(2).join(' ').trim().slice(0, 1200)
      if (!enquiryId || !replyText) {
        await sendMessage(chatId, 'Use /respond ENQUIRY_ID your message')
        return
      }
      const buyerHash = buyerIdentityHash(telegramUserId)
      const enquiry = await db.enquiry.findFirst({
        where: { id: enquiryId, status: 'OPEN', buyerTelegramHash: buyerHash },
        select: { id: true, merchantId: true, listing: { select: { title: true } } },
      })
      if (!enquiry) {
        await sendMessage(chatId, 'That open enquiry was not found for your Telegram account.')
        return
      }
      const created = await db.enquiryMessage.create({
        data: { enquiryId, senderType: 'SHOPPER', body: replyText, deliveryStatus: 'PENDING' },
      })
      await db.enquiry.update({ where: { id: enquiryId }, data: { lastMessageAt: created.createdAt } })
      const setting = await db.appSetting.findUnique({ where: { key: 'telegram:merchant:' + enquiry.merchantId } })
      let merchantChatId: number | null = null
      if (setting) {
        try {
          const merchant = JSON.parse(setting.value) as { activatedAt?: unknown; chatId?: unknown }
          if (typeof merchant.activatedAt === 'string' && Number.isSafeInteger(merchant.chatId)) merchantChatId = merchant.chatId as number
        } catch { /* no active merchant Telegram destination */ }
      }
      let delivered = false
      if (merchantChatId !== null) {
        try {
          await sendMessage(merchantChatId, 'Mudaala enquiry · ' + enquiry.listing.title + '\nReference: ' + enquiry.id + '\n\n' + replyText)
          delivered = true
        } catch { delivered = false }
      }
      await db.enquiryMessage.update({ where: { id: created.id }, data: { deliveryStatus: delivered ? 'SENT' : 'FAILED' } })
      await sendMessage(chatId, delivered ? 'Your reply was sent to the seller.' : 'Your reply was saved, but Telegram could not deliver it.')
      return
    }
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

  if (command === '/messages') {
    const enquiries = await db.enquiry.findMany({
      where: { buyerTelegramHash: buyerIdentityHash(telegramUserId), status: 'OPEN' },
      include: { listing: { select: { title: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { lastMessageAt: 'desc' },
      take: 10,
    })
    if (!enquiries.length) {
      await sendMessage(chatId, 'You have no open Mudaala enquiries yet.')
      return
    }
    const lines = enquiries.map((item) => item.listing.title + '\nLatest: ' + (item.messages[0]?.body || 'Enquiry created') + '\n/respond ' + item.id + ' your message')
    await sendMessage(chatId, 'Your recent Mudaala enquiries:\n\n' + lines.join('\n\n'))
    return
  }

  if (command === '/followup') {
    const enquiryId = parts[1] || ''
    const choice = (parts[2] || '').toLowerCase()
    if (!enquiryId || !['yes', 'no'].includes(choice)) {
      await sendMessage(chatId, 'Choose explicitly: /followup ENQUIRY_ID yes or /followup ENQUIRY_ID no')
      return
    }
    const changed = await db.enquiry.updateMany({
      where: { id: enquiryId, status: 'OPEN', OR: [{ shopperId: user.id }, { buyerTelegramHash: buyerIdentityHash(telegramUserId) }] },
      data: { followUpConsentAt: choice === 'yes' ? new Date() : null },
    })
    if (!changed.count) {
      await sendMessage(chatId, 'That open enquiry was not found in your Mudaala account.')
      return
    }
    await sendMessage(chatId, choice === 'yes' ? 'You allowed a later seller follow-up for this enquiry.' : 'Seller follow-up permission has been turned off.')
    return
  }

  if (command === '/reply' || command === '/respond') {
    const enquiryId = parts[1] || ''
    const replyText = parts.slice(2).join(' ').trim().slice(0, 1200)
    if (!enquiryId || !replyText) {
      await sendMessage(chatId, 'Use /' + command.slice(1) + ' ENQUIRY_ID your message')
      return
    }
    const isMerchant = command === '/reply'
    const enquiry = await db.enquiry.findFirst({
      where: {
        id: enquiryId,
        status: 'OPEN',
        ...(isMerchant ? { merchantId: user.id } : { buyerTelegramHash: buyerIdentityHash(telegramUserId) }),
      },
      select: { id: true, merchantId: true, buyerTelegramHash: true, listing: { select: { title: true } } },
    })
    if (!enquiry) {
      await sendMessage(chatId, 'That open enquiry was not found for your account. Check the enquiry reference and try again.')
      return
    }
    const created = await db.enquiryMessage.create({
      data: {
        enquiryId: enquiry.id,
        senderType: isMerchant ? 'MERCHANT' : 'SHOPPER',
        senderUserId: isMerchant ? user.id : null,
        body: replyText,
        deliveryStatus: 'PENDING',
      },
    })
    await db.enquiry.update({ where: { id: enquiry.id }, data: { lastMessageAt: created.createdAt } })
    let destination: number | null = null
    if (isMerchant && enquiry.buyerTelegramHash) {
      const buyerChat = await db.appSetting.findUnique({ where: { key: 'telegram:buyer-chat:' + enquiry.buyerTelegramHash } })
      const value = buyerChat?.value ? Number(buyerChat.value) : NaN
      if (Number.isSafeInteger(value)) destination = value
    } else if (!isMerchant) {
      const merchantSetting = await db.appSetting.findUnique({ where: { key: 'telegram:merchant:' + enquiry.merchantId } })
      if (merchantSetting) {
        try {
          const settings = JSON.parse(merchantSetting.value) as { activatedAt?: unknown; chatId?: unknown }
          if (typeof settings.activatedAt === 'string' && Number.isSafeInteger(settings.chatId)) destination = settings.chatId as number
        } catch { /* no active merchant Telegram destination */ }
      }
    }
    let delivered = false
    if (destination !== null) {
      try {
        await sendMessage(destination, 'Mudaala enquiry · ' + enquiry.listing.title + '\nReference: ' + enquiry.id + '\n\n' + replyText)
        delivered = true
      } catch { delivered = false }
    }
    await db.enquiryMessage.update({ where: { id: created.id }, data: { deliveryStatus: delivered ? 'SENT' : 'FAILED' } })
    await sendMessage(chatId, delivered ? 'Your reply was sent.' : 'Your reply was saved, but Telegram could not deliver it. Please retry later.')
    return
  }

  if (command === '/messages') {
    const buyerHash = buyerIdentityHash(telegramUserId)
    const enquiries = await db.enquiry.findMany({
      where: { buyerTelegramHash: buyerHash, status: 'OPEN' },
      include: { listing: { select: { title: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { lastMessageAt: 'desc' },
      take: 10,
    })
    if (!enquiries.length) {
      await sendMessage(chatId, 'You have no open Mudaala enquiries yet.')
      return
    }
    const lines = enquiries.map((item) => item.listing.title + '\nLatest: ' + (item.messages[0]?.body || 'Enquiry created') + '\n/respond ' + item.id + ' your message')
    await sendMessage(chatId, 'Your recent Mudaala enquiries:\n\n' + lines.join('\n\n'))
    return
  }

  if (command === '/enquiries') {
    const enquiries = await db.enquiry.findMany({
      where: { merchantId: user.id, status: 'OPEN' },
      include: { listing: { select: { title: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { lastMessageAt: 'desc' },
      take: 10,
    })
    if (!enquiries.length) {
      await sendMessage(chatId, 'You have no open shopper enquiries yet.', shopKeyboard)
      return
    }
    const lines = enquiries.map((item) => item.listing.title + '\nLatest: ' + (item.messages[0]?.body || 'New enquiry') + '\n/reply ' + item.id + ' your message')
    await sendMessage(chatId, 'Your recent shopper enquiries:\n\n' + lines.join('\n\n'), shopKeyboard)
    return
  }

  if (!user.profile && ['/publicshop', '/products', '/enquiries', '/reply'].includes(command)) {
    await sendMessage(chatId, 'That command is for Mudaala shop owners. As a shopper, use /search, /messages and /respond. If you want to sell, open /shop to create a shop profile.')
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
    // An empty object still means the Telegram identity is linked; null is
    // reserved for users who have not linked a Mudaala account.
    shop: user.profile ? {
      businessName: user.profile.businessName,
      category: user.profile.category,
      county: user.profile.county,
      area: user.profile.area,
      description: user.profile.description,
      shopCode: user.profile.shopCode,
    } : {},
  })
  await sendMessage(chatId, answer, user.profile ? shopKeyboard : undefined)
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
    if (!update || typeof update !== 'object' || typeof updateId !== 'number' || !Number.isSafeInteger(updateId) || updateId < 0 || (!update.message && !update.callback_query)) return jsonOk({ ok: true })
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
      const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id
      if (chatId) {
        const verdict = await hit('telegram:chat:' + chatId, 30, 60 * 1000)
        if (!verdict.ok) return jsonOk({ ok: true })
      }
      if (update.callback_query) await confirmListingEnquiry(update.callback_query)
      else if (update.message) await handleMessage(update.message)
      return jsonOk({ ok: true })
    } catch (error) {
      await db.appSetting.deleteMany({ where: { key: updateKey } }).catch(() => undefined)
      throw error
    }
  })
}
