import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { ApiError, jsonOk, route } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { replyToTelegramMerchant } from '@/lib/telegram-assistant'
import { recordTelegramActivation } from '@/lib/telegram-merchant'
import { telegramApiUrl } from '@/lib/telegram-api'
import { CATEGORY_KEYS } from '@/lib/constants'
import { listingCreateSchema } from '@/lib/validation'
import { publishListingForSeller } from '@/lib/listing-publisher'
import { importTelegramProductPhoto } from '@/lib/telegram-product-photo'
import { chooseStorage } from '@/lib/storage'
import { taxonomyAncestors } from '@/lib/product-taxonomy'
import { parseTelegramAttributes, resolveTelegramTaxonomyPath } from '@/lib/telegram-product-details'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type TelegramMessage = {
  text?: string
  caption?: string
  photo?: Array<{ file_id?: string; file_size?: number; width?: number; height?: number }>
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

async function setBotCommands(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('Telegram bot is not configured')
  const response = await fetch(telegramApiUrl(token, 'setMyCommands'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'start', description: 'Start using Mudaala' },
        { command: 'menu', description: 'Show merchant actions and help' },
        { command: 'post', description: 'Post a product using a photo' },
        { command: 'products', description: 'View your active products' },
        { command: 'collections', description: 'View your shop collections' },
        { command: 'enquiries', description: 'View customer enquiries' },
        { command: 'publicshop', description: 'Get your public shop link' },
        { command: 'search', description: 'Find products on Mudaala' },
        { command: 'help', description: 'Get help with Mudaala' },
      ],
    }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error('Telegram setMyCommands failed with HTTP ' + response.status)
  const result = await response.json() as { ok?: boolean }
  if (!result.ok) throw new Error('Telegram rejected setMyCommands')
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
  const staleProductDrafts = await db.appSetting.findMany({
    where: { key: { startsWith: 'telegram:product-draft:' }, updatedAt: { lt: new Date(now - 60 * 60 * 1000) } },
    select: { key: true, value: true },
    take: 100,
  })
  if (staleProductDrafts.length) {
    const storage = chooseStorage()
    for (const item of staleProductDrafts) {
      let draft: { photoUrl?: unknown; status?: unknown; draftId?: unknown; publishStartedAt?: unknown; listingId?: unknown } = {}
      try { draft = JSON.parse(item.value) as typeof draft } catch { /* malformed stale draft has no safe photo reference */ }
      if (draft.status === 'PUBLISHING') {
        if (typeof draft.draftId === 'string') {
          const receiptKey = 'listing-publish:' + createHash('sha256').update('telegram-product-draft:' + draft.draftId).digest('hex')
          const receipt = await db.appSetting.findUnique({ where: { key: receiptKey } })
          try {
            const parsed = JSON.parse(receipt?.value || '{}') as { status?: unknown; listingId?: unknown }
            if (parsed.status === 'COMPLETE' && typeof parsed.listingId === 'string') {
              await db.appSetting.deleteMany({ where: { key: item.key, value: item.value } })
              continue // the listing now owns the photo
            }
          } catch { /* no completed publication receipt */ }
        }
        const startedAt = typeof draft.publishStartedAt === 'string' ? Date.parse(draft.publishStartedAt) : 0
        if (now - startedAt >= 5 * 60 * 1000) {
          await db.appSetting.updateMany({
            where: { key: item.key, value: item.value },
            data: { value: JSON.stringify({ ...draft, status: 'READY', publishStartedAt: null }) },
          })
        }
        continue
      }
      // Delete only the exact stale value we inspected. A newer photo draft
      // may have replaced this key while storage cleanup was running.
      const deleted = await db.appSetting.deleteMany({ where: { key: item.key, value: item.value } })
      if (deleted.count !== 1) continue
      if (draft.status !== 'PUBLISHED' && typeof draft.photoUrl === 'string') {
        await storage.remove(draft.photoUrl).catch(() => undefined)
      }
    }
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
  keyboard: [
    [{ text: 'Post a product' }, { text: 'My products' }],
    [{ text: 'Customer enquiries' }, { text: 'My shop link' }],
    [{ text: 'Help & questions' }, { text: 'Open full workspace', web_app: { url: 'https://mudaala.store/telegram' } }],
  ],
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
        if (typeof settings.activatedAt === 'string' && Number.isSafeInteger(settings.chatId)) {
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
  const text = (message.text || message.caption || '').trim()
  if (!chatId || !telegramUserId || (!text && !message.photo?.length) || message.chat?.type !== 'private') return

  const normalizedText = text.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
  const shortcuts: Record<string, string> = {
    'my products': '/products',
    'customer enquiries': '/enquiries',
    'my shop link': '/publicshop',
    'help & questions': '/menu',
  }
  const routedText = shortcuts[normalizedText] || text
  const parts = routedText.split(/\s+/)
  const command = (parts[0] || '').split('@')[0].toLowerCase()
  const identityHash = createHash('sha256').update(String(telegramUserId)).digest('hex')

  // Everyday greetings are deterministic: don't spend an AI request on hello.
  if (/^(?:(?:hi|hello|hey)(?:(?:,\s*|\s+)(?:how are you(?: doing)?))?|good morning|good afternoon|good evening|how are you(?: doing)?)[!.?]*$/i.test(normalizedText)) {
    const linked = await linkedMudaalaUserId(telegramUserId)
    await sendMessage(chatId, linked
      ? 'Hello! I am here to help with your Mudaala shop. Send a product photo to post it, or choose one of the actions below.'
      : 'Hello! Welcome to Mudaala. You can search for products with /search. If you run a shop, connect your account with /link CODE. Type /menu to see the help options.',
      linked ? shopKeyboard : undefined)
    return
  }

  if (normalizedText === 'post a product' || command === '/post') {
    const linked = await linkedMudaalaUserId(telegramUserId)
    if (!linked) {
      await sendMessage(chatId, 'To post a product, first connect your Mudaala account. Generate a link code in Mudaala Account, then send /link CODE.')
    } else {
      await sendMessage(chatId, 'Great. Send one clear photo of the product here. I will ask you for its name and price next. You can cancel any time with /cancel.', shopKeyboard)
    }
    return
  }

  if (command === '/start' || command === '/help' || command === '/menu') {
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
    await setShopMenuButton(chatId).catch((error) => console.warn('[telegram] could not set chat menu:', error instanceof Error ? error.message : 'unknown error'))
    await setBotCommands().catch((error) => console.warn('[telegram] could not register commands:', error instanceof Error ? error.message : 'unknown error'))
    await sendMessage(chatId, 'Welcome to Mudaala.\n\nYou can use this chat to post products and manage customer enquiries. You do not need to learn commands. Choose an action below, or simply send a product photo.\n\nTo publish: send a product photo, then send its name and price, for example: Ladies handbag | 85000.\n\nFor account security, connect your Mudaala account with /link CODE. Never send your password or OTP here.\n\n/menu - show these options.\n/post - post a product.\n/products - view your active products.\n/enquiries - view customer enquiries.\n/publicshop - get your public shop link.\n/search - find active Mudaala listings.\n/cancel - discard a product photo draft.\n/unlink - disconnect this Telegram account.\n/help - show help.', shopKeyboard)
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
      select: { id: true, name: true, country: true, sellerGoogleExempt: true, profile: { select: { businessName: true, shopCode: true, category: true, county: true, area: true, description: true, phone: true, whatsapp: true } } },
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
    await sendMessage(chatId, 'Connected successfully to ' + (user.profile?.businessName || user.name) + '.\n\nYour shop is connected. Open My Shop for the full workspace, or use this chat to manage products and enquiries.', shopKeyboard)
    return
  }

  if (message.photo?.length) {
    const linkedUserId = await linkedMudaalaUserId(telegramUserId)
    if (!linkedUserId) {
      await sendMessage(chatId, 'To publish products, first connect your Mudaala shop with /link CODE. You can create a link code in Mudaala Account.')
      return
    }
    const photo = [...message.photo].reverse().find((item) => typeof item.file_id === 'string' && item.file_id.length > 0)
    if (!photo?.file_id) {
      await sendMessage(chatId, 'I could not read that photo. Please send it again.')
      return
    }
    const verdict = await hit('telegram:photo-upload:' + linkedUserId, 10, 60 * 60 * 1000)
    if (!verdict.ok) {
      await sendMessage(chatId, 'You have sent several product photos recently. Please wait a little before trying again.')
      return
    }
    try {
      const draftKey = 'telegram:product-draft:' + createHash('sha256').update(String(telegramUserId)).digest('hex')
      const previousDraft = await db.appSetting.findUnique({ where: { key: draftKey } })
      if (previousDraft) {
        try {
          const parsed = JSON.parse(previousDraft.value) as { status?: unknown }
          if (parsed.status === 'PUBLISHING') {
            await sendMessage(chatId, 'Your previous product is still being published. Please wait before sending another photo.')
            return
          }
        } catch { /* malformed draft is replaced below */ }
      }
      const photoUrl = await importTelegramProductPhoto(photo.file_id, linkedUserId)
      const nextDraft = JSON.stringify({
        userId: linkedUserId,
        draftId: randomBytes(16).toString('hex'),
        photoUrl,
        status: 'READY',
        createdAt: new Date().toISOString(),
      })
      let saved = false
      if (previousDraft) {
        const replaced = await db.appSetting.updateMany({
          where: { key: draftKey, value: previousDraft.value },
          data: { value: nextDraft },
        })
        saved = replaced.count === 1
      } else {
        try {
          await db.appSetting.create({ data: { key: draftKey, value: nextDraft } })
          saved = true
        } catch (error) {
          if ((error as { code?: string })?.code !== 'P2002') throw error
        }
      }
      if (!saved) {
        await chooseStorage().remove(photoUrl).catch(() => undefined)
        await sendMessage(chatId, 'Your product draft changed while I was receiving that photo. Please send the photo again.')
        return
      }
      if (previousDraft) {
        try {
          const previous = JSON.parse(previousDraft.value) as { photoUrl?: unknown; status?: unknown }
          // A published listing owns its photo; only reclaim an unconsumed draft image.
          if (previous.status !== 'PUBLISHED' && typeof previous.photoUrl === 'string' && previous.photoUrl !== photoUrl) {
            await chooseStorage().remove(previous.photoUrl).catch(() => undefined)
          }
        } catch { /* the new draft is saved; an invalid old draft needs no cleanup */ }
      }
      await sendMessage(chatId, 'Photo received and passed Mudaala photo safety checks. Send the product name and price first, then optional details separated by |:\n\nProduct name | 85000 | Phones & Electronics > Phones > Smartphones | Apple | iPhone 13 | condition=USED;storage=128GB | Used iPhones\n\nOptional fields are product type path, brand, model, attributes and collection. If the collection name is new, I will create it in your shop. Send /cancel to discard this photo.')
    } catch (error) {
      await sendMessage(chatId, error instanceof ApiError ? error.message : 'I could not process that photo right now. Please try again later.')
    }
    return
  }

  if (command === '/cancel') {
    const draftKey = 'telegram:product-draft:' + createHash('sha256').update(String(telegramUserId)).digest('hex')
    const existingDraft = await db.appSetting.findUnique({ where: { key: draftKey } })
    if (!existingDraft) {
      await sendMessage(chatId, 'You do not have a product photo draft to cancel.')
      return
    }
    let draft: { photoUrl?: unknown; status?: unknown; draftId?: unknown; publishStartedAt?: unknown; listingId?: unknown } = {}
    try { draft = JSON.parse(existingDraft.value) as typeof draft } catch { /* invalid draft can be removed by exact value */ }
    if (draft.status === 'PUBLISHED' && typeof draft.listingId === 'string') {
      await db.appSetting.deleteMany({ where: { key: draftKey, value: existingDraft.value } })
      await sendMessage(chatId, 'That product has already been published. View it at https://mudaala.store/l/' + encodeURIComponent(draft.listingId))
      return
    }
    if (draft.status === 'PUBLISHING') {
      const startedAt = typeof draft.publishStartedAt === 'string' ? Date.parse(draft.publishStartedAt) : Date.now()
      if (Date.now() - startedAt < 5 * 60 * 1000) {
        await sendMessage(chatId, 'This product is already being published, so I cannot cancel it while that is in progress.')
        return
      }
      if (typeof draft.draftId === 'string') {
        const receiptKey = 'listing-publish:' + createHash('sha256').update('telegram-product-draft:' + draft.draftId).digest('hex')
        const receipt = await db.appSetting.findUnique({ where: { key: receiptKey } })
        try {
          const parsed = JSON.parse(receipt?.value || '{}') as { status?: unknown; listingId?: unknown }
          if (parsed.status === 'COMPLETE' && typeof parsed.listingId === 'string') {
            await db.appSetting.deleteMany({ where: { key: draftKey, value: existingDraft.value } })
            await sendMessage(chatId, 'That product has already been published. View it at https://mudaala.store/l/' + encodeURIComponent(parsed.listingId))
            return
          }
        } catch { /* no completed publication receipt */ }
      }
    }
    const deleted = await db.appSetting.deleteMany({ where: { key: draftKey, value: existingDraft.value } })
    if (deleted.count !== 1) {
      await sendMessage(chatId, 'Your product draft changed before I could cancel it. Please try /cancel again.')
      return
    }
    if (typeof draft.photoUrl === 'string') await chooseStorage().remove(draft.photoUrl).catch(() => undefined)
    await sendMessage(chatId, 'The current product photo draft has been cancelled.')
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
    await sendMessage(chatId, 'Your Mudaala shop is connected. You can post products, view your catalogue and respond to customer enquiries here. The full workspace is still available if you need it.', shopKeyboard)
    return
  }

  // Buyer inbox and replies are keyed to the protected Telegram buyer hash;
  // they must remain usable for guest enquiries without merchant account linking.
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
    const lines = enquiries.map((item) => item.listing.title + '\\nLatest: ' + (item.messages[0]?.body || 'Enquiry created') + '\\n/respond ' + item.id + ' your message')
    await sendMessage(chatId, 'Your recent Mudaala enquiries:\\n\\n' + lines.join('\\n\\n'))
    return
  }

  if (command === '/respond') {
    const enquiryId = parts[1] || ''
    const replyText = parts.slice(2).join(' ').trim().slice(0, 1200)
    if (!enquiryId || !replyText) {
      await sendMessage(chatId, 'Use /respond ENQUIRY_ID your message')
      return
    }
    const enquiry = await db.enquiry.findFirst({
      where: { id: enquiryId, status: 'OPEN', buyerTelegramHash: buyerIdentityHash(telegramUserId) },
      select: { id: true, merchantId: true, listing: { select: { title: true } } },
    })
    if (!enquiry) {
      await sendMessage(chatId, 'That open enquiry was not found for your Telegram account. Check the enquiry reference and try again.')
      return
    }
    const created = await db.enquiryMessage.create({
      data: { enquiryId: enquiry.id, senderType: 'SHOPPER', senderUserId: null, body: replyText, deliveryStatus: 'PENDING' },
    })
    await db.enquiry.update({ where: { id: enquiry.id }, data: { lastMessageAt: created.createdAt } })
    const merchantSetting = await db.appSetting.findUnique({ where: { key: 'telegram:merchant:' + enquiry.merchantId } })
    let destination: number | null = null
    if (merchantSetting) {
      try {
        const settings = JSON.parse(merchantSetting.value) as { activatedAt?: unknown; chatId?: unknown }
        if (typeof settings.activatedAt === 'string' && Number.isSafeInteger(settings.chatId)) destination = settings.chatId as number
      } catch { /* no active merchant Telegram destination */ }
    }
    let delivered = false
    if (destination !== null) {
      try {
        await sendMessage(destination, 'Mudaala enquiry · ' + enquiry.listing.title + '\\nReference: ' + enquiry.id + '\\n\\n' + replyText)
        delivered = true
      } catch { delivered = false }
    }
    await db.enquiryMessage.update({ where: { id: created.id }, data: { deliveryStatus: delivered ? 'SENT' : 'FAILED' } })
    await sendMessage(chatId, delivered ? 'Your reply was sent.' : 'Your reply was saved, but Telegram could not deliver it. Please retry later.')
    return
  }

  const mapping = await db.appSetting.findUnique({ where: { key: telegramKey(telegramUserId) } })
  if (!mapping || await linkedMudaalaUserId(telegramUserId) === null) {
    await sendMessage(chatId, 'Connect your Mudaala account first with /link CODE. You can generate a code in Mudaala Account.')
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
    select: { id: true, name: true, country: true, sellerGoogleExempt: true, profile: { select: { businessName: true, shopCode: true, category: true, county: true, area: true, description: true, phone: true, whatsapp: true } } },
  })
  if (!user) {
    await db.appSetting.deleteMany({ where: { key: telegramKey(telegramUserId) } })
    await sendMessage(chatId, 'The linked Mudaala account no longer exists. Link your account again.')
    return
  }

  const draftKey = 'telegram:product-draft:' + createHash('sha256').update(String(telegramUserId)).digest('hex')
  const pendingDraft = await db.appSetting.findUnique({ where: { key: draftKey } })
  if (pendingDraft && !command.startsWith('/')) {
    let draft: { userId?: unknown; photoUrl?: unknown; createdAt?: unknown; draftId?: unknown; status?: unknown; publishStartedAt?: unknown; listingId?: unknown } = {}
    try { draft = JSON.parse(pendingDraft.value) as typeof draft } catch { /* invalid drafts are discarded below */ }
    const createdAt = typeof draft.createdAt === 'string' ? Date.parse(draft.createdAt) : NaN
    if (draft.userId !== user.id || typeof draft.photoUrl !== 'string' || !Number.isFinite(createdAt) || (draft.status !== 'PUBLISHING' && Date.now() - createdAt > 60 * 60 * 1000)) {
      if (draft.status === 'PUBLISHING') {
        await sendMessage(chatId, 'Your product is still being published. Please wait and check /products before starting another listing.')
        return
      }
      const deleted = await db.appSetting.deleteMany({ where: { key: draftKey, value: pendingDraft.value } })
      if (deleted.count === 1 && draft.status !== 'PUBLISHED' && typeof draft.photoUrl === 'string') {
        await chooseStorage().remove(draft.photoUrl).catch(() => undefined)
      }
      await sendMessage(chatId, 'That product photo draft expired. Send the photo again to start a new listing.')
      return
    }
    if (draft.status === 'PUBLISHED' && typeof draft.listingId === 'string') {
      await sendMessage(chatId, 'Your product has already been published: https://mudaala.store/l/' + encodeURIComponent(draft.listingId))
      return
    }
    if (draft.status === 'PUBLISHING') {
      const startedAt = typeof draft.publishStartedAt === 'string' ? Date.parse(draft.publishStartedAt) : Date.now()
      if (Date.now() - startedAt < 5 * 60 * 1000) {
        await sendMessage(chatId, 'I am already publishing this product. Please wait a moment; you do not need to send the details again.')
        return
      }
    }
    const partsForListing = text.split('|').map((part) => part.trim())
    const rawPrice = (partsForListing[1] || '').replace(/,/g, '')
    const price = /^\\d+(?:\\.\\d{1,2})?$/.test(rawPrice) ? Number(rawPrice) : NaN
    const title = partsForListing[0] || ''
    if (partsForListing.length < 2 || partsForListing.length > 7 || title.length < 4 || title.length > 120 || !Number.isFinite(price) || price < 0 || price > 100_000_000) {
      await sendMessage(chatId, 'Please send the product name and price first, then optional details separated by |. Example: Nike sneakers | 85000')
      return
    }
    const taxonomyPath = partsForListing[2] || ''
    const taxonomyNode = taxonomyPath ? resolveTelegramTaxonomyPath(taxonomyPath) : undefined
    if (taxonomyPath && !taxonomyNode) {
      await sendMessage(chatId, 'I could not match that product type. Use the full category path, for example: Phones & Electronics > Phones > Smartphones. You can also leave it out for now.')
      return
    }
    const taxonomyId = taxonomyNode?.id
    const category = taxonomyNode ? taxonomyAncestors(taxonomyNode.id)[0]?.id : user.profile?.category
    const brand = partsForListing[3] || null
    const model = partsForListing[4] || null
    const attributes = parseTelegramAttributes(partsForListing[5] || '', taxonomyId)
    const collectionTitle = partsForListing[6]?.trim() || ''
    if (brand && brand.length > 80 || model && model.length > 100 || collectionTitle.length > 80) {
      await sendMessage(chatId, 'Brand, model or collection name is too long. Please shorten it and send the details again.')
      return
    }
    const county = user.profile?.county
    const phone = user.profile?.phone
    if (!category || !CATEGORY_KEYS.includes(category) || !county || !phone) {
      await sendMessage(chatId, 'Before publishing, complete your shop category, district and contact phone in My Shop. Then send the product details here again.')
      return
    }
    const businessName = user.profile?.businessName || user.name
    const data = listingCreateSchema.safeParse({
      type: 'OFFER',
      title,
      description: title + ' offered by ' + businessName + '. Contact the shop for availability and product details.',
      category,
      taxonomyId: taxonomyId ?? null,
      brand,
      model,
      attributes,
      price,
      priceNegotiable: false,
      unit: category === 'services' ? null : 'piece',
      quantity: null,
      country: user.country || 'UG',
      county,
      area: user.profile?.area || null,
      contactPhone: phone,
      contactWhatsapp: user.profile?.whatsapp || null,
      photos: [draft.photoUrl],
    })
    if (!data.success) {
      const issue = data.error.issues[0]
      await sendMessage(chatId, issue?.message || 'I still need valid product details. Open My Shop to check your shop category, district and contact number.')
      return
    }
    if (process.env.SELLER_GOOGLE_REQUIRED?.trim().toLowerCase() === 'true' && !user.sellerGoogleExempt) {
      const googleIdentity = await db.googleIdentity.findUnique({
        where: { userId_provider: { userId: user.id, provider: 'google' } },
        select: { id: true },
      })
      if (!googleIdentity) {
        await sendMessage(chatId, 'Before publishing, link your Google account in Mudaala Settings. Your product photo draft is saved; return here and send the product name and price again after linking.')
        return
      }
    }

    const draftId = typeof draft.draftId === 'string'
      ? draft.draftId
      : createHash('sha256').update(draftKey + ':' + pendingDraft.updatedAt.toISOString() + ':' + String(draft.photoUrl)).digest('hex')
    const claimedDraft = {
      ...draft,
      draftId,
      status: 'PUBLISHING',
      publishStartedAt: new Date().toISOString(),
    }
    const claimedValue = JSON.stringify(claimedDraft)
    const claim = await db.appSetting.updateMany({
      where: { key: draftKey, value: pendingDraft.value },
      data: { value: claimedValue },
    })
    if (claim.count !== 1) {
      await sendMessage(chatId, 'Your product photo draft changed while I was preparing it. Please send the details again.')
      return
    }

    try {
      const listing = await publishListingForSeller({
        seller: { id: user.id, country: user.country },
        data: data.data,
        ipKey: 'telegram-' + chatId,
        idempotencyKey: 'telegram-product-draft:' + draftId,
      })
      if (collectionTitle) {
        const collection = await db.productCollection.findFirst({
          where: { userId: user.id, title: { equals: collectionTitle, mode: 'insensitive' } },
          select: { id: true },
        }) || await db.productCollection.create({
          data: {
            userId: user.id,
            title: collectionTitle,
            sortOrder: await db.productCollection.count({ where: { userId: user.id } }),
          },
          select: { id: true },
        })
        await db.productCollectionItem.createMany({
          data: [{ collectionId: collection.id, listingId: listing.id, sortOrder: await db.productCollectionItem.count({ where: { collectionId: collection.id } }) }],
          skipDuplicates: true,
        })
      }
      const consumed = await db.appSetting.deleteMany({ where: { key: draftKey, value: claimedValue } })
      if (consumed.count !== 1) {
        await db.appSetting.updateMany({
          where: { key: draftKey, value: claimedValue },
          data: { value: JSON.stringify({ ...claimedDraft, status: 'PUBLISHED', listingId: listing.id }) },
        })
      }
      await sendMessage(chatId, 'Your product is now published on Mudaala.' + (taxonomyNode ? '\nType: ' + taxonomyAncestors(taxonomyNode.id).map((node) => node.label).join(' > ') : '') + (brand ? '\nBrand: ' + brand : '') + (collectionTitle ? '\nCollection: ' + collectionTitle : '') + '\n' + title + ' · UGX ' + price.toLocaleString('en-UG') + '\n\nView product: https://mudaala.store/l/' + encodeURIComponent(listing.id), shopKeyboard)
    } catch (error) {
      await db.appSetting.updateMany({
        where: { key: draftKey, value: claimedValue },
        data: { value: JSON.stringify({ ...draft, draftId, status: 'READY', publishStartedAt: null }) },
      })
      await sendMessage(chatId, error instanceof ApiError ? error.message : 'I could not publish that product right now. Your photo draft is saved; please try again.')
    }
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
  if (command === '/collections') {
    const collections = await db.productCollection.findMany({
      where: { userId: user.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { title: true, _count: { select: { items: true } } },
      take: 30,
    })
    if (!collections.length) {
      await sendMessage(chatId, 'You have no collections yet. When posting a product, add a collection name as the last field and I will create it for your shop.', shopKeyboard)
      return
    }
    const lines = collections.map((item) => '- ' + item.title + ' (' + item._count.items + ' products)')
    await sendMessage(chatId, 'Your shop collections:\n\n' + lines.join('\n') + '\n\nTo assign a new product, add the collection title as the last field when sending its details. You can reuse a collection or create a new one.', shopKeyboard)
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
      await sendMessage(chatId, 'You have no active products yet. Send a product photo here to start adding one.', shopKeyboard)
      return
    }
    const lines = listings.map((item) => '- ' + item.title + ' - ' + (item.price === null ? 'Ask seller' : item.currency + ' ' + item.price.toLocaleString('en-UG')) + ' (' + item.county + ')')
    await sendMessage(chatId, 'Your latest active products:\n\n' + lines.join('\n') + '\n\nSend another product photo here to add a listing.', shopKeyboard)
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
