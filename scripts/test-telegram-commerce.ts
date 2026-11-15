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
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const BASE = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
const userIds: string[] = []
const sessionIds: string[] = []
const settingKeys: string[] = []
const listingIds: string[] = []

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

async function run() {
  const merchant = await createUser('merchant')
  const shopper = await createUser('shopper')
  const stranger = await createUser('stranger')
  const merchantListing = await createListing(merchant.id, merchant.phone, 0)

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

  // A signed-in shopper is attached to the token, allowing the confirmed
  // Telegram enquiry to appear in that shopper's private Mudaala inbox.
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

  const selfEnquiry = await requestJson('/api/telegram/contact-token', {
    method: 'POST',
    body: JSON.stringify({ listingId: merchantListing.id }),
  }, merchant.token)
  assertStatus(selfEnquiry.status, 409, 'merchant cannot enquire with own listing')

  await db.appSetting.update({
    where: { key: merchantSettingKey },
    data: { value: JSON.stringify({ enabled: false, activatedAt: new Date().toISOString(), chatId: 712345678 }) },
  })
  const optedOut = await requestJson('/api/telegram/contact-token', {
    method: 'POST',
    body: JSON.stringify({ listingId: merchantListing.id }),
  })
  assertStatus(optedOut.status, 409, 'seller opt-out blocks new Telegram enquiries')

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

  console.log('Telegram commerce tests passed: guest and account contact capabilities, seller opt-in, self-enquiry guard, shortlist privacy and atomic 40-item cap.')
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    if (settingKeys.length) await db.appSetting.deleteMany({ where: { key: { in: settingKeys } } }).catch(() => undefined)
    if (sessionIds.length) await db.session.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => undefined)
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined)
    await db.$disconnect()
  })
