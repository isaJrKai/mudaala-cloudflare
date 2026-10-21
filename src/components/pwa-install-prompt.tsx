'use client'

import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISS_KEY = 'mudaala:pwa-install-dismissed-until'
const INSTALLED_KEY = 'mudaala:pwa-installed'

function saveDismissal() {
  try {
    // Respect a deliberate close for 30 days rather than reappearing on every page.
    window.localStorage.setItem(DISMISS_KEY, String(Date.now() + 30 * 24 * 60 * 60 * 1000))
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    let storedInstalled = false
    let storedDismissed = false
    try {
      storedInstalled = window.localStorage.getItem(INSTALLED_KEY) === 'true'
      const until = Number(window.localStorage.getItem(DISMISS_KEY) || 0)
      storedDismissed = until > Date.now()
      if (!storedDismissed) window.localStorage.removeItem(DISMISS_KEY)
    } catch {
      // Continue with the browser's native install state if storage is blocked.
    }
    const installStateFrame = window.requestAnimationFrame(() => {
      setInstalled(standalone || storedInstalled)
      setDismissed(storedDismissed)
      setReady(true)
    })

    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as InstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setInstallEvent(null)
      setHelpOpen(false)
      setDismissed(false)
      try {
        window.localStorage.setItem(INSTALLED_KEY, 'true')
        window.localStorage.removeItem(DISMISS_KEY)
      } catch {
        // The app-installed event still hides the prompt in this running page.
      }
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.cancelAnimationFrame(installStateFrame)
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!ready || installed || dismissed) return null

  async function install() {
    if (!installEvent) {
      setHelpOpen((open) => !open)
      return
    }
    await installEvent.prompt()
    const choice = await installEvent.userChoice
    if (choice.outcome === 'accepted') {
      setInstallEvent(null)
      setDismissed(true)
      saveDismissal()
    } else {
      // Keep the button available after a cancelled native install dialog.
      setInstallEvent(null)
    }
  }

  function dismiss() {
    setDismissed(true)
    setHelpOpen(false)
    saveDismissal()
  }

  return (
    <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-3 z-[80] flex max-w-[calc(100vw-4.5rem)] flex-col items-start gap-2 sm:bottom-5 sm:left-5 sm:max-w-[calc(100vw-6rem)]">
      {helpOpen && (
        <section className="w-[min(21rem,calc(100vw-4.5rem))] max-w-full rounded-xl border border-border bg-background p-4 text-foreground shadow-lg" aria-live="polite">
          <div className="mb-2 flex items-start justify-between gap-3">
            <h2 className="font-semibold">Get Mudaala on your device</h2>
            <button type="button" onClick={() => setHelpOpen(false)} aria-label="Close install help" className="rounded p-1 text-muted-foreground hover:bg-muted">
              <X size={17} />
            </button>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            { /iPhone|iPad|iPod/i.test(navigator.userAgent)
              ? 'On your iPhone or iPad, open this page in Safari, tap Share, choose “Add to Home Screen”, turn on “Open as Web App”, then tap Add. If Mudaala opened inside WhatsApp or another app, open the link in Safari first.'
              : /Android/i.test(navigator.userAgent)
                ? 'Open this page in Chrome, tap the browser menu, then choose “Install app” or “Add to Home screen”.'
                : 'In Chrome or Edge, use the install icon in the address bar, or open the browser menu and choose “Install Mudaala”.' }
          </p>
          <p className="mt-2 text-xs text-muted-foreground">No separate account or second app is needed. Sign in with your existing Mudaala account.</p>
        </section>
      )}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={install}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[#1d4a35] px-2.5 py-2.5 text-xs font-semibold text-white shadow-md transition hover:bg-[#163a29] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d4a35] focus-visible:ring-offset-2 sm:gap-2 sm:px-4 sm:text-sm"
          aria-expanded={helpOpen}
        >
          <Download size={16} />
          <span className="install-label"><span className="sm:hidden">Get app</span><span className="hidden sm:inline">{installEvent ? 'Install Mudaala' : 'Get the app'}</span></span>
        </button>
        <button type="button" onClick={dismiss} aria-label="Hide install button" className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted sm:size-8">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
