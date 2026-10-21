'use client'

import { useState } from 'react'
import { MessageSquareWarning, X, Loader2, CheckCircle2 } from 'lucide-react'

const CATEGORIES = [
  { value: 'BUG', label: 'Something is broken' },
  { value: 'PERFORMANCE', label: 'Slow or not loading' },
  { value: 'COMPLAINT', label: 'Complaint or concern' },
  { value: 'IDEA', label: 'Suggestion or idea' },
  { value: 'OTHER', label: 'Something else' },
] as const

export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['value']>('BUG')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

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
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category,
          title,
          description,
          contact: contact.trim() || null,
          pagePath: window.location.pathname + window.location.hash,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error ?? 'Your feedback could not be sent. Please try again.')
      setSent(true)
      setTitle('')
      setDescription('')
      setContact('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection problem. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setSent(false); setError('') }} className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline">
        <MessageSquareWarning className="size-3.5" aria-hidden />
        Report a bug / Send feedback
      </button>
      {open ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
          <section role="dialog" aria-modal="true" aria-labelledby="feedback-title" className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border bg-background p-5 shadow-xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="feedback-title" className="text-lg font-semibold">Help us improve Mudaala</h2>
                <p className="mt-1 text-sm text-muted-foreground">Tell the admin team what went wrong or what we should improve.</p>
              </div>
              <button type="button" aria-label="Close feedback form" onClick={close} disabled={busy} className="rounded-md p-2 hover:bg-muted disabled:opacity-50"><X className="size-4" aria-hidden /></button>
            </div>

            {sent ? (
              <div className="mt-5 rounded-lg border bg-muted/40 p-4">
                <CheckCircle2 className="size-5 text-primary" aria-hidden />
                <h3 className="mt-2 font-medium">Feedback sent</h3>
                <p className="mt-1 text-sm text-muted-foreground">Thank you. Your message is now in the private Mudaala admin inbox. We also included the page you were on to help us investigate.</p>
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
                <div>
                  <label htmlFor="feedback-title-input" className="mb-1.5 block text-sm font-medium">Short summary</label>
                  <input id="feedback-title-input" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={4} maxLength={120} placeholder="e.g. Photos won't upload" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
                </div>
                <div>
                  <label htmlFor="feedback-description" className="mb-1.5 block text-sm font-medium">What happened?</label>
                  <textarea id="feedback-description" value={description} onChange={(event) => setDescription(event.target.value)} required minLength={20} maxLength={3000} rows={5} placeholder="Tell us what you tried, what you expected, and what happened instead." className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm" />
                  <p className="mt-1 text-xs text-muted-foreground">{description.length}/3000 characters. Please don't include passwords or payment secrets.</p>
                </div>
                <div>
                  <label htmlFor="feedback-contact" className="mb-1.5 block text-sm font-medium">Contact details (optional)</label>
                  <input id="feedback-contact" value={contact} onChange={(event) => setContact(event.target.value)} maxLength={120} placeholder="Email or phone if you'd like us to follow up" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
                  <p className="mt-1 text-xs text-muted-foreground">Only the admin team can see this message and contact detail.</p>
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
