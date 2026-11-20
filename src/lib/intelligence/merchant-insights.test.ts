import { describe, expect, test } from 'bun:test'
import { buildMCI27Snapshot, pseudonymizeMerchantRef } from './merchant-insights'

const base = {
  ownerId: 'internal-user-id-123',
  pseudonymKey: 'test-only-secret',
  days: 30 as const,
  from: '2026-10-21',
  totals: { views: 42, contactTaps: 7, shareClicks: 3 },
  daily: [{ day: '2026-11-19', views: 42, contactTaps: 7, shareClicks: 3 }],
  listings: [{ id: 'listing-1', categoryId: 'food-staples', status: 'ACTIVE' as const, daysLive: 12, views: 42, contactTaps: 7, shareClicks: 3 }],
  previousPeriodTotals: { views: 30, contactTaps: 4, shareClicks: 1 },
}

describe('MCI-27 commerce snapshot adapter', () => {
  test('maps real merchant aggregates into the 30-day MCI-27 contract', async () => {
    const snapshot = await buildMCI27Snapshot(base)
    expect(snapshot.period.days).toBe(30)
    expect(snapshot.shop_totals).toEqual({ views: 42, contact_taps: 7, share_clicks: 3 })
    expect(snapshot.listings[0].contact_taps).toBe(7)
    expect(snapshot.previous_period_totals?.views).toBe(30)
    expect(snapshot.merchant_ref).not.toContain(base.ownerId)
  })

  test('merchant pseudonym is stable for the same key and owner, and changes with the key', async () => {
    const first = await pseudonymizeMerchantRef(base.ownerId, base.pseudonymKey)
    expect(await pseudonymizeMerchantRef(base.ownerId, base.pseudonymKey)).toBe(first)
    expect(await pseudonymizeMerchantRef(base.ownerId, 'rotated-secret')).not.toBe(first)
  })

  test('rejects unsupported reporting windows and malformed analytics', async () => {
    await expect(buildMCI27Snapshot({ ...base, days: 28 as 30 })).rejects.toThrow()
    await expect(buildMCI27Snapshot({ ...base, totals: { views: -1, contactTaps: 0, shareClicks: 0 } })).rejects.toThrow()
  })
})
