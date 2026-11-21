// Mudaala - NFC / QR shop tags, database side. See shop-tags.ts for the model.

import { ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { ugandaCalendarDay } from '@/lib/listing-analytics'
import { siteUrl } from '@/lib/site'
import { buildTagUrl, generateTagCode, MAX_TAGS_PER_SHOP, type OwnerTag, type OwnerTagsResponse, type TagVia } from '@/lib/shop-tags'

const DAY_MS = 24 * 60 * 60 * 1000

export async function ownerShopCode(userId: string): Promise<string> {
  const profile = await db.businessProfile.findUnique({ where: { userId }, select: { shopCode: true } })
  if (!profile?.shopCode) throw new ApiError(409, 'Open your shop first, then you can add tap-to-shop tags')
  return profile.shopCode
}

export async function listOwnerTags(userId: string): Promise<OwnerTagsResponse> {
  const shopCode = await ownerShopCode(userId)
  const tags = await db.shopTag.findMany({ where: { ownerId: userId }, orderBy: { createdAt: 'asc' } })
  const sums = tags.length
    ? await db.shopTagDailyStat.groupBy({
        by: ['tagId'],
        where: { tagId: { in: tags.map((t) => t.id) }, day: { gte: ugandaCalendarDay(new Date(Date.now() - 30 * DAY_MS)) } },
        _sum: { taps: true, qrScans: true },
      })
    : []
  const byTag = new Map(sums.map((s) => [s.tagId, s._sum]))

  const out: OwnerTag[] = tags.map((t) => ({
    id: t.id,
    label: t.label,
    status: t.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    lockedAt: t.lockedAt ? t.lockedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    taps30d: byTag.get(t.id)?.taps ?? 0,
    qrScans30d: byTag.get(t.id)?.qrScans ?? 0,
    nfcUrl: buildTagUrl(siteUrl, shopCode, t.tagCode, 'nfc'),
    qrUrl: buildTagUrl(siteUrl, shopCode, t.tagCode, 'qr'),
  }))
  return { tags: out, shopCode, max: MAX_TAGS_PER_SHOP }
}

// Creates a tag, retrying on the (astronomically unlikely) code collision.
export async function createOwnerTag(userId: string, label: string): Promise<void> {
  await ownerShopCode(userId)
  const count = await db.shopTag.count({ where: { ownerId: userId } })
  if (count >= MAX_TAGS_PER_SHOP) {
    throw new ApiError(409, `You can keep up to ${MAX_TAGS_PER_SHOP} tags. Disable one you no longer use, or rotate it to reuse the spot.`)
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db.shopTag.create({ data: { ownerId: userId, label, tagCode: generateTagCode() } })
      return
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code !== 'P2002' || attempt === 2) throw err
    }
  }
}

// Counts one tap or scan. Quietly ignores unknown/disabled codes (no oracle for
// guessing codes) and the owner's own visits. Stores counters only - no buyer data.
export async function recordTagTap(input: { tagCode: string; via: TagVia; viewerId?: string | null }): Promise<boolean> {
  const tag = await db.shopTag.findUnique({ where: { tagCode: input.tagCode }, select: { id: true, ownerId: true, status: true } })
  if (!tag || tag.status !== 'ACTIVE') return false
  if (input.viewerId && input.viewerId === tag.ownerId) return false

  const day = ugandaCalendarDay()
  const isQr = input.via === 'qr'
  await db.shopTagDailyStat.upsert({
    where: { tagId_day: { tagId: tag.id, day } },
    create: { tagId: tag.id, day, taps: isQr ? 0 : 1, qrScans: isQr ? 1 : 0 },
    update: isQr ? { qrScans: { increment: 1 } } : { taps: { increment: 1 } },
  })
  return true
}
