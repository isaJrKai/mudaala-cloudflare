import { db } from '@/lib/db'

export type ListingEngagementEvent = 'VIEW' | 'CALL_CLICK' | 'WHATSAPP_CLICK' | 'SHARE_CLICK'

export function ugandaCalendarDay(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Kampala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: 'year' | 'month' | 'day') => parts.find((value) => value.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/**
 * Increment a daily aggregate without retaining a viewer identity, IP address,
 * phone number, or raw event stream. Click counts represent actions, not unique
 * people or completed transactions.
 */
export async function recordListingDailyEvent(input: {
  listingId: string
  ownerId: string
  listingTitle: string
  event: ListingEngagementEvent
  occurredAt?: Date
}) {
  const day = ugandaCalendarDay(input.occurredAt)
  const base = {
    listingId: input.listingId,
    ownerId: input.ownerId,
    listingTitle: input.listingTitle,
    day,
    views: input.event === 'VIEW' ? 1 : 0,
    callClicks: input.event === 'CALL_CLICK' ? 1 : 0,
    whatsappClicks: input.event === 'WHATSAPP_CLICK' ? 1 : 0,
    shareClicks: input.event === 'SHARE_CLICK' ? 1 : 0,
  }
  const update = input.event === 'VIEW'
    ? { views: { increment: 1 } }
    : input.event === 'CALL_CLICK'
      ? { callClicks: { increment: 1 } }
      : input.event === 'WHATSAPP_CLICK'
        ? { whatsappClicks: { increment: 1 } }
        : { shareClicks: { increment: 1 } }

  return db.listingDailyAnalytics.upsert({
    where: { listingId_day: { listingId: input.listingId, day } },
    create: base,
    update,
  })
}
