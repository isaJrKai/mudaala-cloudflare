'use client'

// Fires once when a shop page was opened from an NFC tag or tag QR. The page
// itself is server-rendered and cacheable-by-crawlers, so the count is a
// client beacon: bots that never run JS and link previews are not counted.
// sessionStorage keeps a refresh/back-forward from counting twice.

import { useEffect } from 'react'

export function TagTapBeacon({ tagCode, via }: { tagCode: string; via: 'nfc' | 'qr' }) {
  useEffect(() => {
    const key = `mudaala-tag-tap:${tagCode}`
    try {
      if (window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, '1')
    } catch {
      // Storage can be blocked; counting once more is better than failing.
    }
    void fetch('/api/shops/tag-tap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: tagCode, v: via }),
      keepalive: true,
    }).catch(() => undefined)
  }, [tagCode, via])

  return null
}
