/**
 * Telegram commerce boundary tests.
 *
 * Run against the disposable CI database and local app:
 *   npx tsx scripts/test-telegram-commerce.ts
 *
 * Covers public/registered contact-token creation, self-enquiry prevention,
 * seller opt-in, saved-product persistence, account isolation and the 40-item
 * cap. It does not call Telegram or Groq.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { PrismaClient } from '@prisma/client'
import { listingCreateSchema } from '../src/lib/validation'
import { publishListingForSeller } from '../src/lib/listing-publisher'

const db = new PrismaClient()
const BASE = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
const userIds: string[] = []
const sessionIds: string[] = []
const settingKeys: string[] = []
const listingIds: string[] = []
const telegramRequests: Array<{ method: string; body: Record<string, unknown> }> = []
let telegramMock: Server | null = null
const TELEGRAM_WEBHOOK_SECRET = 'ci-telegram-webhook-secret'

type TestUser = { id: string; token: string; phone: string }

async function createUser(label: string): Promise<TestUser> {
  const phone = '+2567' + String(Math.floor(10_000_000 + Math.random() * 89_999_999))
  const user = await db.user.create({
    data: { phone, name: 'Telegram test ' + label + ' ' + suffix, country: 'UG', passwordHash: 'test-only-not-a-login-secret' },
    select: { id: true, phone: true },
  })
  userIds.push(user.id)
  const token = randomBytes(32).toString('hex')
  await db.session.create({ data: { id: token, userId: user.id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) } })
  sessionIds.push(token)
  return { id: user.id, phone: user.phone, token }
}

async function createListing(userId: string, phone: string, index: number) {
  const listing = await db.listing.create({
    data: {
      userId,
      type: 'OFFER',
      title: 'Telegram boundary test product ' + suffix + ' ' + index,
      description: 'A real database fixture used only by the Telegram commerce test.',
      category: 'electronics',
      price: 15000 + index,
      currency: 'UGX',
      county: 'Kampala',
      country: 'UG',
      contactPhone: phone,
      photos: '[]',
      expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  })
  listingIds.push(listing.id)
  return listing
}

async function requestJson(path: string, options: RequestInit = {}, token?: string) {
  const headers = new Headers(options.headers)
  headers.set('content-type', 'application/json')
  headers.set('origin', BASE)
  if (token) headers.set('authorization', 'Bearer ' + token)
  const response = await fetch(BASE + path, { ...options, headers })
  const body = await response.json().catch(() => ({}))
  return { status: response.status, body }
}

function assertStatus(actual: number, expected: number, label: string) {
  assert.equal(actual, expected, label + ': expected HTTP ' + expected + ', got ' + actual)
}

async function startTelegramMock() {
  telegramMock = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    request.on('end', () => {
      const method = (request.url || '').split('/').pop() || ''
      const body = JSON.parse(raw || '{}') as Record<string, unknown>
      telegramRequests.push({ method, body })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, result: { message_id: telegramRequests.length } }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    telegramMock!.once('error', reject)
    telegramMock!.listen(4010, '127.0.0.1', resolve)
  })
}

async function postTelegramUpdate(update: Record<string, unknown>) {
  const updateId = Number(update.update_id)
  if (Number.isSafeInteger(updateId)) settingKeys.push('telegram:update:' + updateId)
  const response = await fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': TELEGRAM_WEBHOOK_SECRET,
    },
    body: JSON.stringify(update),
  })
  const body = await response.json().catch(() => ({}))
  return { status: response.status, body }
}

async function run() {
  const webhookRegistration = await readFile(new URL('./register-telegram-webhook.mjs', import.meta.url), 'utf8')
  assert.match(webhookRegistration, /allowed_updates:\s*\[[^\]]*'message'[^\]]*'callback_query'/, 'Telegram webhook must subscribe to callback_query so buyers can confirm enquiries')
  const merchant = await createUser('merchant')
  const shopper = await createUser('shopper')
  const stranger = await createUser('stranger')
  await db.businessProfile.create({
    data: { userId: merchant.id, businessName: 'Telegram boundary test shop ' + suffix, phone: merchant.phone },
  })
  const merchantListing = await createListing(merchant.id, merchant.phone, 0)

  // A retry of the same server-side Telegram draft must return its original
  // listing, not create a second public listing.
  const idempotentListingData = listingCreateSchema.parse({
    type: 'OFFER',
    title: 'Telegram idempotency product ' + suffix,
    description: 'A test product used to verify safe retry behaviour for Telegram publishing.',
    category: 'electronics',
    price: 125000,
    priceNegotiable: false,
    unit: 'piece',
    quantity: null,
    county: 'Kampala',
    country: 'UG',
    area: null,
    contactPhone: merchant.phone,
    contactWhatsapp: null,
    photos: [],
  })
  const publicationKey = 'telegram-draft-test:' + suffix
  settingKeys.push('listing-publish:' + createHash('sha256').update(publicationKey).digest('hex'))
  const firstPublication = await publishListingForSeller({
    seller: { id: merchant.id, country: 'UG' },
    data: idempotentListingData,
    ipKey: 'telegram-test-' + suffix,
    idempotencyKey: publicationKey,
  })
  const retryPublication = await publishListingForSeller({
    seller: { id: merchant.id, country: 'UG' },
    data: idempotentListingData,
    ipKey: 'telegram-test-' + suffix,
    idempotencyKey: publicationKey,
  })
  listingIds.push(firstPublication.id)
  assert.equal(retryPublication.id, firstPublication.id, 'repeating a Telegram draft publication returns the original listing')
  assert.equal(await db.listing.count({ where: { id: firstPublication.id, userId: merchant.id } }), 1, 'idempotent publication creates only one listing')

  const merchantSettingKey = 'telegram:merchant:' + merchant.id
  settingKeys.push(merchantSettingKey)
  await db.appSetting.create({
    data: {
      key: merchantSettingKey,
      value: JSON.stringify({ enabled: true, activatedAt: new Date().toISOString(), chatId: 712345678 }),
    },
  })

  // Guest buyers can request a listing-bound link, but the raw capability is
  // returned only once and the database stores its digest.
  const guestTokenResponse = await requestJson('/api/telegram/contact-token', {
    method: 'POST',
    body: JSON.stringify({ listingId: merchantListing.id }),
  })
  assertStatus(guestTokenResponse.status, 201, 'guest contact token')
  assert.deepEqual(Object.keys(guestTokenResponse.body).sort(), ['expiresInSeconds', 'listingTitle', 'url'], 'public token response exposes no account or seller identifiers')
  const guestUrl = new URL(guestTokenResponse.body.url)
  const guestRawToken = guestUrl.searchParams.get('start')
  assert.ok(guestRawToken, 'guest Telegram URL contains a start token')
  const guestToken = await db.enquiryContactToken.findUnique({
    where: { tokenHash: createHash('sha256').update(guestRawToken!).digest('hex') },
  })
  assert.ok(guestToken, 'guest token digest persisted')
  assert.equal(guestToken.shopperId, null, 'guest token does not claim a Mudaala account')
  assert.ok(guestToken.expiresAt.getTime() > Date.now(), 'guest token expires in the future')
  assert.ok(guestToken.expiresAt.getTime() <= Date.now() + 10 * 60 * 1000 + 5000, 'guest token lifetime is bounded')

  // A signed-in shopper is attached to the capability, but the webhook
  // must prove that the Telegram identity is linked to this exact account.
  const accountTokenResponse = await requestJson('/api/telegram/contact-token', {
    method: 'POST',
    body: JSON.stringify({ listingId: merchantListing.id }),
  }, shopper.token)
  assertStatus(accountTokenResponse.status, 201, 'registered shopper contact token')
  const accountRawToken = new URL(accountTokenResponse.body.url).searchParams.get('start')
  assert.ok(accountRawToken, 'registered shopper Telegram URL contains a start token')
  const accountToken = await db.enquiryContactToken.findUnique({
    where: { tokenHash: createHash('sha256').update(accountRawToken!).digest('hex') },
  })
  assert.ok(accountToken, 'registered shopper token digest persisted')
  assert.equal(accountToken.shopperId, shopper.id, 'registered shopper identity is persisted on the capability')

  // Exercise the actual webhook and Bot API delivery code against a local mock.
  // No real Telegram messages or external API calls are made by this test.
  await startTelegramMock()
  const merchantTelegramId = 8_120_000_000 + Math.floor(Math.random() * 100_000)
  const buyerTelegramId = merchantTelegramId + 1
  const secondBuyerTelegramId = merchantTelegramId + 2
  const updateBase = 1_000_000 + Math.floor(Math.random() * 100_000)
  const merchantMappingKey = 'telegram:user:' + createHash('sha256').update(String(merchantTelegramId)).digest('hex')
  const merchantChatKey = 'telegram:chat:' + createHash('sha256').update(String(merchantTelegramId)).digest('hex')
  const buyerChatKey = 'telegram:chat:' + createHash('sha256').update(String(buyerTelegramId)).digest('hex')
  settingKeys.push(merchantMappingKey, merchantChatKey, buyerChatKey)

  const linkCodeResponse = await requestJson('/api/telegram/link-code', { method: 'POST', body: '{}' }, merchant.token)
  assertStatus(linkCodeResponse.status, 201, 'merchant Telegram link code')
  const linkCode = String(linkCodeResponse.body.code)
  const linkCodeKey = 'telegram:link-code:' + createHash('sha256').update(linkCode).digest('hex')
  settingKeys.push(linkCodeKey)
  const linked = await postTelegramUpdate({
    update_id: updateBase + 1,
    message: { text: '/link ' + linkCode, chat: { id: merchantTelegramId, type: 'private' }, from: { id: merchantTelegramId } },
  })
  assertStatus(linked.status, 200, 'Telegram merchant linking webhook')
  const merchantMapping = await db.appSetting.findUnique({ where: { key: merchantMappingKey } })
  assert.ok(merchantMapping, 'Telegram identity mapping is created')
  assert.equal((JSON.parse(merchantMapping.value) as { userId: string }).userId, merchant.id, 'Telegram identity maps to the intended merchant')
  const linkedMerchantSettings = await db.appSetting.findUnique({ where: { key: merchantSettingKey } })
  assert.ok(linkedMerchantSettings, 'merchant Telegram settings remain available')
  assert.equal((JSON.parse(linkedMerchantSettings.value) as { chatId: number }).chatId, merchantTelegramId, 'private chat destination is recorded')
  assert.equal((JSON.parse(linkedMerchantSettings.value) as { enabled: boolean }).enabled, true, 'linking preserves explicit enquiry opt-in')
  assert.equal(await db.appSetting.findUnique({ where: { key: linkCodeKey } }), null, 'link code is consumed exactly once')

  const conflictingCodeResponse = await requestJson('/api/telegram/link-code', { method: 'POST', body: '{}' }, stranger.token)
  assertStatus(conflictingCodeResponse.status, 201, 'second account link code')
  const conflictingCode = String(conflictingCodeResponse.body.code)
  const conflictingCodeKey = 'telegram:link-code:' + createHash('sha256').update(conflictingCode).digest('hex')
  settingKeys.push(conflictingCodeKey)
  const conflict = await postTelegramUpdate({
    update_id: updateBase + 2,
    message: { text: '/link ' + conflictingCode, chat: { id: merchantTelegramId, type: 'private' }, from: { id: merchantTelegramId } },
  })
  assertStatus(conflict.status, 200, 'conflicting Telegram link webhook')
  assert.ok(await db.appSetting.findUnique({ where: { key: conflictingCodeKey } }), 'conflicting account code is not consumed')
  const mappingAfterConflict = await db.appSetting.findUnique({ where: { key: merchantMappingKey } })
  assert.equal((JSON.parse(mappingAfterConflict!.value) as { userId: string }).userId, merchant.id, 'a Telegram identity cannot be reassigned by a competing code')

  // Link the shopper's Telegram identity to the same Mudaala account
  // before opening an account-bound enquiry capability.
  const shopperLinkCodeResponse = await requestJson('/api/telegram/link-code', { method: 'POST', body: '{}' }, shopper.token)
  assertStatus(shopperLinkCodeResponse.status, 201, 'shopper Telegram link code')
  const shopperLinkCode = String(shopperLinkCodeResponse.body.code)
  const shopperLinkCodeKey = 'telegram:link-code:' + createHash('sha256').update(shopperLinkCode).digest('hex')
  const shopperMappingKey = 'telegram:user:' + createHash('sha256').update(String(buyerTelegramId)).digest('hex')
  const shopperAccountKey = 'telegram:account:' + shopper.id
  const shopperTelegramSettingsKey = 'telegram:merchant:' + shopper.id
  settingKeys.push(shopperLinkCodeKey, shopperMappingKey, shopperAccountKey, shopperTelegramSettingsKey)
  const shopperLinked = await postTelegramUpdate({
    update_id: updateBase + 30,
    message: { text: '/link ' + shopperLinkCode, chat: { id: buyerTelegramId, type: 'private' }, from: { id: buyerTelegramId } },
  })
  assertStatus(shopperLinked.status, 200, 'shopper Telegram identity linking')
  const shopperMapping = await db.appSetting.findUnique({ where: { key: shopperMappingKey } })
  assert.equal((JSON.parse(shopperMapping!.value) as { userId: string }).userId, shopper.id, 'shopper Telegram identity is linked to the intended account')
  const shopperTelegramStatus = await requestJson('/api/telegram/merchant', {}, shopper.token)
  assertStatus(shopperTelegramStatus.status, 200, 'linked shopper Telegram settings')
  assert.equal(shopperTelegramStatus.body.connected, true, 'shopper account connection is recorded')
  assert.equal(shopperTelegramStatus.body.hasShopProfile, false, 'shopper is not misclassified as a merchant')
  assert.equal(shopperTelegramStatus.body.enabled, false, 'shopper account cannot silently opt into seller enquiries')
  const shopperCannotOptIn = await requestJson('/api/telegram/merchant', {
    method: 'PUT', body: JSON.stringify({ enabled: true }),
  }, shopper.token)
  assertStatus(shopperCannotOptIn.status, 409, 'shopper cannot enable seller enquiries without a shop profile')

  // A forwarded account-bound token must not create an enquiry for the wrong
  // Mudaala account, even if the other Telegram user presses a crafted callback.
  const mismatchedChatId = secondBuyerTelegramId
  settingKeys.push('telegram:chat:' + createHash('sha256').update(String(mismatchedChatId)).digest('hex'))
  const mismatchedStart = await postTelegramUpdate({
    update_id: updateBase + 31,
    message: { text: '/start ' + accountRawToken, chat: { id: mismatchedChatId, type: 'private' }, from: { id: mismatchedChatId } },
  })
  assertStatus(mismatchedStart.status, 200, 'mismatched account-bound link start')
  assert.ok(!telegramRequests.some((item) => item.method === 'sendMessage' && item.body.chat_id === mismatchedChatId && item.body.reply_markup), 'mismatched Telegram identity receives no confirmation action')
  const mismatchedCallback = await postTelegramUpdate({
    update_id: updateBase + 32,
    callback_query: {
      id: 'mismatched-' + suffix,
      from: { id: mismatchedChatId },
      message: { chat: { id: mismatchedChatId, type: 'private' } },
      data: 'enq:' + accountRawToken,
    },
  })
  assertStatus(mismatchedCallback.status, 200, 'mismatched account-bound confirmation callback')
  const stillUnusedAccountToken = await db.enquiryContactToken.findUnique({ where: { tokenHash: accountToken.tokenHash } })
  assert.equal(stillUnusedAccountToken?.usedAt, null, 'wrong Telegram identity cannot consume account-bound token')

  const started = await postTelegramUpdate({
    update_id: updateBase + 3,
    message: { text: '/start ' + accountRawToken, chat: { id: buyerTelegramId, type: 'private' }, from: { id: buyerTelegramId } },
  })
  assertStatus(started.status, 200, 'buyer listing deep-link start')
  const confirmationMessage = telegramRequests.find((item) => item.method === 'sendMessage' && item.body.chat_id === buyerTelegramId && item.body.reply_markup && String(item.body.text).includes('You are enquiring about this Mudaala listing'))
  assert.ok(confirmationMessage, 'buyer receives an explicit enquiry confirmation message')
  const markup = confirmationMessage.body.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
  const callbackData = markup.inline_keyboard?.[0]?.[0]?.callback_data
  assert.ok(callbackData?.startsWith('enq:'), 'confirmation button carries the one-time enquiry capability')

  const confirmed = await postTelegramUpdate({
    update_id: updateBase + 4,
    callback_query: {
      id: 'confirm-' + suffix,
      from: { id: buyerTelegramId },
      message: { chat: { id: buyerTelegramId, type: 'private' } },
      data: callbackData,
    },
  })
  assertStatus(confirmed.status, 200, 'buyer enquiry confirmation callback')
  const buyerHash = createHmac('sha256', process.env.SETTINGS_ENCRYPTION_KEY || process.env.SETTINGS_ENC_KEY || '').update('mudaala:telegram-buyer:v1:').update(String(buyerTelegramId)).digest('hex')
  const enquiry = await db.enquiry.findFirst({
    where: { listingId: merchantListing.id, shopperId: shopper.id, buyerTelegramHash: buyerHash },
    include: { messages: true },
  })
  assert.ok(enquiry, 'confirmation creates one enquiry linked to the signed-in shopper')
  assert.equal(enquiry.messages.length, 1, 'confirmation creates the initial enquiry message once')
  assert.equal(enquiry.messages[0]!.deliveryStatus, 'SENT', 'seller notification delivery is recorded')
  const consumedToken = await db.enquiryContactToken.findUnique({ where: { tokenHash: accountToken.tokenHash } })
  assert.ok(consumedToken?.usedAt, 'confirmation consumes the single-use token')
  const sellerNotice = telegramRequests.find((item) => item.method === 'sendMessage' && item.body.chat_id === merchantTelegramId && String(item.body.text).includes(enquiry.id))
  assert.ok(sellerNotice, 'only the selected seller receives the enquiry')
  assert.ok(String(sellerNotice.body.text).includes('private Mudaala shopper'), 'seller receives a privacy-safe buyer label')
  assert.ok(!String(sellerNotice.body.text).includes(String(buyerTelegramId)), 'seller is not shown the buyer Telegram identifier')

  const shopperInbox = await requestJson('/api/enquiries', {}, shopper.token)
  assertStatus(shopperInbox.status, 200, 'registered shopper enquiry inbox')
  assert.ok(shopperInbox.body.enquiries.some((item: { id: string; role: string }) => item.id === enquiry.id && item.role === 'SHOPPER'), 'registered shopper can see their enquiry in Mudaala')
  const merchantInbox = await requestJson('/api/enquiries', {}, merchant.token)
  assert.ok(merchantInbox.body.enquiries.some((item: { id: string; role: string }) => item.id === enquiry.id && item.role === 'MERCHANT'), 'merchant can see the selected buyer enquiry')
  const strangerInbox = await requestJson('/api/enquiries', {}, stranger.token)
  assert.ok(!strangerInbox.body.enquiries.some((item: { id: string }) => item.id === enquiry.id), 'unrelated account cannot see the enquiry')
  const strangerMessages = await requestJson('/api/enquiries/' + encodeURIComponent(enquiry.id) + '/messages', {}, stranger.token)
  assertStatus(strangerMessages.status, 404, 'unrelated account cannot read enquiry messages')

  const merchantReply = 'The seller can confirm the item at the shop today.'
  const sellerReplyUpdate = await postTelegramUpdate({
    update_id: updateBase + 5,
    message: { text: '/reply ' + enquiry.id + ' ' + merchantReply, chat: { id: merchantTelegramId, type: 'private' }, from: { id: merchantTelegramId } },
  })
  assertStatus(sellerReplyUpdate.status, 200, 'merchant Telegram reply')
  const buyerReplyDelivery = telegramRequests.find((item) => item.method === 'sendMessage' && item.body.chat_id === buyerTelegramId && String(item.body.text).includes(merchantReply))
  assert.ok(buyerReplyDelivery, 'merchant reply is relayed to the buyer private chat')

  const shopperReply = 'I can visit tomorrow afternoon.'
  const shopperReplyUpdate = await postTelegramUpdate({
    update_id: updateBase + 6,
    message: { text: '/respond ' + enquiry.id + ' ' + shopperReply, chat: { id: buyerTelegramId, type: 'private' }, from: { id: buyerTelegramId } },
  })
  assertStatus(shopperReplyUpdate.status, 200, 'shopper Telegram reply')
  const merchantReplyDelivery = telegramRequests.find((item) => item.method === 'sendMessage' && item.body.chat_id === merchantTelegramId && String(item.body.text).includes(shopperReply))
  assert.ok(merchantReplyDelivery, 'shopper reply is relayed only to the selected seller')

  await postTelegramUpdate({ update_id: updateBase + 7, message: { text: '/followup ' + enquiry.id + ' yes', chat: { id: buyerTelegramId, type: 'private' }, from: { id: buyerTelegramId } } })
  const consented = await db.enquiry.findUnique({ where: { id: enquiry.id }, select: { followUpConsentAt: true } })
  assert.ok(consented?.followUpConsentAt, 'buyer can explicitly grant follow-up consent in Telegram')
  await postTelegramUpdate({ update_id: updateBase + 8, message: { text: '/followup ' + enquiry.id + ' no', chat: { id: buyerTelegramId, type: 'private' }, from: { id: buyerTelegramId } } })
  const revoked = await db.enquiry.findUnique({ where: { id: enquiry.id }, select: { followUpConsentAt: true } })
  assert.equal(revoked?.followUpConsentAt, null, 'buyer can revoke follow-up consent in Telegram')

  const buyerMessagesCommand = await postTelegramUpdate({
    update_id: updateBase + 11,
    message: { text: '/messages', chat: { id: buyerTelegramId, type: 'private' }, from: { id: buyerTelegramId } },
  })
  assertStatus(buyerMessagesCommand.status, 200, 'buyer Telegram inbox command')
  assert.ok(telegramRequests.some((item) => item.method === 'sendMessage' && item.body.chat_id === buyerTelegramId && String(item.body.text).includes(enquiry.id)), 'buyer inbox command lists their enquiry reference')
  const merchantEnquiriesCommand = await postTelegramUpdate({
    update_id: updateBase + 12,
    message: { text: '/enquiries', chat: { id: merchantTelegramId, type: 'private' }, from: { id: merchantTelegramId } },
  })
  assertStatus(merchantEnquiriesCommand.status, 200, 'merchant Telegram inbox command')
  assert.ok(telegramRequests.some((item) => item.method === 'sendMessage' && item.body.chat_id === merchantTelegramId && String(item.body.text).includes(enquiry.id)), 'merchant inbox command lists their shopper enquiry')
  settingKeys.push('telegram:chat:' + createHash('sha256').update(String(merchantTelegramId)).digest('hex'))
  const merchantStart = await postTelegramUpdate({
    update_id: updateBase + 20,
    message: { text: '/start', chat: { id: merchantTelegramId, type: 'private' }, from: { id: merchantTelegramId } },
  })
  assertStatus(merchantStart.status, 200, 'linked merchant start command')
  assert.ok(telegramRequests.some((item) => item.method === 'setChatMenuButton' && (item.body.menu_button as { type?: string; text?: string })?.type === 'web_app' && (item.body.menu_button as { type?: string; text?: string })?.text === 'My Shop'), 'linked merchant start configures Telegram menu to show bot commands')
  assert.ok(telegramRequests.some((item) => item.method === 'setMyCommands'), 'linked merchant start registers the human-readable command menu')
  assert.ok(await db.appSetting.findUnique({ where: { key: merchantChatKey } }), 'merchant /start creates a private chat route')

  const greeting = await postTelegramUpdate({
    update_id: updateBase + 21,
    message: { text: 'Hello, how are you?', chat: { id: merchantTelegramId, type: 'private' }, from: { id: merchantTelegramId } },
  })
  assertStatus(greeting.status, 200, 'ordinary greeting')
  const greetingMessage = telegramRequests.filter((item) => item.method === 'sendMessage' && item.body.chat_id === merchantTelegramId).at(-1)
  assert.ok(greetingMessage && String(greetingMessage.body.text).includes('Hello! I am here to help'), 'ordinary greetings receive a deterministic response')

  const postPrompt = await postTelegramUpdate({
    update_id: updateBase + 22,
    message: { text: 'Post a product', chat: { id: merchantTelegramId, type: 'private' }, from: { id: merchantTelegramId } },
  })
  assertStatus(postPrompt.status, 200, 'merchant post-a-product menu action')
  const postPromptMessage = telegramRequests.filter((item) => item.method === 'sendMessage' && item.body.chat_id === merchantTelegramId).at(-1)
  assert.ok(postPromptMessage && String(postPromptMessage.body.text).includes('Send one clear photo'), 'post-a-product menu action starts the photo workflow')

  const assistantFallback = await postTelegramUpdate({
    update_id: updateBase + 13,
    message: { text: 'Can you tell me what products are available?', chat: { id: buyerTelegramId, type: 'private' }, from: { id: buyerTelegramId } },
  })
  assertStatus(assistantFallback.status, 200, 'assistant fallback webhook')
  const fallbackMessage = telegramRequests.filter((item) => item.method === 'sendMessage' && item.body.chat_id === buyerTelegramId).at(-1)
  assert.ok(fallbackMessage && String(fallbackMessage.body.text).includes('assistant is unavailable') && String(fallbackMessage.body.text).includes('/search'), 'without a provider key, assistant gives a truthful discovery fallback')
  assert.ok(!String(fallbackMessage?.body.text).includes('Open My Shop'), 'shopper fallback does not assume the user is a merchant')

  const webReply = await requestJson('/api/enquiries/' + encodeURIComponent(enquiry.id) + '/messages', {
    method: 'POST', body: JSON.stringify({ message: 'A message sent from the Mudaala web inbox.' }),
  }, merchant.token)
  assertStatus(webReply.status, 201, 'merchant web inbox reply')
  assert.ok(telegramRequests.some((item) => item.method === 'sendMessage' && item.body.chat_id === buyerTelegramId && String(item.body.text).includes('Mudaala web inbox')), 'web inbox reply is delivered through the Telegram API')
  const shopperWebReply = await requestJson('/api/enquiries/' + encodeURIComponent(enquiry.id) + '/messages', {
    method: 'POST', body: JSON.stringify({ message: 'A shopper reply sent from the Mudaala web inbox.' }),
  }, shopper.token)
  assertStatus(shopperWebReply.status, 201, 'shopper web inbox reply')
  assert.ok(telegramRequests.some((item) => item.method === 'sendMessage' && item.body.chat_id === merchantTelegramId && String(item.body.text).includes('shopper reply sent from the Mudaala web inbox')), 'shopper web reply is delivered only to the selected merchant')

  const shopperConsent = await requestJson('/api/enquiries/' + encodeURIComponent(enquiry.id) + '/follow-up-consent', {
    method: 'PATCH', body: JSON.stringify({ consent: true }),
  }, shopper.token)
  assertStatus(shopperConsent.status, 200, 'shopper web follow-up consent')
  assert.ok(shopperConsent.body.followUpConsentAt, 'web inbox consent is persisted')
  const strangerConsent = await requestJson('/api/enquiries/' + encodeURIComponent(enquiry.id) + '/follow-up-consent', {
    method: 'PATCH', body: JSON.stringify({ consent: false }),
  }, stranger.token)
  assertStatus(strangerConsent.status, 404, 'unrelated account cannot change follow-up consent')

  settingKeys.push('telegram:chat:' + createHash('sha256').update(String(secondBuyerTelegramId)).digest('hex'))
  const secondStarted = await postTelegramUpdate({
    update_id: updateBase + 9,
    message: { text: '/start ' + guestRawToken, chat: { id: secondBuyerTelegramId, type: 'private' }, from: { id: secondBuyerTelegramId } },
  })
  assertStatus(secondStarted.status, 200, 'second buyer listing deep-link start')
  const secondConfirmation = telegramRequests.find((item) => item.method === 'sendMessage' && item.body.chat_id === secondBuyerTelegramId && item.body.reply_markup)
  assert.ok(secondConfirmation, 'second buyer receives a confirmation button')
  const secondMarkup = secondConfirmation.body.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
  const forwardedCallback = await postTelegramUpdate({
    update_id: updateBase + 10,
    callback_query: {
      id: 'forwarded-' + suffix,
      from: { id: secondBuyerTelegramId + 1 },
      message: { chat: { id: secondBuyerTelegramId, type: 'private' } },
      data: secondMarkup.inline_keyboard?.[0]?.[0]?.callback_data,
    },
  })
  assertStatus(forwardedCallback.status, 200, 'forwarded confirmation callback is safely rejected')
  const unusedGuestToken = await db.enquiryContactToken.findUnique({ where: { tokenHash: guestToken.tokenHash } })
  assert.equal(unusedGuestToken?.usedAt, null, 'another Telegram user cannot consume a buyer confirmation')
  const enquiriesForListing = await db.enquiry.count({ where: { listingId: merchantListing.id } })
  assert.equal(enquiriesForListing, 1, 'forwarded callback does not create a second enquiry')

  // A guest buyer who has not linked a Mudaala account can still read and
  // continue the enquiry they explicitly confirmed in Telegram.
  const validGuestConfirmation = await postTelegramUpdate({
    update_id: updateBase + 23,
    callback_query: {
      id: 'valid-guest-' + suffix,
      from: { id: secondBuyerTelegramId },
      message: { chat: { id: secondBuyerTelegramId, type: 'private' } },
      data: secondMarkup.inline_keyboard?.[0]?.[0]?.callback_data,
    },
  })
  assertStatus(validGuestConfirmation.status, 200, 'guest buyer enquiry confirmation')
  const secondBuyerHash = createHmac('sha256', process.env.SETTINGS_ENCRYPTION_KEY || process.env.SETTINGS_ENC_KEY || '')
    .update('mudaala:telegram-buyer:v1:').update(String(secondBuyerTelegramId)).digest('hex')
  const guestEnquiry = await db.enquiry.findFirst({
    where: { listingId: merchantListing.id, buyerTelegramHash: secondBuyerHash },
  })
  assert.ok(guestEnquiry, 'guest buyer enquiry is persisted without requiring account linking')

  const guestMessages = await postTelegramUpdate({
    update_id: updateBase + 24,
    message: { text: '/messages', chat: { id: secondBuyerTelegramId, type: 'private' }, from: { id: secondBuyerTelegramId } },
  })
  assertStatus(guestMessages.status, 200, 'unlinked guest buyer messages command')
  assert.ok(telegramRequests.some((item) => item.method === 'sendMessage' && item.body.chat_id === secondBuyerTelegramId && String(item.body.text).includes(guestEnquiry!.id)), 'unlinked buyer can retrieve their own enquiry')

  const guestReplyText = 'Is the item still available?'
  const guestReply = await postTelegramUpdate({
    update_id: updateBase + 25,
    message: { text: '/respond ' + guestEnquiry!.id + ' ' + guestReplyText, chat: { id: secondBuyerTelegramId, type: 'private' }, from: { id: secondBuyerTelegramId } },
  })
  assertStatus(guestReply.status, 200, 'unlinked guest buyer enquiry reply')
  assert.ok(telegramRequests.some((item) => item.method === 'sendMessage' && item.body.chat_id === merchantTelegramId && String(item.body.text).includes(guestReplyText)), 'unlinked buyer reply is relayed to the selected seller')

  const selfEnquiry = await requestJson('/api/telegram/contact-token', {
    method: 'POST',
    body: JSON.stringify({ listingId: merchantListing.id }),
  }, merchant.token)
  assertStatus(selfEnquiry.status, 409, 'merchant cannot enquire with own listing')

  await db.appSetting.update({
    where: { key: merchantSettingKey },
    data: { value: JSON.stringify({ enabled: false, activatedAt: new Date().toISOString(), chatId: merchantTelegramId }) },
  })
  const optedOut = await requestJson('/api/telegram/contact-token', {
    method: 'POST',
    body: JSON.stringify({ listingId: merchantListing.id }),
  })
  assertStatus(optedOut.status, 409, 'seller opt-out blocks new Telegram enquiries')
  const existingThreadReply = await postTelegramUpdate({
    update_id: updateBase + 21,
    message: { text: '/respond ' + enquiry.id + ' I have one more question about the same item.', chat: { id: buyerTelegramId, type: 'private' }, from: { id: buyerTelegramId } },
  })
  assertStatus(existingThreadReply.status, 200, 'buyer can continue an existing Telegram thread after new-enquiry opt-out')
  assert.ok(telegramRequests.some((item) => item.method === 'sendMessage' && item.body.chat_id === merchantTelegramId && String(item.body.text).includes('one more question about the same item')), 'existing conversation replies still reach the seller after opt-out')
  const existingWebReply = await requestJson('/api/enquiries/' + encodeURIComponent(enquiry.id) + '/messages', {
    method: 'POST', body: JSON.stringify({ message: 'Existing enquiry web reply after opt-out.' }),
  }, shopper.token)
  assertStatus(existingWebReply.status, 201, 'shopper web reply remains available after new-enquiry opt-out')
  assert.ok(telegramRequests.some((item) => item.method === 'sendMessage' && item.body.chat_id === merchantTelegramId && String(item.body.text).includes('web reply after opt-out')), 'web inbox can still deliver an existing conversation after opt-out')

  // Re-linking the same Mudaala account from a different Telegram identity
  // revokes the previous identity, and /unlink revokes the active identity.
  const replacementTelegramId = merchantTelegramId + 10
  const replacementMappingKey = 'telegram:user:' + createHash('sha256').update(String(replacementTelegramId)).digest('hex')
  const replacementChatKey = 'telegram:chat:' + createHash('sha256').update(String(replacementTelegramId)).digest('hex')
  const merchantAccountKey = 'telegram:account:' + merchant.id
  settingKeys.push(replacementMappingKey, replacementChatKey, merchantAccountKey)
  const replacementCodeResponse = await requestJson('/api/telegram/link-code', { method: 'POST', body: '{}' }, merchant.token)
  assertStatus(replacementCodeResponse.status, 201, 'replacement merchant Telegram link code')
  const replacementCode = String(replacementCodeResponse.body.code)
  const replacementCodeKey = 'telegram:link-code:' + createHash('sha256').update(replacementCode).digest('hex')
  settingKeys.push(replacementCodeKey)
  const replacementLinked = await postTelegramUpdate({
    update_id: updateBase + 80,
    message: { text: '/link ' + replacementCode, chat: { id: replacementTelegramId, type: 'private' }, from: { id: replacementTelegramId } },
  })
  assertStatus(replacementLinked.status, 200, 'replacement Telegram identity linking')
  assert.equal(await db.appSetting.findUnique({ where: { key: merchantMappingKey } }), null, 'previous Telegram identity mapping is revoked on relink')
  const replacementMapping = await db.appSetting.findUnique({ where: { key: replacementMappingKey } })
  assert.equal((JSON.parse(replacementMapping!.value) as { userId: string }).userId, merchant.id, 'replacement Telegram identity maps to the merchant')
  assert.equal((await db.appSetting.findUnique({ where: { key: merchantAccountKey } }))?.value, replacementMappingKey, 'reverse account mapping points only to the active Telegram identity')
  assert.equal(await db.appSetting.findUnique({ where: { key: merchantChatKey } }), null, 'relink removes the revoked identity chat route')
  const revokedIdentityCommand = await postTelegramUpdate({
    update_id: updateBase + 81,
    message: { text: '/enquiries', chat: { id: merchantTelegramId, type: 'private' }, from: { id: merchantTelegramId } },
  })
  assertStatus(revokedIdentityCommand.status, 200, 'revoked Telegram identity command is handled safely')
  const revokedIdentityResponse = telegramRequests.filter((item) => item.method === 'sendMessage' && item.body.chat_id === merchantTelegramId).at(-1)
  assert.ok(revokedIdentityResponse && !String(revokedIdentityResponse.body.text).includes(enquiry.id), 'revoked Telegram identity cannot access merchant enquiries')

  const replacementStarted = await postTelegramUpdate({
    update_id: updateBase + 83,
    message: { text: '/start', chat: { id: replacementTelegramId, type: 'private' }, from: { id: replacementTelegramId } },
  })
  assertStatus(replacementStarted.status, 200, 'replacement Telegram identity start')
  assert.ok(await db.appSetting.findUnique({ where: { key: replacementChatKey } }), 'replacement identity chat route remains active after /start')
  const unlinked = await postTelegramUpdate({
    update_id: updateBase + 84,
    message: { text: '/unlink', chat: { id: replacementTelegramId, type: 'private' }, from: { id: replacementTelegramId } },
  })
  assertStatus(unlinked.status, 200, 'Telegram /unlink command')
  assert.equal(await db.appSetting.findUnique({ where: { key: replacementMappingKey } }), null, 'unlink removes the active Telegram identity mapping')
  assert.equal(await db.appSetting.findUnique({ where: { key: merchantAccountKey } }), null, 'unlink removes the reverse account mapping')
  assert.equal(await db.appSetting.findUnique({ where: { key: replacementChatKey } }), null, 'unlink removes the active Telegram chat route')
  const disconnectedMerchantSettings = await db.appSetting.findUnique({ where: { key: merchantSettingKey } })
  const disconnectedSettings = JSON.parse(disconnectedMerchantSettings!.value) as { enabled: boolean; chatId: number | null; activatedAt: string | null }
  assert.equal(disconnectedSettings.enabled, false, 'unlink disables merchant Telegram enquiries')
  assert.equal(disconnectedSettings.chatId, null, 'unlink clears merchant Telegram chat destination')
  assert.equal(disconnectedSettings.activatedAt, null, 'unlink clears merchant Telegram activation')

  // Account shortlist operations are isolated and bounded at the database
  // transaction boundary, not only by the browser's local counter.
  const savedListings = await Promise.all(
    Array.from({ length: 40 }, (_, index) => createListing(merchant.id, merchant.phone, index + 1)),
  )
  await db.savedProduct.createMany({
    data: savedListings.map((listing) => ({ userId: shopper.id, listingId: listing.id })),
  })
  const extraListing = await createListing(merchant.id, merchant.phone, 99)

  const full = await requestJson('/api/saved-products', {
    method: 'POST',
    body: JSON.stringify({ listingId: extraListing.id }),
  }, shopper.token)
  assertStatus(full.status, 409, '41st saved product is rejected')

  const duplicateAtLimit = await requestJson('/api/saved-products', {
    method: 'POST',
    body: JSON.stringify({ listingId: savedListings[0]!.id }),
  }, shopper.token)
  assertStatus(duplicateAtLimit.status, 201, 're-saving an existing item at the cap is idempotent')

  const shopperList = await requestJson('/api/saved-products', {}, shopper.token)
  assertStatus(shopperList.status, 200, 'shopper shortlist')
  assert.equal(shopperList.body.products.length, 40, 'shopper sees exactly their 40 saved products')

  const strangerList = await requestJson('/api/saved-products', {}, stranger.token)
  assertStatus(strangerList.status, 200, 'stranger shortlist')
  assert.equal(strangerList.body.products.length, 0, 'another account cannot see saved products')

  const strangerDelete = await requestJson('/api/saved-products', {
    method: 'DELETE',
    body: JSON.stringify({ listingId: savedListings[0]!.id }),
  }, stranger.token)
  assertStatus(strangerDelete.status, 200, 'stranger delete remains non-disclosing')
  const stillSaved = await db.savedProduct.findUnique({
    where: { userId_listingId: { userId: shopper.id, listingId: savedListings[0]!.id } },
  })
  assert.ok(stillSaved, 'stranger cannot remove another account saved product')

  const remove = await requestJson('/api/saved-products', {
    method: 'DELETE',
    body: JSON.stringify({ listingId: savedListings[0]!.id }),
  }, shopper.token)
  assertStatus(remove.status, 200, 'shopper removes own saved product')
  const afterRemove = await requestJson('/api/saved-products', {}, shopper.token)
  assert.equal(afterRemove.body.products.length, 39, 'shortlist count updates after removal')

  console.log('Telegram commerce tests passed: account-bound contact, one-to-one Telegram linking, identity revocation, /unlink, seller opt-in, enquiry privacy and shortlist cap.')
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    if (telegramMock) await new Promise<void>((resolve) => telegramMock!.close(() => resolve()))
    if (settingKeys.length) await db.appSetting.deleteMany({ where: { key: { in: settingKeys } } }).catch(() => undefined)
    if (sessionIds.length) await db.session.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => undefined)
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined)
    await db.$disconnect()
  })
