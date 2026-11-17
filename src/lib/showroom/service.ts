// Showroom business rules. Framework-free (no Next, no Prisma imports) so it is
// unit-testable with an in-memory repo. Routes translate ShowroomError -> ApiError.

import { findProhibitedItem } from '@/lib/constants'
import { MAX_SHOWROOMS_PER_SHOP } from './constants'
import { isPubliclyListable, toShowroomProduct } from './products'
import { MAX_SLUG_ATTEMPTS, slugCandidate, slugify } from './slug'
import { SlugTakenError, type PublicShowroomData, type ShowroomPatch, type ShowroomRepo, type ShowroomRow } from './repo'
import type { ShowroomCreateInput, ShowroomUpdateInput } from './schemas'
import type { ShowroomProduct } from './types'

export class ShowroomError extends Error {
  status: number
  fields?: Record<string, string>
  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message)
    this.status = status
    this.fields = fields
  }
}

function assertContentAllowed(title: string | undefined, introduction: string | null | undefined) {
  const banned = findProhibitedItem(title ?? '', introduction ?? '')
  if (banned) {
    throw new ShowroomError(400, banned.message, {
      title: `This showroom cannot be published - ${banned.label.toLowerCase()}`,
    })
  }
}

/** Every id must be one of THIS merchant's own, non-seed OFFER listings. Same error for "missing" and "someone else's". */
async function assertOwnedOffers(repo: ShowroomRepo, userId: string, ids: string[]) {
  const owned = await repo.findListingsOwnedBy(userId, ids)
  const byId = new Map(owned.map((l) => [l.id, l]))
  const ok = ids.every((id) => {
    const l = byId.get(id)
    return l !== undefined && l.userId === userId && l.type === 'OFFER' && !l.isSeed
  })
  if (!ok) throw new ShowroomError(400, 'Choose products from your own shop. One or more selected products are not available.', { listingIds: 'Only your own products can be added' })
  return owned
}

function assertHighlightsInSet(highlights: string[], ids: string[]) {
  if (!highlights.every((h) => ids.includes(h))) {
    throw new ShowroomError(400, 'Highlighted products must be part of the showroom', { highlights: 'Highlight only products you have added' })
  }
}

export async function createShowroom(repo: ShowroomRepo, userId: string, input: ShowroomCreateInput): Promise<ShowroomRow> {
  assertContentAllowed(input.title, input.introduction)
  await assertOwnedOffers(repo, userId, input.listingIds)
  const highlights = input.highlights ?? []
  assertHighlightsInSet(highlights, input.listingIds)
  if ((await repo.countShowrooms(userId)) >= MAX_SHOWROOMS_PER_SHOP) {
    throw new ShowroomError(409, `You have reached the limit of ${MAX_SHOWROOMS_PER_SHOP} showrooms`)
  }

  const base = slugify(input.title)
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    try {
      return await repo.create({
        userId,
        slug: slugCandidate(base, attempt),
        title: input.title,
        introduction: input.introduction?.trim() ? input.introduction.trim() : null,
        introSource: input.introSource ?? 'MERCHANT',
        purpose: input.purpose ?? 'COLLECTION',
        styleKey: input.styleKey ?? null,
        highlights,
        listingIds: input.listingIds,
      })
    } catch (err) {
      if (err instanceof SlugTakenError) continue
      throw err
    }
  }
  throw new ShowroomError(409, 'Could not find a free web address for this title. Try a slightly different title.')
}

export async function updateShowroom(
  repo: ShowroomRepo,
  userId: string,
  id: string,
  input: ShowroomUpdateInput,
  now: Date = new Date(),
): Promise<ShowroomRow> {
  // Ownership first. A showroom that is not yours is indistinguishable from one that does not exist.
  const current = await repo.findOwned(id, userId)
  if (!current) throw new ShowroomError(404, 'Showroom not found')

  if (input.title !== undefined || input.introduction !== undefined) {
    assertContentAllowed(input.title ?? current.title, input.introduction === undefined ? current.introduction : input.introduction)
  }
  const finalIds = input.listingIds ?? current.listingIds
  const owned = await assertOwnedOffers(repo, userId, finalIds)
  assertHighlightsInSet(input.highlights ?? current.highlights, finalIds)

  const patch: ShowroomPatch = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.introduction !== undefined) patch.introduction = input.introduction?.trim() ? input.introduction.trim() : null
  if (input.introSource !== undefined) patch.introSource = input.introSource
  if (input.purpose !== undefined) patch.purpose = input.purpose
  if (input.styleKey !== undefined) patch.styleKey = input.styleKey
  if (input.highlights !== undefined) patch.highlights = input.highlights
  if (input.listingIds !== undefined) patch.listingIds = input.listingIds

  if (input.status === 'PUBLISHED' || (current.status === 'PUBLISHED' && input.listingIds !== undefined)) {
    const visible = owned.filter((l) => isPubliclyListable(l, userId, now)).length
    if (visible === 0) {
      throw new ShowroomError(409, 'Add at least one active product before publishing. Expired or hidden products are not shown to customers.')
    }
  }
  if (input.status !== undefined) {
    patch.status = input.status
    patch.isActive = input.status === 'PUBLISHED'
    if (input.status === 'PUBLISHED' && !current.publishedAt) patch.publishedAt = now
  }

  const updated = await repo.update(id, userId, patch)
  if (!updated) throw new ShowroomError(404, 'Showroom not found')
  return updated
}

export async function deleteShowroom(repo: ShowroomRepo, userId: string, id: string): Promise<void> {
  const ok = await repo.deleteOwned(id, userId)
  if (!ok) throw new ShowroomError(404, 'Showroom not found')
}

export async function listShowrooms(repo: ShowroomRepo, userId: string): Promise<ShowroomRow[]> {
  return repo.listOwned(userId)
}

export interface PublicShowroom {
  id: string
  slug: string
  title: string
  introduction: string | null
  purpose: ShowroomRow['purpose']
  styleKey: string | null
  highlights: string[]
  publishedAt: Date | null
  shop: PublicShowroomData['shop']
  products: ShowroomProduct[]
}

/** Public read. Null when unpublished, scheduled out, deactivated or unknown. Never exposes contact data. */
export async function getPublicShowroom(repo: ShowroomRepo, slug: string, now: Date = new Date()): Promise<PublicShowroom | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return null
  const data = await repo.findPublishedBySlug(slug, now)
  if (!data) return null
  const { showroom, shop, listings } = data
  return {
    id: showroom.id,
    slug: showroom.slug,
    title: showroom.title,
    introduction: showroom.introduction,
    purpose: showroom.purpose,
    styleKey: showroom.styleKey,
    highlights: showroom.highlights,
    publishedAt: showroom.publishedAt,
    shop,
    products: listings.map(toShowroomProduct),
  }
}
