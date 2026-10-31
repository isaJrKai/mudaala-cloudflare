import { describe, expect, test } from 'bun:test'
import { withBestEffortExpirySweep } from '../src/lib/ad-page.ts'

describe('public listing expiry sweep fallback', () => {
  test('continues the listing lookup when opportunistic expiry cleanup rejects', async () => {
    const events = []
    const expectedListing = { id: 'fixture-listing', status: 'ACTIVE' }

    const result = await withBestEffortExpirySweep(
      async () => {
        events.push('sweep')
        throw new Error('simulated transient database failure')
      },
      async () => {
        events.push('lookup')
        return expectedListing
      },
      (message, detail) => {
        events.push(`log:${message}:${detail}`)
      },
    )

    expect(result).toEqual(expectedListing)
    expect(events[0]).toBe('sweep')
    expect(events[1]).toContain('log:')
    expect(events[2]).toBe('lookup')
  })

  test('runs the listing lookup after a successful sweep without logging', async () => {
    const events: string[] = []
    const result = await withBestEffortExpirySweep(
      async () => { events.push('sweep') },
      async () => { events.push('lookup'); return 'listing-found' },
      () => { events.push('unexpected-log') },
    )

    expect(result).toBe('listing-found')
    expect(events).toEqual(['sweep', 'lookup'])
  })

  test('does not swallow a listing lookup failure', async () => {
    await expect(
      withBestEffortExpirySweep(
        async () => { throw new Error('sweep unavailable') },
        async () => { throw new Error('listing query unavailable') },
        () => undefined,
      ),
    ).rejects.toThrow('listing query unavailable')
  })
})
