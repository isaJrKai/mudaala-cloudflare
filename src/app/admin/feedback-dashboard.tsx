'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageSquareWarning, RefreshCw } from 'lucide-react'

type FeedbackStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'ALL'
type FeedbackPriority = 'NORMAL' | 'HIGH' | 'URGENT'
interface FeedbackItem {
  id: string
  category: string
  title: string
  description: string
  pagePath: string | null
  userAgent: string | null
  contact: string | null
  status: Exclude<FeedbackStatus, 'ALL'>
  priority: FeedbackPriority
  adminNotes: string | null
  createdAt: string
  updatedAt: string
  reporterName: string
}

function FeedbackCard({ item, onSaved }: { item: FeedbackItem; onSaved: () => void }) {
  const [status, setStatus] = useState<Exclude<FeedbackStatus, 'ALL'>>(item.status)
  const [priority, setPriority] = useState<FeedbackPriority>(item.priority)
  const [adminNotes, setAdminNotes] = useState(item.adminNotes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/feedback/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, priority, adminNotes }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error ?? 'Could not save this update.')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection problem. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-secondary px-2 py-1 font-medium text-secondary-foreground">{item.category.replaceAll('_', ' ')}</span>
        <span>From {item.reporterName}</span><span>·</span>
        <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
        <span className="ml-auto rounded-full border px-2 py-1">{item.priority}</span>
      </div>
      <h3 className="mt-3 text-base font-semibold">{item.title}</h3>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{item.description}</p>
      {item.pagePath ? <p className="mt-3 text-xs text-muted-foreground">Page: <code>{item.pagePath}</code></p> : null}
      {item.contact ? <p className="mt-2 text-sm">Requested follow-up: <span className="font-medium">{item.contact}</span></p> : null}
      {item.userAgent ? <details className="mt-2"><summary className="cursor-pointer text-xs text-muted-foreground">Technical details</summary><p className="mt-1 break-all text-xs text-muted-foreground">{item.userAgent}</p></details> : null}
      <form onSubmit={save} className="mt-4 space-y-3 border-t pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium">Status
            <select value={status} onChange={(event) => setStatus(event.target.value as Exclude<FeedbackStatus, 'ALL'>)} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option>
            </select>
          </label>
          <label className="text-xs font-medium">Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value as FeedbackPriority)} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option>
            </select>
          </label>
        </div>
        <label className="block text-xs font-medium">Internal admin notes (not visible to the reporter)
          <textarea value={adminNotes} onChange={(event) => setAdminNotes(event.target.value)} maxLength={3000} rows={2} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Investigation notes or next steps" />
        </label>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <button type="submit" disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Save triage update
        </button>
      </form>
    </li>
  )
}

export function FeedbackDashboard() {
  const [status, setStatus] = useState<FeedbackStatus>('OPEN')
  const [items, setItems] = useState<FeedbackItem[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const response = await fetch(`/api/admin/feedback?status=${status}`)
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error ?? 'Could not load the feedback inbox.')
      setItems(payload?.feedback ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection problem. Please refresh.')
      setItems([])
    }
  }, [status])

  useEffect(() => { void load() }, [load])

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'ALL'] as const).map((value) => (
          <button key={value} type="button" onClick={() => setStatus(value)} aria-pressed={status === value} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${status === value ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-accent/50'}`}>
            {value === 'IN_PROGRESS' ? 'In progress' : value === 'ALL' ? 'All' : value[0] + value.slice(1).toLowerCase()}
          </button>
        ))}
        <button type="button" onClick={() => void load()} className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium"><RefreshCw className="size-3.5" aria-hidden /> Refresh</button>
      </div>
      {error ? <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      {items === null ? <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Loading feedback…</p> : items.length === 0 ? <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><MessageSquareWarning className="size-4" aria-hidden /> No feedback in this queue.</p> : (
        <ul className="mt-3 space-y-3">{items.map((item) => <FeedbackCard key={item.id} item={item} onSaved={() => void load()} />)}</ul>
      )}
    </div>
  )
}
