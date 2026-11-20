import { MerchantAnalyticsSnapshot, type MerchantAnalyticsSnapshot as MCI27Snapshot } from '../../../intelligence/contracts/modules/mci27'

export interface MCI27DailySource {
  day: string
  views: number
  contactTaps: number
  shareClicks: number
}

export interface MCI27ListingSource {
  id: string
  categoryId: string
  status: 'ACTIVE' | 'FULFILLED' | 'EXPIRED' | 'ARCHIVED' | 'HIDDEN'
  daysLive: number
  views: number
  contactTaps: number
  shareClicks: number
}

export interface MCI27SnapshotSource {
  /** Internal owner id. It is pseudonymised before leaving the commerce plane. */
  ownerId: string
  /** Dedicated gateway secret, used as an HMAC key; never returned in the payload. */
  pseudonymKey: string
  days: 7 | 30 | 90
  from: string
  totals: { views: number; contactTaps: number; shareClicks: number }
  daily: MCI27DailySource[]
  listings: MCI27ListingSource[]
  previousPeriodTotals?: { views: number; contactTaps: number; shareClicks: number } | null
}

/** Stable, keyed pseudonym: raw Mudaala user ids never cross the intelligence boundary. */
export async function pseudonymizeMerchantRef(ownerId: string, keyMaterial: string): Promise<string> {
  if (!ownerId || !keyMaterial) throw new Error('merchant pseudonym inputs are required')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keyMaterial),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`mci27:${ownerId}`))
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `merchant-${hex.slice(0, 32)}`
}

/** Build and validate the exact contract sent to MCI-27. No sales data is accepted. */
export async function buildMCI27Snapshot(source: MCI27SnapshotSource): Promise<MCI27Snapshot> {
  const merchantRef = await pseudonymizeMerchantRef(source.ownerId, source.pseudonymKey)
  return MerchantAnalyticsSnapshot.parse({
    merchant_ref: merchantRef,
    period: { days: source.days, from: source.from },
    shop_totals: {
      views: source.totals.views,
      contact_taps: source.totals.contactTaps,
      share_clicks: source.totals.shareClicks,
    },
    shop_daily: source.daily.map((point) => ({
      day: point.day,
      views: point.views,
      contact_taps: point.contactTaps,
      share_clicks: point.shareClicks,
    })),
    listings: source.listings.map((listing) => ({
      listing_id: listing.id,
      category_id: listing.categoryId,
      status: listing.status,
      days_live: Math.max(0, Math.min(3650, Math.trunc(listing.daysLive))),
      views: listing.views,
      contact_taps: listing.contactTaps,
      share_clicks: listing.shareClicks,
    })),
    previous_period_totals: source.previousPeriodTotals
      ? {
          views: source.previousPeriodTotals.views,
          contact_taps: source.previousPeriodTotals.contactTaps,
          share_clicks: source.previousPeriodTotals.shareClicks,
        }
      : null,
  })
}
