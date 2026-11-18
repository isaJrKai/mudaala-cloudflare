'use client'

import { useState } from 'react'
import { MessageSquareWarning, X, Loader2, CheckCircle2 } from 'lucide-react'
import { AppealCasePortal } from './appeal-case-portal'

const CATEGORIES = [
  { value: 'BUG', label: 'Something is broken' },
  { value: 'PERFORMANCE', label: 'Slow or not loading' },
  { value: 'COMPLAINT', label: 'Complaint or concern' },
  { value: 'IDEA', label: 'Suggestion or idea' },
  { value: 'OTHER', label: 'Something else' },
  { value: 'APPEAL', label: 'Appeal an account, shop or listing restriction' },
] as const

export function FeedbackButton({ floating = false }: { floating?: boolean }) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['value']>('BUG')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [contact, setContact] = useState('')
  const [appealTargetType, setAppealTargetType] = useState<'USER' | 'SHOP' | 'LISTING'>('USER')
  const [appealTargetRef, setAppealTargetRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [appealAccessToken, setAppealAccessToken] = useState('')
  const [appealCaseId, setAppealCaseId] = useState('')
  const [showExistingCase, setShowExistingCase] = useState(false)
  const [existingCaseId, setExistingCaseId] = useState('')
  const [existingAccessToken, setExistingAccessToken] = useState('')

  function close() {
    if (busy) return
    setOpen(false)
    setError('')
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const isAppeal = category === 'APPEAL'
      const response = await fetch(isAppeal ? '/api/appeals' : '/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(isAppeal ? {
          targetType: appealTargetType,
          targetReference: appealTargetType === 'USER' ? undefined : appealTargetRef.trim(),
          contact: contact.trim(),
          title,
          statement: description,
        } : {
          category, title, description, contact: contact.trim() || null,
          pagePath: window.location.pathname + window.location.hash,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error ?? 'Your feedback could not be sent. Please try again.')
      setSent(true)
      setAppealAccessToken(payload?.appealCase?.accessToken ?? '')
      setAppealCaseId(payload?.appealCase?.id ?? '')
      setTitle('')
      setDescription('')
      setContact('')
      setAppealTargetRef('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection problem. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" aria-label={floating ? 'Report a bug' : undefined} onClick={() => { setOpen(true); setSent(false); setError('') }} className={floating
        ? 'fixed bottom-[calc(5.25rem_+_env(safe-area-inset-bottom))] right-3 z-[70] flex size-10 items-center justify-center rounded-full border bg-background/95 shadow-md hover:bg-accent sm:bottom-5 sm:right-5'
        : 'inline-flex items-center gap-1.5 hover:text-foreground hover:underline'}>
        <MessageSquareWarning className="size-4" aria-hidden />
        {floating ? null : 'Report a bug / Send feedback'}
      </button>
      {open ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
          <section role="dialog" aria-modal="true" aria-labelledby="feedback-title" className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border bg-background p-5 shadow-xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="feedback-title" className="text-lg font-semibold">Help us improve Mudaala</h2>
                <p className="mt-1 text-sm text-muted-foreground">{category === 'APPEAL' ? 'Send a review request for an account, shop or listing restriction.' : 'Tell the admin team what went wrong or what we should improve.'}</p>
              </div>
              <button type="button" aria-label="Close feedback form" onClick={close} disabled={busy} className="rounded-md p-2 hover:bg-muted disabled:opacity-50"><X className="size-4" aria-hidden /></button>
            </div>

            {!sent ? (
              <details className="mb-4 rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">Already submitted an appeal? Open your case</summary>
                <div className="mt-3 space-y-2">
                  <input value={existingCaseId} onChange={(event) => setExistingCaseId(event.target.value.trim())} maxLength={80} placeholder="Appeal case reference" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
                  <input value={existingAccessToken} onChange={(event) => setExistingAccessToken(event.target.value.trim())} maxLength={128} placeholder="Private appeal access code" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
                  <button type="button" onClick={() => setShowExistingCase(Boolean(existingCaseId && existingAccessToken))} disabled={!existingCaseId || !existingAccessToken} className="h-9 rounded-md border px-3 text-sm disabled:opacity-50">Open existing case</button>
                  {showExistingCase && existingCaseId && existingAccessToken ? <AppealCasePortal caseId={existingCaseId} accessToken={existingAccessToken} /> : null}
                </div>
              </details>
            ) : null}
            {sent ? (
              <div className="mt-5 rounded-lg border bg-muted/40 p-4">
                <CheckCircle2 className="size-5 text-primary" aria-hidden />
                <h3 className="mt-2 font-medium">{category === 'APPEAL' ? 'Appeal case created' : 'Feedback sent'}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{category === 'APPEAL' ? 'Your appeal has its own case record. Keep the private access code below; you will need it to follow up while your account is restricted.' : 'Thank you. Your message is now in the private Mudaala admin inbox. We also included the page you were on to help us investigate.'}</p>
                {category === 'APPEAL' && appealAccessToken ? <div className="mt-3 rounded-md border bg-background p-3"><p className="text-xs font-semibold">Appeal case reference</p><code className="mt-1 block break-all text-xs">{appealCaseId}</code><p className="mt-2 text-xs font-semibold">Private appeal access code</p><code className="mt-1 block break-all text-xs">{appealAccessToken}</code><p className="mt-1 text-xs text-muted-foreground">Save this code somewhere private. Mudaala stores only its hash and cannot show it again.</p></div> : null}
                {category === 'APPEAL' && appealCaseId && appealAccessToken ? <AppealCasePortal caseId={appealCaseId} accessToken={appealAccessToken} /> : null}
                <button type="button" onClick={close} className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Done</button>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="feedback-category" className="mb-1.5 block text-sm font-medium">What is this about?</label>
                  <select id="feedback-category" value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                    {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </div>
                {category === 'APPEAL' ? (
                  <>
                    <div>
                      <label htmlFor="appeal-target-type" className="mb-1.5 block text-sm font-medium">What was restricted?</label>
                      <select id="appeal-target-type" value={appealTargetType} onChange={(event) => { setAppealTargetType(event.target.value as typeof appealTargetType); setAppealTargetRef('') }} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                        <option value="USER">My Mudaala account</option>
                        <option value="SHOP">My shop</option>
                        <option value="LISTING">One of my listings</option>
                      </select>
                    </div>
                    {appealTargetType !== 'USER' ? (
                      <div>
                        <label htmlFor="appeal-target-ref" className="mb-1.5 block text-sm font-medium">{appealTargetType === 'SHOP' ? 'Shop code (MD-XXXX)' : 'Listing ID'}</label>
                        <input id="appeal-target-ref" value={appealTargetRef} onChange={(event) => setAppealTargetRef(event.target.value.slice(0, 120))} required minLength={3} maxLength={120} placeholder={appealTargetType === 'SHOP' ? 'Enter the MD-XXXX code shown on your shop' : 'Enter the ID from your listing link'} className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
                      </div>
                    ) : null}
                  </>
                ) : null}
                <div>
                  <label htmlFor="feedback-title-input" className="mb-1.5 block text-sm font-medium">Short summary</label>
                  <input id="feedback-title-input" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={4} maxLength={120} placeholder={category === 'APPEAL' ? 'e.g. Request to review my shop restriction' : "e.g. Photos won't upload"} className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
                </div>
                <div>
                  <label htmlFor="feedback-description" className="mb-1.5 block text-sm font-medium">What happened?</label>
                  <textarea id="feedback-description" value={description} onChange={(event) => setDescription(event.target.value)} required minLength={20} maxLength={3000} rows={5} placeholder={category === 'APPEAL' ? 'Explain what happened, why you believe the restriction should be reviewed, and any relevant details.' : 'Tell us what you tried, what you expected, and what happened instead.'} className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm" />
                  <p className="mt-1 text-xs text-muted-foreground">{description.length}/3000 characters. Please don't include passwords or payment secrets.</p>
                </div>
                <div>
                  <label htmlFor="feedback-contact" className="mb-1.5 block text-sm font-medium">{category === 'APPEAL' ? 'Registered Mudaala phone number (required)' : 'Contact details (optional)'}</label>
                  <input id="feedback-contact" value={contact} onChange={(event) => setContact(event.target.value)} required={category === 'APPEAL'} maxLength={120} placeholder={category === 'APPEAL' ? '+256 7XX XXX XXX' : "Email or phone if you'd like us to follow up"} className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
                  <p className="mt-1 text-xs text-muted-foreground">{category === 'APPEAL' ? 'We use this number to match the restriction. An administrator may verify ownership before changing account access or shop visibility.' : 'Only the admin team can see this message and contact detail.'}</p>
                </div>
                {error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
                <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                  <button type="button" onClick={close} disabled={busy} className="h-10 rounded-md border px-4 text-sm font-medium disabled:opacity-50">Cancel</button>
                  <button type="submit" disabled={busy} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
                    {busy ? <><Loader2 className="size-4 animate-spin" aria-hidden /> Sending…</> : 'Send to Mudaala admin'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </>
  )
}
