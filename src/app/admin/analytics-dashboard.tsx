'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  Eye,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Store,
  UserCheck,
  UserRoundPlus,
  Users,
  Heart,
  ClipboardList,
} from 'lucide-react'

type Metrics = {
  registeredAccounts: number
  signupsToday: number
  signupsLast7Days: number
  signupsLast30Days: number
  shopsCreated: number
  activeListings: number
  listingViews: number
  shopFollows: number
  accountsWithValidSessions: number
  openReports: number
}

const cards: { key: keyof Metrics; label: string; note: string; icon: typeof Users }[] = [
  { key: 'registeredAccounts', label: 'Registered accounts', note: 'Excludes flagged development fixtures; audit test accounts before external reporting', icon: Users },
  { key: 'signupsToday', label: 'Joined today', note: 'Since 00:00 UTC', icon: UserRoundPlus },
  { key: 'signupsLast7Days', label: 'Joined in 7 days', note: 'Rolling seven-day window', icon: UserRoundPlus },
  { key: 'signupsLast30Days', label: 'Joined in 30 days', note: 'Rolling thirty-day window', icon: UserRoundPlus },
  { key: 'shopsCreated', label: 'Shops created', note: 'Shops belonging to genuine accounts', icon: Store },
  { key: 'activeListings', label: 'Active listings', note: 'Published listings currently active', icon: ClipboardList },
  { key: 'listingViews', label: 'Listing views', note: 'Recorded views on active listings', icon: Eye },
  { key: 'shopFollows', label: 'Shop follows', note: 'Buyer-to-shop follows', icon: Heart },
  { key: 'accountsWithValidSessions', label: 'Accounts with valid sessions', note: 'Distinct accounts with unexpired sign-ins; not daily active users', icon: UserCheck },
  { key: 'openReports', label: 'Open reports', note: 'Items awaiting moderation', icon: Activity },
]

export function AdminAnalytics() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/analytics', { cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error ?? 'Could not load platform analytics.')
        setMetrics(null)
        return
      }
      setMetrics(data?.metrics ?? null)
      setGeneratedAt(data?.generatedAt ?? null)
    } catch {
      setError('Connection failed. Please try again.')
      setMetrics(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <section aria-labelledby="platform-analytics-heading" className="mt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="platform-analytics-heading" className="text-base font-semibold">Platform overview</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Aggregate growth and marketplace health. This view does not expose individual accounts or personal activity histories.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="press inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent/50 disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          Refresh
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : null}

      {loading && !metrics ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Loading aggregate metrics…</p>
      ) : metrics ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ key, label, note, icon: Icon }) => (
            <article key={key} className="min-w-0 rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-muted-foreground">{label}</p>
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{metrics[key].toLocaleString()}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{note}</p>
            </article>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" aria-hidden />
        <span>Admin-only · aggregate counts only · no user-level activity tracking in this dashboard</span>
        {generatedAt ? <span>· Updated {new Date(generatedAt).toLocaleString()}</span> : null}
      </div>
    </section>
  )
}
