'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, ScrollText } from 'lucide-react'

type AuditEvent = {
  id: string
  action: string
  targetType: string
  targetId: string
  createdAt: string
  actor: string
}

export function AuditDashboard() {
  const [targetType, setTargetType] = useState('')
  const [action, setAction] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (targetType) params.set('targetType', targetType)
      if (action) params.set('action', action)
      if (query.trim()) params.set('q', query.trim())
      const response = await fetch('/api/admin/audit?' + params.toString(), { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error ?? 'Could not load audit history.')
      setEvents(payload?.events ?? [])
      setTotal(payload?.total ?? 0)
      setTotalPages(payload?.totalPages ?? 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection problem. Try again.')
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [page, targetType, action, query])

  useEffect(() => {
    const id = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(id)
  }, [load])

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(1)
    void load()
  }

  return (
    <div className="mt-4">
      <form onSubmit={applyFilters} className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
        <label className="text-xs font-medium">Target
          <select value={targetType} onChange={(event) => { setTargetType(event.target.value); setPage(1) }} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
            <option value="">All targets</option><option value="USER">People</option><option value="SHOP">Shops</option><option value="LISTING">Listings</option><option value="REPORT">Reports</option><option value="FEEDBACK">Feedback</option><option value="SYSTEM">System</option>
          </select>
        </label>
        <label className="text-xs font-medium">Action
          <input value={action} onChange={(event) => setAction(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 80))} placeholder="e.g. HIDE_LISTING" className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" />
        </label>
        <label className="text-xs font-medium">Target ID
          <input value={query} onChange={(event) => setQuery(event.target.value.slice(0, 80))} placeholder="Search a record ID" className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" />
        </label>
        <button type="submit" className="mt-auto h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">Filter</button>
      </form>
      {error ? <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      {loading && events === null ? <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Loading audit history…</p> : null}
      {events && events.length === 0 && !loading ? <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><ScrollText className="size-4" aria-hidden /> No matching audit events.</p> : null}
      {events && events.length > 0 ? <>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{total.toLocaleString()} events · page {page} of {totalPages}</span>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium"><RefreshCw className="size-3.5" aria-hidden /> Refresh</button>
        </div>
        <ol className="mt-3 divide-y rounded-lg border">
          {events.map((event) => <li key={event.id} className="grid gap-1 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium">{event.action.replaceAll('_', ' ')}</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">{event.targetType} · {event.targetId}</p>
              <p className="mt-1 text-xs text-muted-foreground">By {event.actor}</p>
            </div>
            <time dateTime={event.createdAt} className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</time>
          </li>)}
        </ol>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="h-9 rounded-md border px-3 text-sm disabled:opacity-40">Previous</button>
          <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="h-9 rounded-md border px-3 text-sm disabled:opacity-40">Next</button>
        </div>
      </> : null}
    </div>
  )
}
