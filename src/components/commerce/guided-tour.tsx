'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { useSession } from '@/hooks/use-session'

type TourStep = {
  target: string
  title: string
  body: string
  requiresSave?: boolean
}

const STEPS: TourStep[] = [
  { target: 'shop-name', title: 'Give your shop its name', body: 'Use the name customers know. This is the identity buyers will see on your shop and listings.' },
  { target: 'shop-trade', title: 'Tell buyers what you sell', body: 'Choose the closest trade or category. It helps customers understand your shop.' },
  { target: 'shop-area', title: 'Help people find you', body: 'Add your area or town and district. Use a location customers will recognise.' },
  { target: 'shop-photo', title: 'Add a real shop photo', body: 'A shop sign, storefront or logo helps people recognise you. You can use your phone camera or gallery.' },
  { target: 'shop-description', title: 'Describe your business', body: 'A couple of honest lines about what you sell is enough. You can leave optional details for later.' },
  { target: 'shop-save', title: 'Save your shop details', body: 'When you are ready, tap Save shop. We will move on only after Mudaala confirms the save.', requiresSave: true },
]

const REQUEST_KEY = 'mudaala_guided_shop_setup_requested'
const COMPLETE_KEY = 'mudaala_guided_shop_setup_completed'

type Rect = { top: number; left: number; width: number; height: number }

export function GuidedTour() {
  const { user } = useSession()
  const view = useAppStore((state) => state.view)
  const navigate = useAppStore((state) => state.navigate)
  const [stepIndex, setStepIndex] = useState(-1)
  const [rect, setRect] = useState<Rect | null>(null)
  const [saved, setSaved] = useState(false)

  const close = useCallback((completed = false) => {
    setStepIndex(-1)
    setRect(null)
    try {
      localStorage.removeItem(REQUEST_KEY)
      if (completed) localStorage.setItem(COMPLETE_KEY, '1')
    } catch {
      // The tour remains usable when browser storage is unavailable.
    }
  }, [])

  useEffect(() => {
    if (!user || view.name !== 'account') return
    try {
      if (localStorage.getItem(REQUEST_KEY) === '1') setStepIndex(0)
    } catch {
      // Ignore unavailable browser storage.
    }
  }, [user, view.name])

  useEffect(() => {
    const onStart = () => {
      try {
        localStorage.setItem(REQUEST_KEY, '1')
      } catch {
        // The caller can still navigate to the profile.
      }
      navigate({ name: 'account' })
      setStepIndex(0)
      setSaved(false)
    }
    const onSaved = () => {
      setSaved(true)
      setStepIndex((current) => current === STEPS.length - 1 ? STEPS.length : current)
    }
    window.addEventListener('mudaala:start-shop-tour', onStart)
    window.addEventListener('mudaala:shop-profile-saved', onSaved)
    return () => {
      window.removeEventListener('mudaala:start-shop-tour', onStart)
      window.removeEventListener('mudaala:shop-profile-saved', onSaved)
    }
  }, [navigate])

  useEffect(() => {
    if (stepIndex < 0 || stepIndex >= STEPS.length || view.name !== 'account') {
      setRect(null)
      return
    }
    const selector = `[data-tour="${STEPS[stepIndex].target}"]`
    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const locate = () => {
      if (cancelled) return
      const element = document.querySelector<HTMLElement>(selector)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
        const bounds = element.getBoundingClientRect()
        setRect({ top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height })
        return
      }
      attempts += 1
      if (attempts < 12) timer = setTimeout(locate, 120)
      else setRect(null)
    }
    locate()
    const update = () => {
      const element = document.querySelector<HTMLElement>(selector)
      if (!element) return
      const bounds = element.getBoundingClientRect()
      setRect({ top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height })
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [stepIndex, view.name])

  if (!user || stepIndex < 0) return null

  if (stepIndex >= STEPS.length) {
    return (
      <div className="fixed inset-x-3 bottom-4 z-[100] mx-auto max-w-lg rounded-xl border bg-card p-4 shadow-xl sm:bottom-6" role="status" aria-live="polite">
        <p className="font-semibold">Your shop details are saved</p>
        <p className="mt-1 text-sm text-muted-foreground">Next, add a real product and preview your public shop. You can return here whenever you want to update your details.</p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded-md px-3 py-2 text-sm hover:bg-accent" onClick={() => close(true)}>Finish</button>
          <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" onClick={() => { close(true); navigate({ name: 'publish' }) }}>Add my first product</button>
        </div>
      </div>
    )
  }

  const step = STEPS[stepIndex]
  const waitingForSave = Boolean(step.requiresSave && !saved)

  return (
    <div className="fixed inset-0 z-[99]" aria-label="Shop setup guide">
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-lg border-2 border-primary"
          style={{
            top: Math.max(4, rect.top - 5),
            left: Math.max(4, rect.left - 5),
            width: Math.min(rect.width + 10, window.innerWidth - Math.max(4, rect.left - 5)),
            height: rect.height + 10,
            boxShadow: '0 0 0 9999px rgba(20, 35, 25, 0.58)',
            transition: 'top 160ms ease, left 160ms ease, width 160ms ease, height 160ms ease',
          }}
        />
      ) : <div aria-hidden="true" className="absolute inset-0 bg-foreground/50" />}
      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby="mudaala-tour-title"
        className="fixed inset-x-3 bottom-4 mx-auto max-w-lg rounded-xl border bg-card p-4 shadow-xl sm:bottom-6 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Set up your shop · {stepIndex + 1} of {STEPS.length}</p>
            <h2 id="mudaala-tour-title" className="mt-1 text-lg font-semibold">{step.title}</h2>
          </div>
          <button type="button" className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent" onClick={() => close(false)}>Skip</button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
        {waitingForSave ? <p className="mt-3 rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">Tap the highlighted Save shop button when you are ready. This guide will wait for a successful save.</p> : null}
        {step.requiresSave && saved ? <p className="mt-3 text-sm font-medium text-primary">Save confirmed. Your profile has been saved.</p> : null}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" className="rounded-md px-3 py-2 text-sm hover:bg-accent" onClick={() => stepIndex === 0 ? close(false) : setStepIndex((current) => current - 1)}>Back</button>
          {step.requiresSave ? (
            <button type="button" disabled={!saved} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" onClick={() => { setSaved(false); setStepIndex(STEPS.length) }}>Continue</button>
          ) : (
            <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => setStepIndex((current) => current + 1)}>Next</button>
          )}
        </div>
      </section>
    </div>
  )
}
