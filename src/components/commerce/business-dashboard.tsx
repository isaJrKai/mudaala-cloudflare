'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BarChart3,
  Camera,
  Eye,
  Package,
  PlusCircle,
  Settings2,
  Store,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiGet, type BusinessProfileT, type Listing } from '@/lib/client'
import { useAppStore } from '@/lib/store'
import { useSession } from '@/hooks/use-session'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from './empty-state'
import { ErrorState } from './listings-browse'
import { BusinessRecordsPanel } from './business-records-panel'
import { BusinessInsightsPanel } from './business-insights-panel'

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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  )
}

export function BusinessDashboard() {
  const { user, isLoading: sessionLoading } = useSession()
  const { navigate, setAuthOpen } = useAppStore()

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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Your workspace</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">My business</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {profile?.businessName?.trim() || user.name}. Keep track of your listings and how people find them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate({ name: 'account' })}>
            <Settings2 className="mr-2 size-4" aria-hidden /> Shop profile
          </Button>
          <Button onClick={() => navigate({ name: 'publish' })}>
            <PlusCircle className="mr-2 size-4" aria-hidden /> Post a product
          </Button>
        </div>
      </header>

      {profileQuery.isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          Your listing data loaded, but shop profile details could not be checked. <Button variant="link" className="h-auto p-0" onClick={() => void profileQuery.refetch()}>Try again</Button>
        </div>
      ) : null}

      <section aria-label="Business overview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active listings" value={String(stats.active)} note="Products or services currently listed" icon={<Package className="size-4" aria-hidden />} />
        <MetricCard label="Listing views" value={stats.views.toLocaleString()} note="Views recorded on your listings" icon={<Eye className="size-4" aria-hidden />} />
        <MetricCard label="Marked fulfilled" value={String(stats.fulfilled)} note="Listings you marked fulfilled, not verified sales" icon={<TrendingUp className="size-4" aria-hidden />} />
        <MetricCard label="Expiring soon" value={String(stats.expiring)} note="Active listings expiring in 7 days" icon={<BarChart3 className="size-4" aria-hidden />} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Products getting attention</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Ranked by recorded listing views. Views show interest, not sales.</p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate({ name: 'my-listings' })}>
              All listings <ArrowRight className="ml-1 size-3.5" aria-hidden />
            </Button>
          </CardHeader>
          <CardContent>
            {popularListings.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center">
                <Package className="mx-auto size-7 text-muted-foreground" aria-hidden />
                <p className="mt-2 text-sm font-medium">Your first product starts here</p>
                <p className="mt-1 text-sm text-muted-foreground">Post a product or service to start building your catalogue.</p>
                <Button className="mt-3" onClick={() => navigate({ name: 'publish' })}>Post a product</Button>
              </div>
            ) : (
              <div className="divide-y">
                {popularListings.map((listing) => (
                  <button
                    key={listing.id}
                    type="button"
                    onClick={() => navigate({ name: 'edit', id: listing.id })}
                    className="flex w-full items-center gap-3 py-3 text-left hover:bg-accent/40"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                      {listing.photos[0] ? <img src={listing.photos[0]} alt="" className="size-full object-cover" /> : <Package className="size-4 text-muted-foreground" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{listing.title}</span>
                      <span className="block text-xs text-muted-foreground">{listing.status === 'ACTIVE' ? 'Active listing' : listing.status.toLowerCase().replace(/_/g, ' ')}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-sm tabular-nums text-muted-foreground"><Eye className="size-3.5" aria-hidden /> {listing.viewCount.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Store className="size-4" aria-hidden /> Your shop</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="font-medium">{profile?.businessName?.trim() || user.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{profile ? 'Your public shop profile' : 'Finish setting up your public shop profile.'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate({ name: 'account' })}>Edit shop details</Button>
                <Button variant="outline" size="sm" onClick={() => navigate({ name: 'shop', id: user.id })}>View public shop</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Camera className="size-4" aria-hidden /> Take photos buyers can trust</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
                <li>Use daylight and a simple background.</li>
                <li>Show the whole item; add a close-up for important details.</li>
                <li>For food and drinks, show the real portion and state the unit, such as per cup, bottle or piece.</li>
                <li>For used items, show wear honestly. Avoid filters that change the product's colour.</li>
              </ul>
              <p className="text-xs text-muted-foreground">When posting, take a photo with your phone or choose one from your gallery. Mudaala resizes photos and removes embedded location metadata before upload.</p>
              <Button variant="outline" size="sm" className="w-full" onClick={() => navigate({ name: 'publish' })}>
                <Camera className="mr-2 size-4" aria-hidden /> Post with a photo
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <BusinessInsightsPanel />

      <BusinessRecordsPanel />

      <p className="text-xs text-muted-foreground">
        These figures come from your current listing records. They are not ad impressions, unique people reached, confirmed orders or profit.
      </p>
    </div>
  )
}
