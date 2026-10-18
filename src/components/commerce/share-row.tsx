'use client'

// Share a live ad. Two actions only, because this is how trade actually
// spreads in Uganda: forward it on WhatsApp, or copy the link for anywhere
// else. The full URL sits under the buttons so a buyer can see exactly what
// they are about to send - and still has a manual path if the clipboard
// refuses. The caller resolves the absolute URL (the server-rendered ad page
// passes its canonical origin; the in-app detail resolves window.origin),
// so this row stays dumb and portable.

import { useEffect, useRef, useState } from 'react'
import { Check, Link2, Share2 } from 'lucide-react'
import { WhatsAppIcon } from '@/components/commerce/brand-icons'
import { copy } from '@/lib/copy'

interface ShareAdRowProps {
  title: string
  url: string
  priceLabel?: string | null
  label?: string
  // What is being shared, for the sentence: "Check this ad on Mudaala" vs
  // "Check this shop on Mudaala".
  noun?: string
}

export function ShareAdRow({ title, url, priceLabel, label = copy.listing.shareAria, noun = 'ad' }: ShareAdRowProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const shareText = `Check this ${noun} on Mudaala: ${title}${priceLabel ? ` (${priceLabel})` : ''}`
  const waHref = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${url}`)}`

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard denied (older browser, embedded webview). The URL is
      // rendered as text right below - the manual path is one long-press away.
    }
  }

  // Native share sheet where the platform offers one (most Android phones
  // with WhatsApp installed): lets the buyer pick ANY channel, WhatsApp
  // still pre-installed as the explicit first button.
  async function nativeShare() {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ title, text: shareText, url })
      } catch {
        // User dismissed the sheet - not an error.
      }
    } else {
      void copyLink()
    }
  }

  return (
    <div>
      <p className="text-sm font-semibold">{label}</p>
      <div className="mt-2 flex gap-2">
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="whatsapp-brand press flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border text-[14px] font-semibold"
          aria-label={`Share ${title} on WhatsApp`}
        >
          <WhatsAppIcon className="size-4" aria-hidden /> WhatsApp
        </a>
        <button
          type="button"
          onClick={copyLink}
          className="press flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border bg-card text-[14px] font-medium hover:bg-accent/50"
          aria-label="Copy ad link"
        >
          {copied ? (
            <>
              <Check className="size-4 text-emerald-700" aria-hidden /> Copied
            </>
          ) : (
            <>
              <Link2 className="size-4" aria-hidden /> Copy link
            </>
          )}
        </button>
        {'share' in (typeof navigator !== 'undefined' ? navigator : {}) ? (
          <button
            type="button"
            onClick={nativeShare}
            className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-card hover:bg-accent/50"
            aria-label="More share options"
          >
            <Share2 className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Share this ad on social media">
        <a
          href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="press rounded-md border bg-card px-3 py-2 text-xs font-medium hover:bg-accent/50"
        >
          Facebook
        </a>
        <a
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="press rounded-md border bg-card px-3 py-2 text-xs font-medium hover:bg-accent/50"
        >
          X
        </a>
        <a
          href={`https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(shareText)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="press rounded-md border bg-card px-3 py-2 text-xs font-medium hover:bg-accent/50"
        >
          Pinterest
        </a>
        <a
          href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${shareText}\\n${url}`)}`}
          className="press rounded-md border bg-card px-3 py-2 text-xs font-medium hover:bg-accent/50"
        >
          Email
        </a>
      </div>
      <p className="mt-1.5 truncate text-xs text-muted-foreground" title={url}>
        {url}
      </p>
    </div>
  )
}
