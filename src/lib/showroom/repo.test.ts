// Query-shape tests for the real Prisma repo using a recording fake client.
// They prove WHAT the repo asks the database for: owner scoping on every
// merchant operation, link-only item creation (no product data copied),
// draft-inactive collections, and the public visibility filter. They do not
// replace the Postgres-backed checks in scripts/test-showroom-db.mjs.

import { describe, expect, it } from 'bun:test'
import { prismaShowroomRepo, publicListingWhere, SlugTakenError, type ShowroomDb } from './repo'

type Call = { model: string; op: string; args: any }

function recorder(responses: Record<string, any> = {}) {
  const calls: Call[] = []
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, op: string) => async (args: any) => {
        calls.push({ model: name, op, args })
        const r = responses[`${name}.${op}`]
        return typeof r === 'function' ? r(args) : r === undefined ? null : r
      },
    })
  const db = { listing: model('listing'), productCollection: model('productCollection'), productCollectionItem: model('productCollectionItem'), showroomPresentation: model('showroomPresentation') } as unknown as ShowroomDb
  return { db, calls }
}

const row = (over: any = {}) => ({
  id: 's1', collectionId: 'c1', userId: 'u1', slug: 'x-y-z', introduction: null, introSource: 'MERCHANT', purpose: 'COLLECTION', styleKey: null,
  highlights: '[]', status: 'DRAFT', publishedAt: null, createdAt: new Date(), updatedAt: new Date(),
  collection: { title: 'T', items: [{ listingId: 'l1' }] }, ...over,
})
const NOW = new Date('2026-11-17T00:00:00Z')

describe('owner scoping', () => {
  it('findListingsOwnedBy filters by userId AND ids', async () => {
    const { db, calls } = recorder({ 'listing.findMany': [] })
    await prismaShowroomRepo(db).findListingsOwnedBy('u1', ['a', 'b'])
    expect(calls[0].args.where).toEqual({ id: { in: ['a', 'b'] }, userId: 'u1' })
  })
  it('findOwned / listOwned / count filter by userId', async () => {
    const { db, calls } = recorder({ 'showroomPresentation.findFirst': row(), 'showroomPresentation.findMany': [row()], 'showroomPresentation.count': 1 })
    const repo = prismaShowroomRepo(db)
    await repo.findOwned('s1', 'u1'); await repo.listOwned('u1'); await repo.countShowrooms('u1')
    expect(calls[0].args.where).toEqual({ id: 's1', userId: 'u1' })
    expect(calls[1].args.where).toEqual({ userId: 'u1' })
    expect(calls[2].args.where).toEqual({ userId: 'u1' })
  })
  it('update looks the showroom up by id+userId first and writes the collection with userId in its WHERE', async () => {
    const { db, calls } = recorder({ 'showroomPresentation.findFirst': row(), 'productCollection.update': {} })
    await prismaShowroomRepo(db).update('s1', 'u1', { title: 'New' })
    expect(calls[0].args.where).toEqual({ id: 's1', userId: 'u1' })
    const write = calls.find((c) => c.op === 'update')!
    expect(write.args.where).toEqual({ id: 'c1', userId: 'u1' })
  })
  it('update by a non-owner performs NO write', async () => {
    const { db, calls } = recorder({ 'showroomPresentation.findFirst': null })
    expect(await prismaShowroomRepo(db).update('s1', 'intruder', { title: 'x' })).toBeNull()
    expect(calls.some((c) => c.op === 'update' || c.op === 'deleteMany')).toBe(false)
  })
  it('deleteOwned scopes the cascade delete by userId; a non-owner deletes nothing', async () => {
    const { db, calls } = recorder({ 'showroomPresentation.findFirst': row(), 'productCollection.deleteMany': { count: 1 } })
    expect(await prismaShowroomRepo(db).deleteOwned('s1', 'u1')).toBe(true)
    expect(calls.find((c) => c.op === 'deleteMany')!.args.where).toEqual({ id: 'c1', userId: 'u1' })
    const none = recorder({ 'showroomPresentation.findFirst': null })
    expect(await prismaShowroomRepo(none.db).deleteOwned('s1', 'intruder')).toBe(false)
    expect(none.calls.some((c) => c.op === 'deleteMany')).toBe(false)
  })
})

describe('no duplicated inventory', () => {
  it('create stores only listing ids + order, in an INACTIVE collection, draft presentation', async () => {
    const { db, calls } = recorder({ 'productCollection.create': { showroom: row() } })
    await prismaShowroomRepo(db).create({ userId: 'u1', slug: 'x-y-z', title: 'T', introduction: null, introSource: 'MERCHANT', purpose: 'COLLECTION', styleKey: null, highlights: [], listingIds: ['l1', 'l2'] })
    const data = calls[0].args.data
    expect(data.isActive).toBe(false)
    expect(data.items.create).toEqual([{ listingId: 'l1', sortOrder: 0 }, { listingId: 'l2', sortOrder: 1 }])
    expect(data.showroom.create.status).toBe('DRAFT')
    expect(JSON.stringify(data)).not.toMatch(/"(price|photos?|brand|currency|compareAtPrice)"/i)
    // ShowroomPresentation has no product columns at all (see prisma/schema.prisma).
  })
  it('a slug collision surfaces as SlugTakenError', async () => {
    const { db } = recorder({ 'productCollection.create': () => { throw Object.assign(new Error('x'), { code: 'P2002', meta: { target: ['slug'] } }) } })
    await expect(prismaShowroomRepo(db).create({ userId: 'u1', slug: 'x-y-z', title: 'T', introduction: null, introSource: 'MERCHANT', purpose: 'COLLECTION', styleKey: null, highlights: [], listingIds: ['l1'] })).rejects.toBeInstanceOf(SlugTakenError)
  })
  it('replacing items rewrites links only', async () => {
    const { db, calls } = recorder({ 'showroomPresentation.findFirst': row(), 'productCollection.update': {} })
    await prismaShowroomRepo(db).update('s1', 'u1', { listingIds: ['l2', 'l3'] })
    expect(calls.find((c) => c.op === 'update')!.args.data.items).toEqual({ deleteMany: {}, create: [{ listingId: 'l2', sortOrder: 0 }, { listingId: 'l3', sortOrder: 1 }] })
  })
})

describe('public read path', () => {
  it('requires PUBLISHED + a currently-visible collection, and only shows live offers owned by the shop', async () => {
    const { db, calls } = recorder({
      'showroomPresentation.findFirst': { ...row({ status: 'PUBLISHED', publishedAt: NOW }), user: { id: 'u1', name: 'Owner', profile: { businessName: 'Shop', photoUrl: null, area: null, county: null, shopCode: 'MD-1', category: null } } },
      'productCollectionItem.findMany': [],
    })
    const res = await prismaShowroomRepo(db).findPublishedBySlug('x-y-z', NOW)
    const where = calls[0].args.where
    expect(where.slug).toBe('x-y-z')
    expect(where.status).toBe('PUBLISHED')
    expect(where.collection.is.isActive).toBe(true)
    expect(JSON.stringify(where.collection.is)).toContain('startsAt')
    expect(JSON.stringify(where.collection.is)).toContain('endsAt')
    expect(calls[1].args.where.listing.is).toEqual(publicListingWhere('u1', NOW))
    expect(publicListingWhere('u1', NOW)).toEqual({ userId: 'u1', status: 'ACTIVE', type: 'OFFER', isSeed: false, expiresAt: { gt: NOW } })
    expect(res!.shop.name).toBe('Shop')
  })
  it('never selects contact or credential columns', async () => {
    const { db, calls } = recorder({
      'showroomPresentation.findFirst': { ...row({ status: 'PUBLISHED', publishedAt: NOW }), user: { id: 'u1', name: 'Owner', profile: null } },
      'productCollectionItem.findMany': [],
    })
    await prismaShowroomRepo(db).findPublishedBySlug('x-y-z', NOW)
    const selects = JSON.stringify(calls.map((c) => c.args.select))
    expect(selects).not.toMatch(/contactPhone|contactWhatsapp|passwordHash|phone|whatsapp|email|"lat"|"lng"/)
  })
  it('returns null (404) when nothing matches', async () => {
    const { db } = recorder({ 'showroomPresentation.findFirst': null })
    expect(await prismaShowroomRepo(db).findPublishedBySlug('x-y-z', NOW)).toBeNull()
  })
})
