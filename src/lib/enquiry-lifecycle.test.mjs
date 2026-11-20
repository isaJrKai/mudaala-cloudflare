import { describe, expect, test } from 'bun:test'
import { enquiryTransitionAllowed } from './enquiry-lifecycle'
import { linkedAdShowsAvailableWhileOutOfStock } from './business-records'

// Every cell of the lifecycle matrix: rows = current status, columns = target.
describe('enquiry lifecycle transitions', () => {
  const statuses = ['OPEN', 'RESOLVED', 'CANCELLED']

  test('merchant matrix: resolve and reopen, never resurrect cancelled', () => {
    expect(enquiryTransitionAllowed('OPEN', 'RESOLVED', true)).toBe(true)
    expect(enquiryTransitionAllowed('OPEN', 'CANCELLED', true)).toBe(true)
    expect(enquiryTransitionAllowed('RESOLVED', 'OPEN', true)).toBe(true)
    expect(enquiryTransitionAllowed('RESOLVED', 'CANCELLED', true)).toBe(false)
    expect(enquiryTransitionAllowed('CANCELLED', 'OPEN', true)).toBe(false)
    expect(enquiryTransitionAllowed('CANCELLED', 'RESOLVED', true)).toBe(false)
  })

  test('shopper matrix: close and reopen, never resolve (that is the merchant verdict)', () => {
    expect(enquiryTransitionAllowed('OPEN', 'RESOLVED', false)).toBe(false)
    expect(enquiryTransitionAllowed('OPEN', 'CANCELLED', false)).toBe(true)
    expect(enquiryTransitionAllowed('RESOLVED', 'OPEN', false)).toBe(true)
    expect(enquiryTransitionAllowed('RESOLVED', 'CANCELLED', false)).toBe(false)
    expect(enquiryTransitionAllowed('CANCELLED', 'OPEN', false)).toBe(false)
    expect(enquiryTransitionAllowed('CANCELLED', 'RESOLVED', false)).toBe(false)
  })

  test('no-op status moves are rejected to keep PATCH meaningful', () => {
    for (const status of statuses) {
      expect(enquiryTransitionAllowed(status, status, true)).toBe(false)
      expect(enquiryTransitionAllowed(status, status, false)).toBe(false)
    }
  })
})

describe('linkedAdShowsAvailableWhileOutOfStock', () => {
  test('warns only when a tracked, linked, out-of-stock product sits behind an available ad', () => {
    const available = { availabilityStatus: 'IN_STOCK' }
    expect(linkedAdShowsAvailableWhileOutOfStock({ trackInventory: true, stockOnHand: 0, listing: available })).toBe(true)
    expect(linkedAdShowsAvailableWhileOutOfStock({ trackInventory: true, stockOnHand: 0, listing: { availabilityStatus: 'OUT_OF_STOCK' } })).toBe(false)
    expect(linkedAdShowsAvailableWhileOutOfStock({ trackInventory: true, stockOnHand: 3, listing: available })).toBe(false)
    expect(linkedAdShowsAvailableWhileOutOfStock({ trackInventory: false, stockOnHand: 0, listing: available })).toBe(false)
    expect(linkedAdShowsAvailableWhileOutOfStock({ trackInventory: true, stockOnHand: 0, listing: null })).toBe(false)
  })
})
