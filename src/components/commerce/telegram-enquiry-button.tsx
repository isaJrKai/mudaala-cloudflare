'use client'

import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/client'

export function TelegramEnquiryButton({ listingId, enabled }: { listingId: string; enabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!enabled) return null

  return (
    <div className="mt-3">
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        className="press h-11 w-full gap-1.5 text-[15px]"
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            const payload = await apiFetch<{ url?: string }>('/api/telegram/contact-token', {
              method: 'POST',
              body: JSON.stringify({ listingId }),
            })
            if (!payload.url) throw new Error('Telegram enquiries are temporarily unavailable.')
            window.location.href = payload.url
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not open Telegram. Please try again.')
            setBusy(false)
          }
        }}
      >
        <MessageCircle className="size-4" aria-hidden />
        {busy ? 'Opening Telegram…' : 'Message seller on Telegram'}
      </Button>
      {error ? <p role="alert" className="mt-1.5 text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
