'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Bell,
  Bookmark,
  ClipboardList,
  Eye,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Store,
  UserCheck,
  UserRoundPlus,
  Users,
  Heart,
  Clock3,
} from 'lucide-react'

type Breakdown = { label: string; count: number }

type Metrics = {
  registeredAccounts: number
  signupsToday: number
  signupsLast7Days: number
  signupsLast30Days: number
  shopsCreated: number
  activeListings: number
  fulfilledListings: number
  expiredListings: number
  archivedListings: number
  hiddenListings: number
  activeOffers: number
  activeRequests: number
  listingViews: number
  shopFollows: number
  accountsWithValidSessions: number
  openReports: number
  listingsExpiringNext24Hours: number
  savedSearches: number
  unreadNotifications: number
  openReportsOlderThan24Hours: number
  activeListingsByCategory: Breakdown[]
  activeListingsByCounty: Breakdown[]
  openReportsByReason: Breakdown[]
  moderationActionsLast7Days: Breakdown[]
}

type CountMetricKey = {
  [K in keyof Metrics]: Metrics[K] extends number ? K : never
}[keyof Metrics]

const overviewCards: { key: CountMetricKey; label: string; note: string; icon: typeof Users }[] = [
  { key: 'registeredAccounts', label: 'Registered accounts', note: 'Genuine accounts; excludes development fixtures', icon: Users },
  { key: 'signupsToday', label: 'Joined today', note: 'Since 00:00 UTC', icon: UserRoundPlus },
  { key: 'signupsLast7Days', label: 'Joined in 7 days', note: 'Rolling seven-day window', icon: UserRoundPlus },
  { key: 'signupsLast30Days', label: 'Joined in 30 days', note: 'Rolling thirty-day window', icon: UserRoundPlus },
  { key: 'shopsCreated', label: 'Shops created', note: 'Genuine business profiles', icon: Store },
  { key: 'activeListings', label: 'Active listings', note: 'Published listings currently active', icon: ClipboardList },
  { key: 'listingViews', label: 'Listing views', note: 'Recorded views on active listings', icon: Eye },
  { key: 'shopFollows', label: 'Shop follows', note: 'Buyer-to-shop follows', icon: Heart },
  { key: 'accountsWithValidSessions', label: 'Accounts with valid sessions', note: 'Not a DAU/MAU figure', icon: UserCheck },
  { key: 'openReports', label: 'Open reports', note: 'Items awaiting moderation', icon: Activity },
]

const marketplaceCards: { key: CountMetricKey; label: string; note: string; icon: typeof Users }[] = [
  { key: 'activeOffers', label: 'Active offers', note: 'Items sellers are offering', icon: Store },
  { key: 'activeRequests', label: 'Active requests', note: 'What buyers are looking for', icon: Users },
  { key: 'fulfilledListings', label: 'Fulfilled', note: 'Listings marked fulfilled', icon: PackageCheck },
  { key: 'expiredListings', label: 'Expired', note: 'Listings past their active lifecycle', icon: Clock3 },
  { key: 'archivedListings', label: 'Archived', note: 'Listings no longer published', icon: ClipboardList },
  { key: 'hiddenListings', label: 'Hidden', note: 'Listings hidden by moderation', icon: ShieldCheck },
  { key: 'listingsExpiringNext24Hours', label: 'Expiring in 24 hours', note: 'Active listings nearing expiry', icon: AlertTriangle },
  { key: 'savedSearches', label: 'Saved searches', note: 'Saved buyer search definitions', icon: Bookmark },
  { key: 'unreadNotifications', label: 'Unread notifications', note: 'Across genuine accounts', icon: Bell },
  { key: 'openReportsOlderThan24Hours', label: 'Reports older than 24h', note: 'Open reports awaiting review', icon: Clock3 },
]

function MetricGrid({ cards, metrics }: {
  cards: { key: CountMetricKey; label: string; note: string; icon: typeof Users }[]
  metrics: Metrics
}) {
  return (
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
  )
}

function BreakdownPanel({ title, description, items, emptyLabel }: {
  title: string
  description: string
  items: Breakdown[]
  emptyLabel: string
}) {
  const max = Math.max(1, ...items.map((item) => item.count))
  return (
    <section className="min-w-0 rounded-lg border bg-card p-4" aria-label={title}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      {items.length ? (
        <ol className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.label}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{item.label}</span>
                <span className="shrink-0 font-medium tabular-nums">{item.count.toLocaleString()}</span>
              </div>
              <div
                className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={`${item.label}: ${item.count}`}
                aria-valuemin={0}
                aria-valuemax={max}
                aria-valuenow={item.count}
              >
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, item.count / max * 100)}%` }} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{emptyLabel}</p>
      )}
    </section>
  )
}

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
            Aggregate growth and marketplace health. Personal account details and individual activity histories are not shown.
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
        <>
          <div className="mt-5">
            <h3 className="text-sm font-semibold">Growth and engagement</h3>
            <MetricGrid cards={overviewCards} metrics={metrics} />
          </div>
          <div className="mt-8">
            <h3 className="text-sm font-semibold">Marketplace pulse</h3>
            <p className="mt-1 text-xs text-muted-foreground">Supply, demand, listing lifecycle, expiry and buyer tools.</p>
            <MetricGrid cards={marketplaceCards} metrics={metrics} />
          </div>
          <div className="mt-8">
            <h3 className="text-sm font-semibold">Marketplace distribution</h3>
            <p className="mt-1 text-xs text-muted-foreground">Category and district/county breakdowns suppress groups with fewer than five active listings.</p>
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <BreakdownPanel title="Active listings by category" description="Top categories with at least five active listings." items={metrics.activeListingsByCategory} emptyLabel="Not enough listings to show category breakdowns yet." />
              <BreakdownPanel title="Active listings by district" description="Top districts/counties with at least five active listings." items={metrics.activeListingsByCounty} emptyLabel="Not enough listings to show location breakdowns yet." />
            </div>
          </div>
          <div className="mt-8">
            <h3 className="text-sm font-semibold">Trust and safety</h3>
            <p className="mt-1 text-xs text-muted-foreground">Moderation trends use counts only; no reporter IPs or personal activity timelines are included.</p>
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <BreakdownPanel title="Open reports by reason" description="Current moderation backlog, grouped by report reason." items={metrics.openReportsByReason} emptyLabel="No open reports." />
              <BreakdownPanel title="Moderation actions in the last 7 days" description="Counts from the moderation audit log; no actor identities are shown." items={metrics.moderationActionsLast7Days.map((item) => ({ ...item, label: ({
                HIDE_LISTING: 'Listings hidden',
                RESTORE_LISTING: 'Listings restored',
                DISMISS_REPORT: 'Reports dismissed',
                AUTO_HIDE_LISTING: 'Automatic hides',
              } as Record<string, string>)[item.label] ?? item.label }))} emptyLabel="No moderation actions recorded in the last 7 days." />
            </div>
          </div>
        </>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" aria-hidden />
        <span>Admin-only · aggregate counts only · small category/location groups are suppressed</span>
        {generatedAt ? <span>· Updated {new Date(generatedAt).toLocaleString()} · source windows are labelled above</span> : null}
      </div>
    </section>
  )
}
