import { describe, expect, it } from 'bun:test'
import { isPubliclyListable } from './products'
import { SlugTakenError, type OwnedListingRow, type PublicShowroomData, type ShowroomPatch, type ShowroomRepo, type ShowroomRow } from './repo'
import { createShowroom, deleteShowroom, getPublicShowroom, ShowroomError, updateShowroom } from './service'

const NOW = new Date('2026-11-17T09:00:00Z')
const future = new Date('2026-12-30T00:00:00Z')

function listing(id: string, userId: string, over: Partial<OwnedListingRow> = {}): OwnedListingRow {
  return { id, userId, type: 'OFFER', status: 'ACTIVE', isSeed: false, expiresAt: future, ...over }
}

/** In-memory ShowroomRepo with the same semantics the Prisma repo promises. */
function memoryRepo(listings: OwnedListingRow[]) {
  const rows: Array<ShowroomRow & { isActive: boolean }> = []
  let seq = 0
  const repo: ShowroomRepo = {
    async findListingsOwnedBy(userId, ids) { return listings.filter((l) => l.userId === userId && ids.includes(l.id)) },
    async countShowrooms(userId) { return rows.filter((r) => r.userId === userId).length },
    async create(d) {
      if (rows.some((r) => r.slug === d.slug)) throw new SlugTakenError()
      seq += 1
      const row = { id: `sh${seq}`, collectionId: `col${seq}`, userId: d.userId, slug: d.slug, title: d.title, introduction: d.introduction, introSource: d.introSource, purpose: d.purpose, styleKey: d.styleKey, highlights: d.highlights, status: 'DRAFT' as const, publishedAt: null, createdAt: NOW, updatedAt: NOW, listingIds: d.listingIds, isActive: false }
      rows.push(row)
      return row
    },
    async findOwned(id, userId) { return rows.find((r) => r.id === id && r.userId === userId) ?? null },
    async listOwned(userId) { return rows.filter((r) => r.userId === userId) },
    async update(id, userId, patch: ShowroomPatch) {
      const row = rows.find((r) => r.id === id && r.userId === userId)
      if (!row) return null
      const { isActive, ...rest } = patch
      Object.assign(row, rest)
      if (isActive !== undefined) row.isActive = isActive
      return row
    },
    async deleteOwned(id, userId) {
      const i = rows.findIndex((r) => r.id === id && r.userId === userId)
      if (i < 0) return false
      rows.splice(i, 1)
      return true
    },
    async findPublishedBySlug(slug, now): Promise<PublicShowroomData | null> {
      const row = rows.find((r) => r.slug === slug && r.status === 'PUBLISHED' && r.isActive)
      if (!row) return null
      const visible = row.listingIds.filter((id) => { const l = listings.find((x) => x.id === id); return l && isPubliclyListable(l, row.userId, now) })
      return {
        showroom: row,
        shop: { id: row.userId, name: 'Shop', area: null, county: null, shopCode: 'MD-1', photoUrl: null, category: null },
        listings: visible.map((id) => ({ id, title: id, description: 'd', category: 'other', price: 1000, currency: 'UGX', photos: ['/uploads/a.jpg'], publishedAt: NOW })),
      }
    },
  }
  return { repo, rows }
}

const A = 'merchant-a'
const B = 'merchant-b'
const stock = () => [listing('a1', A), listing('a2', A), listing('a3', A, { status: 'EXPIRED' }), listing('a-req', A, { type: 'REQUEST' }), listing('a-seed', A, { isSeed: true }), listing('b1', B)]

describe('createShowroom', () => {
  it('creates a DRAFT that references existing listings by id only', async () => {
    const { repo } = memoryRepo(stock())
    const row = await createShowroom(repo, A, { title: 'Summer fashion', listingIds: ['a1', 'a2'], highlights: ['a2'] })
    expect(row.status).toBe('DRAFT')
    expect(row.slug).toBe('summer-fashion')
    expect(row.listingIds).toEqual(['a1', 'a2'])
    expect(row.highlights).toEqual(['a2'])
    expect(row.userId).toBe(A)
  })
  it('refuses another merchant\'s product with the same error as a missing one (no existence leak)', async () => {
    const { repo } = memoryRepo(stock())
    const other = await createShowroom(repo, A, { title: 'x y z', listingIds: ['b1'] }).catch((e) => e)
    const missing = await createShowroom(repo, A, { title: 'x y z', listingIds: ['nope'] }).catch((e) => e)
    expect(other).toBeInstanceOf(ShowroomError)
    expect(other.status).toBe(400)
    expect(other.message).toBe(missing.message)
  })
  it('refuses wanted-ads and seed fixtures', async () => {
    const { repo } = memoryRepo(stock())
    expect((await createShowroom(repo, A, { title: 'abc', listingIds: ['a-req'] }).catch((e) => e)).status).toBe(400)
    expect((await createShowroom(repo, A, { title: 'abc', listingIds: ['a-seed'] }).catch((e) => e)).status).toBe(400)
  })
  it('requires highlights to be inside the showroom', async () => {
    const { repo } = memoryRepo(stock())
    expect((await createShowroom(repo, A, { title: 'abc', listingIds: ['a1'], highlights: ['a2'] }).catch((e) => e)).status).toBe(400)
  })
  it('applies the marketplace content policy to title and introduction', async () => {
    const { repo } = memoryRepo(stock())
    expect((await createShowroom(repo, A, { title: 'Replica watches', listingIds: ['a1'] }).catch((e) => e)).status).toBe(400)
    expect((await createShowroom(repo, A, { title: 'Watches', introduction: 'Fake designer bags', listingIds: ['a1'] }).catch((e) => e)).status).toBe(400)
  })
  it('resolves slug collisions deterministically, across merchants', async () => {
    const { repo } = memoryRepo(stock())
    const first = await createShowroom(repo, A, { title: 'Summer fashion', listingIds: ['a1'] })
    const second = await createShowroom(repo, B, { title: 'Summer fashion', listingIds: ['b1'] })
    const third = await createShowroom(repo, A, { title: 'Summer fashion', listingIds: ['a2'] })
    expect([first.slug, second.slug, third.slug]).toEqual(['summer-fashion', 'summer-fashion-2', 'summer-fashion-3'])
  })
  it('enforces the per-shop showroom cap', async () => {
    const { repo } = memoryRepo(stock())
    for (let i = 0; i < 30; i++) await createShowroom(repo, A, { title: `Showroom number ${i}`, listingIds: ['a1'] })
    expect((await createShowroom(repo, A, { title: 'One too many', listingIds: ['a1'] }).catch((e) => e)).status).toBe(409)
  })
  it('stores blank introductions as null and records the introduction source', async () => {
    const { repo } = memoryRepo(stock())
    const row = await createShowroom(repo, A, { title: 'Some title', introduction: '   ', introSource: 'SUGGESTED', listingIds: ['a1'] })
    expect(row.introduction).toBeNull()
    expect(row.introSource).toBe('SUGGESTED')
  })
})

describe('authorization: merchants cannot touch each other\'s showrooms', () => {
  it('another merchant gets 404 on update (indistinguishable from not found)', async () => {
    const { repo } = memoryRepo(stock())
    const mine = await createShowroom(repo, A, { title: 'Mine', listingIds: ['a1'] })
    const err = await updateShowroom(repo, B, mine.id, { title: 'Hijacked' }, NOW).catch((e) => e)
    expect(err).toBeInstanceOf(ShowroomError)
    expect(err.status).toBe(404)
    expect((await repo.findOwned(mine.id, A))!.title).toBe('Mine')
  })
  it('another merchant cannot publish, unpublish or delete it', async () => {
    const { repo } = memoryRepo(stock())
    const mine = await createShowroom(repo, A, { title: 'Mine', listingIds: ['a1'] })
    expect((await updateShowroom(repo, B, mine.id, { status: 'PUBLISHED' }, NOW).catch((e) => e)).status).toBe(404)
    expect((await deleteShowroom(repo, B, mine.id).catch((e) => e)).status).toBe(404)
    expect(await repo.findOwned(mine.id, A)).not.toBeNull()
  })
  it('the owner cannot attach another merchant\'s products on update', async () => {
    const { repo } = memoryRepo(stock())
    const mine = await createShowroom(repo, A, { title: 'Mine', listingIds: ['a1'] })
    expect((await updateShowroom(repo, A, mine.id, { listingIds: ['a1', 'b1'] }, NOW).catch((e) => e)).status).toBe(400)
    expect((await repo.findOwned(mine.id, A))!.listingIds).toEqual(['a1'])
  })
})

describe('publishing', () => {
  it('publishes: sets status, publishedAt, and activates the collection', async () => {
    const { repo, rows } = memoryRepo(stock())
    const mine = await createShowroom(repo, A, { title: 'Mine', listingIds: ['a1'] })
    expect(rows[0].isActive).toBe(false) // a draft never leaks as a public collection
    const published = await updateShowroom(repo, A, mine.id, { status: 'PUBLISHED' }, NOW)
    expect(published.status).toBe('PUBLISHED')
    expect(published.publishedAt).toEqual(NOW)
    expect(rows[0].isActive).toBe(true)
  })
  it('refuses to publish when no product would be visible to customers', async () => {
    const { repo } = memoryRepo([listing('x1', A, { status: 'EXPIRED' }), listing('x2', A, { expiresAt: new Date('2026-01-01') })])
    const mine = await createShowroom(repo, A, { title: 'Mine', listingIds: ['x1', 'x2'] })
    const err = await updateShowroom(repo, A, mine.id, { status: 'PUBLISHED' }, NOW).catch((e) => e)
    expect(err.status).toBe(409)
  })
  it('unpublish hides it again and keeps the original publish date', async () => {
    const { repo, rows } = memoryRepo(stock())
    const mine = await createShowroom(repo, A, { title: 'Mine', listingIds: ['a1'] })
    await updateShowroom(repo, A, mine.id, { status: 'PUBLISHED' }, NOW)
    const later = new Date('2026-11-20T00:00:00Z')
    await updateShowroom(repo, A, mine.id, { status: 'DRAFT' }, later)
    expect(rows[0].isActive).toBe(false)
    await updateShowroom(repo, A, mine.id, { status: 'PUBLISHED' }, later)
    expect(rows[0].publishedAt).toEqual(NOW)
  })
  it('the slug (the shareable URL) never changes when the title does', async () => {
    const { repo } = memoryRepo(stock())
    const mine = await createShowroom(repo, A, { title: 'Summer fashion', listingIds: ['a1'] })
    const renamed = await updateShowroom(repo, A, mine.id, { title: 'Winter fashion' }, NOW)
    expect(renamed.slug).toBe('summer-fashion')
    expect(renamed.title).toBe('Winter fashion')
  })
})

describe('public access (no login)', () => {
  it('a published showroom is readable by slug; products are mapped from listings', async () => {
    const { repo } = memoryRepo(stock())
    const mine = await createShowroom(repo, A, { title: 'Summer fashion', listingIds: ['a1', 'a2'] })
    await updateShowroom(repo, A, mine.id, { status: 'PUBLISHED' }, NOW)
    const pub = await getPublicShowroom(repo, 'summer-fashion', NOW)
    expect(pub).not.toBeNull()
    expect(pub!.products.map((p) => p.id)).toEqual(['a1', 'a2'])
    expect(pub!.shop.shopCode).toBe('MD-1')
  })
  it('drafts, unpublished and unknown slugs are not public', async () => {
    const { repo } = memoryRepo(stock())
    const mine = await createShowroom(repo, A, { title: 'Summer fashion', listingIds: ['a1'] })
    expect(await getPublicShowroom(repo, 'summer-fashion', NOW)).toBeNull()
    await updateShowroom(repo, A, mine.id, { status: 'PUBLISHED' }, NOW)
    await updateShowroom(repo, A, mine.id, { status: 'DRAFT' }, NOW)
    expect(await getPublicShowroom(repo, 'summer-fashion', NOW)).toBeNull()
    expect(await getPublicShowroom(repo, 'no-such-showroom', NOW)).toBeNull()
  })
  it('rejects malformed slugs without touching the database', async () => {
    let touched = false
    const repo = { findPublishedBySlug: async () => { touched = true; return null } } as unknown as ShowroomRepo
    for (const bad of ['', 'UPPER', 'a b', '../etc', 'x'.repeat(81), '-lead', 'trail-', 'dou--ble']) expect(await getPublicShowroom(repo, bad, NOW)).toBeNull()
    expect(touched).toBe(false)
  })
  it('hides products that expired after publishing', async () => {
    const data = stock()
    const { repo } = memoryRepo(data)
    const mine = await createShowroom(repo, A, { title: 'Summer fashion', listingIds: ['a1', 'a2'] })
    await updateShowroom(repo, A, mine.id, { status: 'PUBLISHED' }, NOW)
    data[0].expiresAt = new Date('2026-11-01T00:00:00Z')
    expect((await getPublicShowroom(repo, 'summer-fashion', NOW))!.products.map((p) => p.id)).toEqual(['a2'])
  })
  it('exposes no contact data on the public model', async () => {
    const { repo } = memoryRepo(stock())
    const mine = await createShowroom(repo, A, { title: 'Summer fashion', listingIds: ['a1'] })
    await updateShowroom(repo, A, mine.id, { status: 'PUBLISHED' }, NOW)
    const json = JSON.stringify(await getPublicShowroom(repo, 'summer-fashion', NOW))
    expect(json).not.toMatch(/phone|whatsapp|contact|passwordHash|\+256/i)
  })
})

describe('delete', () => {
  it('owner deletes; the listings they referenced are untouched', async () => {
    const data = stock()
    const { repo } = memoryRepo(data)
    const mine = await createShowroom(repo, A, { title: 'Mine', listingIds: ['a1'] })
    await deleteShowroom(repo, A, mine.id)
    expect(await repo.findOwned(mine.id, A)).toBeNull()
    expect(data.length).toBe(6)
  })
})
