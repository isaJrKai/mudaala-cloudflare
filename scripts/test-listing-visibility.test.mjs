import { describe, expect, test } from 'bun:test'
import { activeListingExpiryFilter, visibleListingStatus } from '../src/lib/listing-visibility.ts'

describe('listing expiry visibility', () => {
  test('public active-listing queries exclude records at or before the expiry instant', () => {
    const now = new Date('2026-11-11T12:00:00.000Z')
    expect(activeListingExpiryFilter(now)).toEqual({ expiresAt: { gt: now } })
  })

  test('seller views report an overdue ACTIVE record as EXPIRED without mutating it', () => {
    const now = new Date('2026-11-11T12:00:00.000Z')
    expect(visibleListingStatus('ACTIVE', new Date('2026-11-11T11:59:59.999Z'), now)).toBe('EXPIRED')
    expect(visibleListingStatus('ACTIVE', now, now)).toBe('EXPIRED')
    expect(visibleListingStatus('ACTIVE', new Date('2026-11-11T12:00:00.001Z'), now)).toBe('ACTIVE')
  })

  test('non-active seller states are preserved', () => {
    const now = new Date('2026-11-11T12:00:00.000Z')
    expect(visibleListingStatus('PAUSED', new Date('2026-11-01T00:00:00.000Z'), now)).toBe('PAUSED')
    expect(visibleListingStatus('EXPIRED', new Date('2026-11-01T00:00:00.000Z'), now)).toBe('EXPIRED')
  })
})
