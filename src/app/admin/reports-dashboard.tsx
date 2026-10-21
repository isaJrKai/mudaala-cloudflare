'use client'

// The moderation queue: open reports with their target ad or shop, the
// reason in plain words, the reporter's note - and the three decisions an
// admin can make: HIDE, RESTORE, DISMISS. Every action refreshes the list
// from the server, so the queue is always the truth, never local optimism.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, EyeOff, Loader2, RotateCcw, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { REPORT_REASON_LABELS, type ReportReason } from '@/lib/constants'

interface AdminReport {
  id: string
  targetType: 'LISTING' | 'SHOP'
  targetId: string
  reason: ReportReason
  details: string | null
  status: 'OPEN' | 'ACTIONED' | 'DISMISSED'
  createdAt: string
  violation: { id: string; createdAt: string; reversedAt: string | null; warningSentAt: string | null } | null
  reporter: string
  listing: { id: string; title: string; status: string; type: string; price: number | null; ownerName: string } | null
  shop: { id: string; businessName: string; shopCode: string | null; county: string } | null
}

export function ReportsDashboard() {
  const [reports, setReports] = useState<AdminReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [status, setStatus] = useState<'OPEN' | 'ACTIONED' | 'DISMISSED' | 'ALL'>('OPEN')
  const [violationCategories, setViolationCategories] = useState<Record<string, ReportReason>>({})

  const load = useCallback(async (which: typeof status) => {
    setError(null)
    try {
      const res = await fetch(`/api/admin/reports?status=${which}`)
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? 'Could not load the queue. Please refresh.')
        setReports([])
        return
      }
      setReports(json?.reports ?? [])
    } catch {
      setError('No connection - please refresh.')
    }
  }, [])

  useEffect(() => {
    void load(status)
  }, [load, status])

  async function act(reportId: string, action: 'HIDE' | 'RESTORE' | 'DISMISS' | 'CONFIRM_VIOLATION' | 'REVERSE_VIOLATION', policyCategory?: ReportReason) {
    setBusyId(reportId)
    setError(null)
    try {
      const res = await fetch(`/api/admin/reports/${reportId}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...(policyCategory ? { policyCategory } : {}) }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setError(json?.error ?? 'The action did not go through - please try again.')
      }
    } catch {
      setError('No connection - the action did not go through.')
    } finally {
      setBusyId(null)
      void load(status)
    }
  }

  return (
    <div className="mt-4">
      <div className="flex gap-1.5" role="tablist" aria-label="Report status filter">
        {(['OPEN', 'ACTIONED', 'DISMISSED', 'ALL'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={`press rounded-full border px-3 py-1.5 text-[12.5px] font-medium ${
              status === s ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-accent/50'
            }`}
          >
            {s === 'OPEN' ? 'Open' : s === 'ACTIONED' ? 'Actioned' : s === 'DISMISSED' ? 'Dismissed' : 'All'}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[13px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {reports === null ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading the queue…
        </p>
      ) : reports.length === 0 ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldQuestion className="size-4" aria-hidden /> Nothing here - a quiet queue is a good queue.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {reports.map((r) => (
            <li key={r.id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
                <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
                  {REPORT_REASON_LABELS[r.reason] ?? r.reason}
                </span>
                <span>{r.targetType === 'LISTING' ? 'Ad' : 'Shop'}</span>
                <span>·</span>
                <span>reported by {r.reporter}</span>
                <span>·</span>
                <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time>
                {r.status !== 'OPEN' ? <span className="ml-auto font-medium">{r.status}</span> : null}
              </div>

              {r.listing ? (
                <p className="mt-2 text-[15px] font-medium">
                  <a href={`/l/${r.listing.id}`} className="hover:underline">
                    {r.listing.title}
                  </a>{' '}
                  <span className="text-[12.5px] font-normal text-muted-foreground">
                    - {r.listing.ownerName} · status: {r.listing.status}
                  </span>
                </p>
              ) : r.shop ? (
                <p className="mt-2 text-[15px] font-medium">
                  {r.shop.businessName}
                  {r.shop.shopCode ? <span className="text-[12.5px] font-normal text-muted-foreground"> · {r.shop.shopCode} · {r.shop.county}</span> : null}
                </p>
              ) : (
                <p className="mt-2 text-[13px] text-muted-foreground">(the reported target no longer exists)</p>
              )}

              {r.details ? <p className="mt-1.5 text-[13.5px] leading-snug">"{r.details}"</p> : null}
              {r.violation ? (
                <p className="mt-2 text-xs font-medium text-muted-foreground">
                  {r.violation.reversedAt ? 'Confirmed violation overturned; it no longer counts as a strike.' : 'Moderator-confirmed violation recorded.'}
                  {r.violation.warningSentAt ? ' A formal warning notification was sent.' : ''}
                </p>
              ) : null}

              {r.status === 'OPEN' ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {!r.violation ? (
                    <label className="inline-flex h-9 items-center gap-2 rounded-md border px-2 text-xs font-medium">
                      Confirmed category
                      <select aria-label={`Policy category for report ${r.id}`} value={violationCategories[r.id] ?? r.reason} onChange={(event) => setViolationCategories((previous) => ({ ...previous, [r.id]: event.target.value as ReportReason }))} className="max-w-44 bg-transparent text-xs">
                        {Object.entries(REPORT_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {!r.violation ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Confirm that this report shows a real policy violation? Only a confirmed violation counts as a strike. For listings, this will also hide an active listing.')) void act(r.id, 'CONFIRM_VIOLATION', violationCategories[r.id] ?? r.reason)
                      }}
                      disabled={busyId === r.id}
                      className="press inline-flex h-9 items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-50 px-3 text-[13px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                    >
                      {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="size-3.5" aria-hidden />}
                      Confirm violation
                    </button>
                  ) : null}
                  {r.targetType === 'LISTING' && r.listing?.status !== 'HIDDEN' ? (
                    <button
                      type="button"
                      onClick={() => act(r.id, 'HIDE')}
                      disabled={busyId === r.id}
                      className="press inline-flex h-9 items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 text-[13px] font-medium text-destructive hover:bg-destructive/20 disabled:opacity-60"
                    >
                      {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <EyeOff className="size-3.5" aria-hidden />}
                      Hide
                    </button>
                  ) : null}
                  {r.targetType === 'LISTING' && r.listing?.status === 'HIDDEN' ? (
                    <button
                      type="button"
                      onClick={() => act(r.id, 'RESTORE')}
                      disabled={busyId === r.id}
                      className="press inline-flex h-9 items-center gap-1.5 rounded-md border border-emerald-600/50 bg-emerald-50 px-3 text-[13px] font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                    >
                      {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
                      Restore
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => act(r.id, 'DISMISS')}
                    disabled={busyId === r.id}
                    className="press inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-[13px] font-medium hover:bg-accent/50 disabled:opacity-60"
                  >
                    {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ShieldQuestion className="size-3.5" aria-hidden />}
                    Dismiss
                  </button>
                </div>
              ) : null}
              {r.status === 'ACTIONED' && !r.violation ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 p-3">
                  <label className="inline-flex h-9 items-center gap-2 rounded-md border px-2 text-xs font-medium">
                    Confirmed category
                    <select aria-label={`Policy category for report ${r.id}`} value={violationCategories[r.id] ?? r.reason} onChange={(event) => setViolationCategories((previous) => ({ ...previous, [r.id]: event.target.value as ReportReason }))} className="max-w-44 bg-transparent text-xs">
                      {Object.entries(REPORT_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Confirm that this reviewed report shows a real policy violation? This creates an account strike and may trigger a formal warning.')) void act(r.id, 'CONFIRM_VIOLATION', violationCategories[r.id] ?? r.reason)
                    }}
                    disabled={busyId === r.id}
                    className="press inline-flex h-9 items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-50 px-3 text-[13px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                  >
                    {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="size-3.5" aria-hidden />}
                    Confirm violation
                  </button>
                </div>
              ) : null}
              {r.violation && !r.violation.reversedAt ? (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Overturn this confirmed violation? It will no longer count toward the account warning threshold and the user will be notified.')) void act(r.id, 'REVERSE_VIOLATION')
                    }}
                    disabled={busyId === r.id}
                    className="press inline-flex h-9 items-center gap-1.5 rounded-md border border-emerald-600/50 bg-emerald-50 px-3 text-[13px] font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                  >
                    {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}
                    Overturn violation / appeal accepted
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
