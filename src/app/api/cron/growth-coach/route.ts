import { createHash, timingSafeEqual } from 'node:crypto'
import { headers } from 'next/headers'
import { route, jsonError, jsonOk } from '@/lib/api'
import { db } from '@/lib/db'
import { recommendNextMerchantAction } from '@/lib/merchant-growth'

const SCHEDULED_HOURS = new Set([8, 11, 15])
const DAILY_GROWTH_CAP = 4
const INACTIVITY_HOURS = [9, 10, 12, 13, 14, 16, 17, 18]

function secretMatches(presented: string | null, configured: string | undefined): boolean {
  if (!configured || !presented) return false
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(configured).digest()
  return timingSafeEqual(a, b)
}

function localParts(date: Date, timezone: string): { day: string; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
    return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
  } catch {
    return localParts(date, 'Africa/Kampala')
  }
}

function photoCount(raw: string): number {
  try {
    const photos: unknown = JSON.parse(raw)
    return Array.isArray(photos) ? photos.filter((photo) => typeof photo === 'string' && photo.length > 0).length : 0
  } catch {
    return 0
  }
}

function inactivityHour(userId: string, day: string): number {
  // Stable per merchant and local day: retries and multiple Worker isolates
  // cannot choose a different random hour or send duplicate reminders.
  const digest = createHash('sha256').update(userId + ':' + day).digest()
  return INACTIVITY_HOURS[digest.readUInt32BE(0) % INACTIVITY_HOURS.length]
}

export async function POST() {
  return route(async () => {
    const hdrs = await headers()
    const configured = process.env.CRON_SECRET
    if (!configured) return jsonError(503, 'Growth Coach scheduler is not configured')
    if (!secretMatches(hdrs.get('x-cron-secret'), configured)) return jsonError(403, 'Invalid cron secret')

    const now = new Date()
    // Re-activate due snoozed Growth Coach reminders. The quarter-hour cron
    // keeps 15-minute snoozes useful without a separate queue service.
    const dueSnoozes = await db.notification.updateMany({
      where: {
        category: 'GROWTH',
        snoozedUntil: { lte: now },
        archivedAt: null,
        dismissedAt: null,
        completedAt: null,
      },
      data: { snoozedUntil: null, read: false },
    })
    const merchants = await db.user.findMany({
      where: { isSeed: false, profile: { isNot: null } },
      select: {
        id: true,
        timezone: true,
        profile: {
          select: {
            photoUrl: true,
            description: true,
            area: true,
            hours: true,
            whatsapp: true,
            shopCode: true,
          },
        },
        listings: {
          where: { type: 'OFFER', status: 'ACTIVE' },
          select: { id: true, title: true, photos: true },
          orderBy: { publishedAt: 'desc' },
          take: 100,
        },
        growthEvents: {
          where: { eventType: { in: ['POSTER_GENERATED', 'POSTER_SHARED', 'POSTER_SHARE_INITIATED', 'SHOP_OPENED'] } },
          orderBy: { createdAt: 'desc' },
          take: 40,
          select: { eventType: true, createdAt: true },
        },
      },
    })

    let created = 0
    let skipped = 0
    for (const merchant of merchants) {
      if (!merchant.profile) continue
      const timezone = merchant.timezone || 'Africa/Kampala'
      const local = localParts(now, timezone)
      const recommendation = recommendNextMerchantAction({
        shopExists: true,
        shopId: merchant.id,
        profile: merchant.profile,
        activeProducts: merchant.listings.map((listing) => ({
          id: listing.id,
          title: listing.title,
          photoCount: photoCount(listing.photos),
        })),
        posterGeneratedAt: merchant.growthEvents.find((event) => event.eventType === 'POSTER_GENERATED')?.createdAt ?? null,
        posterSharedAt: merchant.growthEvents.find((event) => event.eventType === 'POSTER_SHARED')?.createdAt ?? null,
        posterShareInitiatedAt: merchant.growthEvents.find((event) => event.eventType === 'POSTER_SHARE_INITIATED')?.createdAt ?? null,
      })

      const growthCount = await db.notification.count({
        where: { userId: merchant.id, category: 'GROWTH', createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } },
      })
      if (growthCount >= DAILY_GROWTH_CAP) {
        skipped += 1
        continue
      }

      if (SCHEDULED_HOURS.has(local.hour) && recommendation) {
        const dedupeKey = `growth:${local.day}:${recommendation.key}`
        const existing = await db.notification.findUnique({
          where: { userId_dedupeKey: { userId: merchant.id, dedupeKey } },
          select: { id: true },
        })
        if (!existing) {
          const result = await db.notification.createMany({
            data: [{
              userId: merchant.id,
              type: recommendation.type,
              category: 'GROWTH',
              priority: recommendation.priority,
              title: recommendation.title,
              body: recommendation.body,
              actionUrl: recommendation.actionUrl,
              actionLabel: recommendation.actionLabel,
              source: `SCHEDULED_${local.hour}:${recommendation.reason}`,
              dedupeKey,
            }],
            skipDuplicates: true,
          })
          created += result.count
        }
      }

      if (local.hour === inactivityHour(merchant.id, local.day)) {
        const openedToday = merchant.growthEvents.some((event) =>
          event.eventType === 'SHOP_OPENED' && localParts(event.createdAt, timezone).day === local.day,
        )
        if (!openedToday) {
          const dedupeKey = `growth:${local.day}:inactive`
          const existing = await db.notification.findUnique({
            where: { userId_dedupeKey: { userId: merchant.id, dedupeKey } },
            select: { id: true },
          })
          if (!existing) {
            const result = await db.notification.createMany({
              data: [{
                userId: merchant.id,
                type: 'GROWTH_INACTIVITY',
                category: 'GROWTH',
                priority: 'NORMAL',
                title: 'Your shop is waiting for you',
                body: recommendation?.body ?? 'Take a moment to check your shop, refresh your products and share your latest photos or shop poster.',
                actionUrl: recommendation?.actionUrl ?? `/#/shop/${encodeURIComponent(merchant.id)}`,
                actionLabel: recommendation?.actionLabel ?? 'Open my shop',
                source: 'DAILY_INACTIVITY',
                dedupeKey,
              }],
              skipDuplicates: true,
            })
            created += result.count
          }
        }
      }
    }

    return jsonOk({ merchantsChecked: merchants.length, notificationsCreated: created, snoozesReactivated: dueSnoozes.count, merchantsAtDailyCap: skipped })
  })
}
