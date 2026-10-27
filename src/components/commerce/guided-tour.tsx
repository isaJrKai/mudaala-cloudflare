'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { useSession } from '@/hooks/use-session'

type TourView = 'account' | 'publish' | 'listing'

type TourStep = {
  view: TourView
  target: string
  title: string
  body: string
  requiresSave?: boolean
  requiresPublish?: boolean
}

const SHOP_STEPS: TourStep[] = [
  { view: 'account', target: 'shop-name', title: 'Give your shop its name', body: 'Use the name customers know. This is the identity buyers will see on your shop and listings.' },
  { view: 'account', target: 'shop-trade', title: 'Tell buyers what you sell', body: 'Choose the closest trade or category. It helps customers understand your shop.' },
  { view: 'account', target: 'shop-area', title: 'Help people find you', body: 'Add your area or town and district. Use a location customers will recognise.' },
  { view: 'account', target: 'shop-photo', title: 'Add a real shop photo', body: 'A shop sign, storefront or logo helps people recognise you. You can use your phone camera or gallery.' },
  { view: 'account', target: 'shop-description', title: 'Describe your business', body: 'A couple of honest lines about what you sell is enough. You can leave optional details for later.' },
  { view: 'account', target: 'shop-save', title: 'Save your shop details', body: 'When you are ready, tap Save shop. We will move on only after Mudaala confirms the save.', requiresSave: true },
]

const PRODUCT_STEPS: TourStep[] = [
  { view: 'publish', target: 'product-title', title: 'Name one real product or service', body: 'Use the words customers would search for. Be specific; do not add claims or stock you cannot stand behind.' },
  { view: 'publish', target: 'product-category', title: 'Choose its category', body: 'Pick the closest category so customers can discover the item in the right part of the market.' },
  { view: 'publish', target: 'product-description', title: 'Explain what buyers should know', body: 'Describe the item honestly: condition, size, materials, what is included, or the service you provide.' },
  { view: 'publish', target: 'product-price', title: 'Set an honest price', body: 'Enter the actual price or starting price. If the price needs discussion, use the negotiable option rather than inventing a number.' },
  { view: 'publish', target: 'product-photos', title: 'Add a real photo', body: 'Use a clear photo of the actual item, your work, or your service. You can add more photos later.' },
  { view: 'publish', target: 'product-publish', title: 'Publish your listing', body: 'Check the price, location and contact details. Publish only when the information is accurate; the guide will continue after a successful publish.', requiresPublish: true },
]

const PREVIEW_STEP: TourStep = {
  view: 'listing',
  target: 'public-preview',
  title: 'This is your public product page',
  body: 'Buyers can see the product details here and contact you directly. Check the page looks right, then finish the guide.',
}

const COMPLETE_KEY = 'mudaala_guided_shop_setup_completed'

type Rect = { top: number; left: number; width: number; height: number }
type TourPhase = 'shop' | 'shop-complete' | 'product' | 'preview'

export function GuidedTour() {
  const { user } = useSession()
  const view = useAppStore((state) => state.view)
  const navigate = useAppStore((state) => state.navigate)
  const [phase, setPhase] = useState<TourPhase | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [saved, setSaved] = useState(false)

  const close = useCallback((completed = false) => {
    setPhase(null)
    setRect(null)
    try {
      if (completed) localStorage.setItem(COMPLETE_KEY, '1')
    } catch {
      // The tour remains usable when browser storage is unavailable.
    }
  }, [])

  useEffect(() => {
    const onStart = () => {
      navigate({ name: 'account' })
      setPhase('shop')
      setStepIndex(0)
      setSaved(false)
    }
    const onSaved = () => {
      if (phase === 'shop' && SHOP_STEPS[stepIndex]?.requiresSave) setSaved(true)
    }
    const onPublished = (event: Event) => {
      if (phase !== 'product') return
      const id = (event as CustomEvent<{ id?: string }>).detail?.id
      if (!id) return
      setPhase('preview')
      setStepIndex(0)
      setRect(null)
      navigate({ name: 'listing', id })
    }
    window.addEventListener('mudaala:start-shop-tour', onStart)
    window.addEventListener('mudaala:shop-profile-saved', onSaved)
    window.addEventListener('mudaala:listing-published', onPublished)
    return () => {
      window.removeEventListener('mudaala:start-shop-tour', onStart)
      window.removeEventListener('mudaala:shop-profile-saved', onSaved)
      window.removeEventListener('mudaala:listing-published', onPublished)
    }
  }, [navigate, phase, stepIndex])

  const steps = phase === 'shop' ? SHOP_STEPS : phase === 'product' ? PRODUCT_STEPS : phase === 'preview' ? [PREVIEW_STEP] : []
  const step = steps[stepIndex]

  useEffect(() => {
    if (!step || view.name !== step.view) return
    const selector = `[data-tour="${step.target}"]`
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
  }, [phase, stepIndex, view.name])

  if (!user || !phase) return null

  if (phase === 'shop-complete') {
    return (
      <div className="fixed inset-x-3 bottom-4 z-[100] mx-auto max-w-lg rounded-xl border bg-card p-4 shadow-xl sm:bottom-6" role="status" aria-live="polite">
        <p className="font-semibold">Your shop details are saved</p>
        <p className="mt-1 text-sm text-muted-foreground">Your shop identity is ready. Add one real product next, then check the public page buyers will see.</p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded-md px-3 py-2 text-sm hover:bg-accent" onClick={() => close(true)}>Finish for now</button>
          <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => { setPhase('product'); setStepIndex(0); navigate({ name: 'publish' }) }}>Add my first product</button>
        </div>
      </div>
    )
  }

  const waitingForSave = Boolean(step?.requiresSave && !saved)
  const waitingForPublish = Boolean(step?.requiresPublish)
  const progressLabel = phase === 'shop' ? 'Set up your shop' : phase === 'product' ? 'Add your first product' : 'Public preview'
  const panelPosition = step?.target === 'product-publish' ? 'top-4 bottom-auto' : 'bottom-4 sm:bottom-6'

  return (
    <div className="pointer-events-none fixed inset-0 z-[99]" aria-label="Mudaala guided setup">
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
        className={`pointer-events-auto fixed inset-x-3 ${panelPosition} mx-auto max-w-lg rounded-xl border bg-card p-4 shadow-xl sm:p-5`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">{progressLabel} · {stepIndex + 1} of {steps.length}</p>
            <h2 id="mudaala-tour-title" className="mt-1 text-lg font-semibold">{step.title}</h2>
          </div>
          <button type="button" className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent" onClick={() => close(false)}>Skip</button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
        {waitingForSave ? <p className="mt-3 rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">Tap the highlighted Save shop button when you are ready. This guide will wait for a successful save.</p> : null}
        {step?.requiresSave && saved ? <p className="mt-3 text-sm font-medium text-primary">Save confirmed. Your profile has been saved.</p> : null}
        {waitingForPublish ? <p className="mt-3 rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">Publish the listing using the highlighted button. This guide will continue only after the listing is created successfully.</p> : null}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-2 text-sm hover:bg-accent"
            onClick={() => {
              if (stepIndex > 0) setStepIndex((current) => current - 1)
              else if (phase === 'product') setPhase('shop-complete')
              else if (phase === 'preview') close(false)
              else close(false)
            }}
          >Back</button>
          {step?.requiresSave ? (
            <button type="button" disabled={!saved} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" onClick={() => { setSaved(false); setPhase('shop-complete'); setStepIndex(0); setRect(null) }}>Continue</button>
          ) : step?.requiresPublish ? (
            <button type="button" disabled className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-60">Waiting for publish</button>
          ) : phase === 'preview' ? (
            <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => close(true)}>Finish guide</button>
          ) : (
            <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => setStepIndex((current) => current + 1)}>Next</button>
          )}
        </div>
      </section>
    </div>
  )
}
