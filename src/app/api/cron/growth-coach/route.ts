import { createHash, timingSafeEqual } from 'node:crypto'
import { headers } from 'next/headers'
import { route, jsonError, jsonOk } from '@/lib/api'
import { db } from '@/lib/db'
import { recommendMerchantActions } from '@/lib/merchant-growth'
import { deliverPushNotification } from '@/lib/push-delivery'

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
    if (!secretMatches(hdrs.get('x-cron-secret'), configured)) return jsonError(403, 'Invalid cron secret')

    const now = new Date()
    // Re-activate due snoozed Growth Coach reminders. The quarter-hour cron
    // keeps 15-minute snoozes useful without a separate queue service.
    const dueNotifications = await db.notification.findMany({
      where: {
        category: 'GROWTH',
        snoozedUntil: { lte: now },
        archivedAt: null,
        dismissedAt: null,
        completedAt: null,
      },
      select: { id: true, userId: true, title: true, body: true, actionUrl: true, actionLabel: true, priority: true },
    })
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
    if (dueSnoozes.count > 0) {
      for (const notification of dueNotifications) {
        await deliverPushNotification(notification.userId, notification).catch((error) =>
          console.warn('[growth-coach] snooze push delivery failed', error instanceof Error ? error.message : 'unknown error'),
        )
      }
    }

    const [merchants, recentGrowth, recentGrowthCounts] = await Promise.all([
      db.user.findMany({
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
          where: { eventType: { in: ['POSTER_GENERATED', 'POSTER_SHARED', 'POSTER_SHARE_INITIATED', 'PRODUCT_PHOTO_ADDED', 'PRODUCT_PHOTOS_SHARE_INITIATED', 'SHOP_OPENED'] } },
          orderBy: { createdAt: 'desc' },
          take: 40,
          select: { eventType: true, entityId: true, createdAt: true },
        },
      },
      }),
      db.notification.findMany({
        where: { category: 'GROWTH', createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } },
        select: { userId: true, dedupeKey: true },
      }),
      db.notification.groupBy({
        by: ['userId'],
        where: { category: 'GROWTH', createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } },
        _count: { _all: true },
      }),
    ])
    const sentKeysByUser = new Map<string, Set<string>>()
    for (const item of recentGrowth) {
      if (!item.dedupeKey) continue
      const keys = sentKeysByUser.get(item.userId) ?? new Set<string>()
      keys.add(item.dedupeKey)
      sentKeysByUser.set(item.userId, keys)
    }
    const countByUser = new Map(recentGrowthCounts.map((item) => [item.userId, item._count._all]))

    let created = 0
    let skipped = 0
    for (const merchant of merchants) {
      if (!merchant.profile) continue
      const timezone = merchant.timezone || 'Africa/Kampala'
      const local = localParts(now, timezone)
      const recommendations = recommendMerchantActions({
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
        latestPhotoAddedAt: merchant.growthEvents.find((event) => event.eventType === 'PRODUCT_PHOTO_ADDED')?.createdAt ?? null,
        latestPhotoListingId: merchant.growthEvents.find((event) => event.eventType === 'PRODUCT_PHOTO_ADDED')?.entityId ?? null,
        latestPhotoListingTitle: (() => { const item = merchant.listings.find((listing) => listing.id === merchant.growthEvents.find((event) => event.eventType === 'PRODUCT_PHOTO_ADDED')?.entityId); return item && photoCount(item.photos) > 0 ? item.title : null })(),
        productPhotosShareInitiatedAt: merchant.growthEvents.find((event) => event.eventType === 'PRODUCT_PHOTOS_SHARE_INITIATED' && event.entityId === merchant.growthEvents.find((item) => item.eventType === 'PRODUCT_PHOTO_ADDED')?.entityId)?.createdAt ?? null,
      })

      const growthCount = countByUser.get(merchant.id) ?? 0
      if (growthCount >= DAILY_GROWTH_CAP) {
        skipped += 1
        continue
      }

      if (SCHEDULED_HOURS.has(local.hour) && recommendations.length > 0) {
        const sentKeys = sentKeysByUser.get(merchant.id) ?? new Set<string>()
        const next = recommendations.find((item) => !sentKeys.has(`growth:${local.day}:${item.key}`))
        if (next) {
          const dedupeKey = `growth:${local.day}:${next.key}`
          const result = await db.notification.createMany({
            data: [{
              userId: merchant.id,
              type: next.type,
              category: 'GROWTH',
              priority: next.priority,
              title: next.title,
              body: next.body,
              actionUrl: next.actionUrl,
              actionLabel: next.actionLabel,
              source: `SCHEDULED_${local.hour}:${next.reason}`,
              dedupeKey,
            }],
            skipDuplicates: true,
          })
          created += result.count
          if (result.count > 0) {
            const notification = await db.notification.findUnique({
              where: { userId_dedupeKey: { userId: merchant.id, dedupeKey } },
              select: { id: true, userId: true, title: true, body: true, actionUrl: true, actionLabel: true, priority: true },
            })
            if (notification) await deliverPushNotification(merchant.id, notification)
            sentKeys.add(dedupeKey)
            sentKeysByUser.set(merchant.id, sentKeys)
            countByUser.set(merchant.id, growthCount + 1)
          }
        }
      }

      if (local.hour === inactivityHour(merchant.id, local.day)) {
        const openedToday = merchant.growthEvents.some((event) =>
          event.eventType === 'SHOP_OPENED' && localParts(event.createdAt, timezone).day === local.day,
        )
        if (!openedToday) {
          const dedupeKey = `growth:${local.day}:inactive`
          const sentKeys = sentKeysByUser.get(merchant.id) ?? new Set<string>()
          if (!sentKeys.has(dedupeKey) && (countByUser.get(merchant.id) ?? 0) < DAILY_GROWTH_CAP) {
            const result = await db.notification.createMany({
              data: [{
                userId: merchant.id,
                type: 'GROWTH_INACTIVITY',
                category: 'GROWTH',
                priority: 'NORMAL',
                title: 'Your shop is waiting for you',
                body: recommendations[0]?.body ?? 'Take a moment to check your shop, refresh your products and share your latest photos or shop poster.',
                actionUrl: recommendations[0]?.actionUrl ?? `/#/shop/${encodeURIComponent(merchant.id)}`,
                actionLabel: recommendations[0]?.actionLabel ?? 'Open my shop',
                source: 'DAILY_INACTIVITY',
                dedupeKey,
              }],
              skipDuplicates: true,
            })
            created += result.count
            if (result.count > 0) {
              const notification = await db.notification.findUnique({
                where: { userId_dedupeKey: { userId: merchant.id, dedupeKey } },
                select: { id: true, userId: true, title: true, body: true, actionUrl: true, actionLabel: true, priority: true },
              })
              if (notification) await deliverPushNotification(merchant.id, notification)
              sentKeys.add(dedupeKey)
              sentKeysByUser.set(merchant.id, sentKeys)
              countByUser.set(merchant.id, (countByUser.get(merchant.id) ?? 0) + 1)
            }
          }
        }
      }
    }

    return jsonOk({ merchantsChecked: merchants.length, notificationsCreated: created, snoozesReactivated: dueSnoozes.count, merchantsAtDailyCap: skipped })
  })
}
