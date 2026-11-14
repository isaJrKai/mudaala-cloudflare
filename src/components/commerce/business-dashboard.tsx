'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Camera,
  Eye,
  Package,
  PlusCircle,
  Settings2,
  ChevronDown,
  Store,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiGet, apiPost, type BusinessProfileT, type Listing } from '@/lib/client'
import { useAppStore } from '@/lib/store'
import { useSession } from '@/hooks/use-session'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from './empty-state'
import { ErrorState } from './listings-browse'
import { BusinessRecordsPanel } from './business-records-panel'
import { BusinessInsightsPanel } from './business-insights-panel'
import { ProductCollectionsManager } from './product-collections-manager'

function MetricCard({
  label,
  value,
  note,
  icon,
}: {
  label: string
  value: string
  note: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 px-4 py-4 sm:px-5">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums text-foreground">{value}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{note}</p>
      </div>
    </div>
  )
}

export function BusinessDashboard() {
  const { user, isLoading: sessionLoading } = useSession()
  const { navigate, setAuthOpen } = useAppStore()
  const userId = user?.id
  const [moreToolsOpen, setMoreToolsOpen] = useState(false)

  useEffect(() => {
    if (!userId) return
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kampala',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
    const localDay = `${get('year')}-${get('month')}-${get('day')}`
    void apiPost('/api/growth/events', {
      eventType: 'SHOP_OPENED',
      idempotencyKey: `shop-opened:${userId}:${localDay}`,
    }).catch(() => undefined)
  }, [userId])

  const listingsQuery = useQuery({
    queryKey: ['my-listings'],
    enabled: Boolean(user),
    queryFn: () => apiGet<{ listings: Listing[] }>('/api/my/listings'),
    staleTime: 30_000,
  })
  const profileQuery = useQuery({
    queryKey: ['profile'],
    enabled: Boolean(user),
    queryFn: () => apiGet<{ profile: BusinessProfileT | null }>('/api/profile'),
    staleTime: 60_000,
  })

  const listings = listingsQuery.data?.listings ?? []
  const stats = useMemo(() => {
    const now = Date.now()
    const soon = now + 7 * 24 * 60 * 60 * 1000
    return {
      active: listings.filter((item) => item.status === 'ACTIVE').length,
      views: listings.reduce((total, item) => total + Math.max(0, item.viewCount || 0), 0),
      fulfilled: listings.filter((item) => item.status === 'FULFILLED').length,
      expiring: listings.filter((item) =>
        item.status === 'ACTIVE' &&
        new Date(item.expiresAt).getTime() >= now &&
        new Date(item.expiresAt).getTime() <= soon
      ).length,
    }
  }, [listings])

  const popularListings = useMemo(
    () => [...listings]
      .filter((item) => item.status !== 'ARCHIVED' && item.status !== 'HIDDEN')
      .sort((a, b) => b.viewCount - a.viewCount || b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, 5),
    [listings],
  )

  if (sessionLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading your business">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28" />)}
        </div>
        <Skeleton className="h-48" />
      </div>
    )
  }

  if (!user) {
    return (
      <EmptyState
        title="Sign in to manage your business"
        description="Your business dashboard brings your listings and shop activity together in one place."
        action={<Button onClick={() => setAuthOpen(true)}>Sign in</Button>}
      />
    )
  }

  if (listingsQuery.isError) {
    return (
      <ErrorState
        message={listingsQuery.error instanceof Error ? listingsQuery.error.message : 'Could not load your business'}
        onRetry={() => { void listingsQuery.refetch(); void profileQuery.refetch() }}
      />
    )
  }

  if (listingsQuery.isLoading || profileQuery.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading your business">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28" />)}
        </div>
        <Skeleton className="h-48" />
      </div>
    )
  }

  const profile = profileQuery.data?.profile ?? null

  return (
    <div className="space-y-7 sm:space-y-8">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Your workspace</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">My business</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {profile?.businessName?.trim() || user.name}. Manage your shop, keep products current and see where customers show interest.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" className="h-10" onClick={() => navigate({ name: 'shop', id: user.id })}>
            <Store className="mr-2 size-4" aria-hidden /> View shop
          </Button>
          <Button className="mudaala-money-cta h-10" onClick={() => navigate({ name: 'publish' })}>
            <PlusCircle className="mr-2 size-4" aria-hidden /> Add a product
          </Button>
        </div>
      </header>

      {profileQuery.isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
          Your listing data loaded, but shop profile details could not be checked. <Button variant="link" className="h-auto p-0" onClick={() => void profileQuery.refetch()}>Try again</Button>
        </div>
      ) : null}

      <section aria-label="Business overview" className="overflow-hidden rounded-2xl border border-border/80 bg-card">
        <div className="grid divide-y divide-border/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <MetricCard label="Active listings" value={String(stats.active)} note="Products and services currently live" icon={<Package className="size-4" aria-hidden />} />
          <MetricCard label="Listing views" value={stats.views.toLocaleString()} note="Views recorded across your listings" icon={<Eye className="size-4" aria-hidden />} />
          <MetricCard label="Marked fulfilled" value={String(stats.fulfilled)} note="Marked by you, not verified sales" icon={<TrendingUp className="size-4" aria-hidden />} />
        </div>
      </section>

      {stats.expiring > 0 ? (
        <section className="flex flex-col gap-3 rounded-xl border border-amber-300/60 bg-amber-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:bg-amber-950/20" aria-label="Listings needing attention">
          <div>
            <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
              {stats.expiring} {stats.expiring === 1 ? 'listing is' : 'listings are'} expiring within 7 days
            </p>
            <p className="mt-0.5 text-xs text-amber-900/80 dark:text-amber-100/70">Review them and refresh anything you still have available.</p>
          </div>
          <Button variant="outline" size="sm" className="h-9 shrink-0 border-amber-700/30 bg-background/70" onClick={() => navigate({ name: 'my-listings' })}>
            Review products <ArrowRight className="ml-1 size-3.5" aria-hidden />
          </Button>
        </section>
      ) : null}

      <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
        <div className="min-w-0 rounded-2xl border border-border/80 bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Products getting attention</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Sorted by recorded listing views. Views show interest, not sales.</p>
            </div>
            <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => navigate({ name: 'my-listings' })}>
              All products <ArrowRight className="ml-1 size-3.5" aria-hidden />
            </Button>
          </div>
          <div className="px-4 sm:px-5">
            {popularListings.length === 0 ? (
              <div className="py-10 text-center">
                <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-secondary text-primary">
                  <Package className="size-5" aria-hidden />
                </span>
                <p className="mt-3 text-sm font-semibold">Your first product starts here</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">Add a product or service so nearby customers can find your shop.</p>
                <Button className="mudaala-money-cta mt-4" onClick={() => navigate({ name: 'publish' })}>Add your first product</Button>
              </div>
            ) : (
              <div className="divide-y divide-border/70">
                {popularListings.map((listing) => (
                  <button
                    key={listing.id}
                    type="button"
                    onClick={() => navigate({ name: 'edit', id: listing.id })}
                    className="flex w-full items-center gap-3 py-3.5 text-left transition-colors hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary">
                      {listing.photos[0] ? <img src={listing.photos[0]} alt="" loading="lazy" className="size-full object-cover" /> : <Package className="size-4 text-muted-foreground" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{listing.title}</span>
                      <span className="mt-0.5 block text-xs capitalize text-muted-foreground">{listing.status === 'ACTIVE' ? 'Live listing' : listing.status.toLowerCase().replace(/_/g, ' ')}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
                      <Eye className="size-3.5" aria-hidden /> {listing.viewCount.toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Your shop</h2>
              <Store className="size-4 text-primary" aria-hidden />
            </div>
            <p className="mt-3 text-lg font-semibold tracking-tight">{profile?.businessName?.trim() || user.name}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {profile ? 'Your public shop profile is ready to review.' : 'Add your shop details so customers know who they are contacting.'}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button variant="outline" className="w-full" onClick={() => navigate({ name: 'account' })}>
                <Settings2 className="mr-2 size-4" aria-hidden /> Edit shop details
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => navigate({ name: 'shop', id: user.id })}>
                View public shop <ArrowRight className="ml-2 size-4" aria-hidden />
              </Button>
            </div>
          </section>

          <section className="rounded-2xl border border-border/80 bg-secondary/35 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <Camera className="size-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold">Make product photos useful</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Use daylight, show the whole item and photograph real condition. Clear photos help buyers decide whether to contact you.</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Mudaala resizes uploaded photos and removes embedded location metadata.</p>
          </section>
        </aside>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/80 bg-card">
        <button
          type="button"
          aria-expanded={moreToolsOpen}
          onClick={() => setMoreToolsOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-secondary/40 sm:px-5"
        >
          <span>
            <span className="block text-sm font-semibold">More business tools</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">Product collections, deeper insights and business records</span>
          </span>
          <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${moreToolsOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {moreToolsOpen ? (
          <div className="space-y-6 border-t border-border/70 p-4 sm:p-5">
            <ProductCollectionsManager />
            <BusinessInsightsPanel />
            <BusinessRecordsPanel />
          </div>
        ) : null}
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        These figures come from your current listing records. They are not ad impressions, unique people reached, confirmed orders or profit.
      </p>
    </div>
  )
}
