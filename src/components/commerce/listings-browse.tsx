'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, SlidersHorizontal, Bookmark, X, ChevronRight, Hash, Heart, MapPin, Info, Phone, Store } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { apiGet, apiPost } from '@/lib/client'
import type { ListingsPage, ShopLookupResponse, ShopNameSearchResponse, ListingDetail as ListingDetailT, Listing, ListingShopOwner as ListingShopOwnerT, ShopPage as ShopPageT } from '@/lib/client'
import { normalizeShopName, normalizeShopCode, telLink, whatsappLink } from '@/lib/format'
import { haversineMeters, formatDistance } from '@/lib/geo'
import { CATEGORIES, COUNTIES, UNITS, categoryLabel } from '@/lib/constants'
import { getSearchTermGroups, parseSearchIntent } from '@/lib/search'
import { useAppStore, filtersToQuery, DEFAULT_FILTERS } from '@/lib/store'
import { useSession } from '@/hooks/use-session'
import { useCategoryPreferences } from '@/hooks/use-category-preferences'
import { unlove, useLovedIds } from '@/lib/loved'
import { useAddToBasket } from './basket-view'
import { ListingBlock, HeartButton } from './listing-card'
import { ListingGridSkeleton } from './skeletons'
import { EmptyState } from './empty-state'
import { PlaceholderTile } from './placeholder-tile'
import { copy } from '@/lib/copy'
import QRCode from 'react-qr-code'
import { TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { chooseFeaturedShopId, eligibleFeaturedShopIds, FEATURED_SHOP_ROTATION_INTERVAL_MS } from '@/lib/featured-shop-rotation'

// Two shops can legally share a name - when they appear in the SAME feed,
// suffix each with their area so buyers tap the right one. The shop's own
// location wins (profile area → district), falling back to the listing's.
function computeShopLabels(items: ListingsPage['items'] | undefined): Map<string, string> {
  const labels = new Map<string, string>()
  if (!items) return labels

  const ownerIdsByName = new Map<string, Set<string>>()
  for (const listing of items) {
    const owner = listing.user
    const name = owner?.profile?.businessName?.trim() || owner?.name
    if (!owner || !name) continue
    const key = normalizeShopName(name)
    const ids = ownerIdsByName.get(key) ?? new Set<string>()
    ids.add(owner.id)
    ownerIdsByName.set(key, ids)
  }

  for (const listing of items) {
    const owner = listing.user
    const name = owner?.profile?.businessName?.trim() || owner?.name
    if (!owner || !name) continue
    const ids = ownerIdsByName.get(normalizeShopName(name))
    if (!ids || ids.size < 2) continue
    const area = owner.profile?.area || owner.profile?.county || listing.county
    labels.set(listing.id, area ? `${name} · ${area}` : name)
  }
  return labels
}

// "Near me" state machine: idle → locating → on. Denied/unsupported falls
// back to idle with a gentle hint - browsing works fully without location.
type NearMeStatus = 'idle' | 'locating' | 'on' | 'denied'

interface NearMeState {
  status: NearMeStatus
  lat: number | null
  lng: number | null
}

const NEARME_IDLE: NearMeState = { status: 'idle', lat: null, lng: null }

// Browse - the primary user task: find who buys/sells what, nearby.
export function ListingsBrowse() {
  const { filters, setFilters, resetFilters, navigate } = useAppStore()
  const { orderedCategories } = useCategoryPreferences()
  const addToBasket = useAddToBasket()
  const lovedIds = useLovedIds()
  const [lovedOnly, setLovedOnly] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [searchInput, setSearchInput] = useState(filters.q)
  const [loadedItems, setLoadedItems] = useState<ListingsPage['items']>([])
  const [nearMe, setNearMe] = useState<NearMeState>(NEARME_IDLE)
  const nearOn = nearMe.status === 'on' && nearMe.lat !== null && nearMe.lng !== null

  // Debounced search input → store. Typing is a different intent than
  // shortlisting, so it also steps out of Loved mode.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== filters.q) {
        setFilters({ q: searchInput })
        setLovedOnly(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [searchInput, filters.q, setFilters])

  // Location is requested ONLY on this tap - never on app open, so nobody is
  // greeted by a permission wall. Denial keeps the whole feed usable.
  function toggleNearMe() {
    if (nearMe.status === 'locating') return
    if (nearOn) {
      setNearMe(NEARME_IDLE)
      if (filters.sort === 'nearest') setFilters({ sort: 'discovery' })
      return
    }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setNearMe({ status: 'denied', lat: null, lng: null })
      return
    }
    setNearMe({ status: 'locating', lat: null, lng: null })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNearMe({ status: 'on', lat: pos.coords.latitude, lng: pos.coords.longitude })
        setFilters({ sort: 'nearest' })
      },
      () => setNearMe({ status: 'denied', lat: null, lng: null }),
      // Low accuracy is a feature: network positioning is faster and kinder
      // to cheap-phone batteries than GPS, and market-level blur is all the
      // "nearest first" ordering needs.
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    )
  }

  const searchIntent = useMemo(() => parseSearchIntent(filters.q), [filters.q])
  const inferredSearchCategories = useMemo(
    () => [...new Set(getSearchTermGroups(searchIntent.text).flatMap((group) => group.categories))],
    [searchIntent.text],
  )
  const priceIntentHint = searchIntent.minPrice !== undefined && searchIntent.maxPrice !== undefined
    ? `Price range: UGX ${searchIntent.minPrice.toLocaleString('en-UG')} - ${searchIntent.maxPrice.toLocaleString('en-UG')}`
    : searchIntent.maxPrice !== undefined
      ? `Up to UGX ${searchIntent.maxPrice.toLocaleString('en-UG')}`
      : searchIntent.minPrice !== undefined
        ? `From UGX ${searchIntent.minPrice.toLocaleString('en-UG')}`
        : ''
  const priceSortHint = !filters.sortExplicit && (filters.sort === 'newest' || !filters.sort) && searchIntent.sort === 'price_asc'
    ? 'Lowest-priced matches first'
    : !filters.sortExplicit && (filters.sort === 'newest' || !filters.sort) && searchIntent.sort === 'price_desc'
      ? 'Higher-priced matches first'
      : ''

  const query = filtersToQuery(filters)
  // A code-shaped query ("dk 2623", "MD-2623") is a till-number punch, not a
  // text search - canonicalize it and look the shop up directly. Anything
  // else keeps flowing through the normal listing search.
  const codeQuery = useMemo(() => (filters.q ? (normalizeShopCode(filters.q) ?? '') : ''), [filters.q])
  // Buyer coordinates ride on the URL (never persisted anywhere) and are part
  // of the cache key so toggling Near me refetches in the new order.
  const nearParams =
    nearOn && nearMe.lat !== null && nearMe.lng !== null ? `&lat=${nearMe.lat}&lng=${nearMe.lng}` : ''
  const { data, isLoading, isError, error, refetch, isFetching, isPlaceholderData } = useQuery({
    queryKey: ['listings', query, nearParams],
    queryFn: () => apiGet<ListingsPage>(`/api/listings?${query}${nearParams}`),
    // Retry transient transport/edge/server failures, not client errors such as
    // invalid filters or an expired session. This helps cold Browse loads recover
    // without forcing the user to refresh the whole page.
    retry: (failureCount, err) => {
      const status = (err as Error & { status?: number }).status
      return failureCount < 2 && (status === undefined || status === 429 || status >= 500)
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 4000),
    placeholderData: (prev) => prev,
  })

  // Append confirmed pages while ignoring placeholder data from a prior query.
  useEffect(() => {
    if (!data || isPlaceholderData || data.page !== filters.page) return
    setLoadedItems((current) => {
      if (data.page === 1) return data.items
      const seen = new Set(current.map((item) => item.id))
      return [...current, ...data.items.filter((item) => !seen.has(item.id))]
    })
  }, [data, filters.page, isPlaceholderData])

  const codeLookup = useQuery({
    queryKey: ['shop-code', codeQuery],
    queryFn: () => apiGet<ShopLookupResponse>(`/api/shops/lookup?code=${encodeURIComponent(codeQuery)}`),
    enabled: codeQuery !== '',
    // A code either exists or it doesn't - the first honest answer is final.
    retry: false,
  })
  const codeShop = codeQuery !== '' && codeLookup.data ? codeLookup.data.shop : null

  const shopLabels = useMemo(() => computeShopLabels(loadedItems), [loadedItems])

  // Distance chips - computed from the same blurred coords the server used,
  // so the label a buyer reads always matches the order they see.
  const distanceLabels = useMemo(() => {
    const map = new Map<string, string>()
    if (nearMe.lat === null || nearMe.lng === null) return map
    for (const listing of loadedItems) {
      const spot = listing.user?.profile
      if (!spot || spot.lat === null || spot.lng === null) continue
      map.set(listing.id, formatDistance(haversineMeters({ lat: nearMe.lat, lng: nearMe.lng }, { lat: spot.lat, lng: spot.lng })))
    }
    return map
  }, [loadedItems, nearMe.lat, nearMe.lng])

  const activeFilterCount = [
    filters.type !== 'any' ? 1 : 0,
    filters.category !== 'any' ? 1 : 0,
    filters.county !== 'any' ? 1 : 0,
    filters.unit !== 'any' ? 1 : 0,
    filters.minPrice !== '' ? 1 : 0,
    filters.maxPrice !== '' ? 1 : 0,
  ].reduce<number>((a, b) => a + b, 0)

  // Discovery is inserted only into the unfiltered first-page feed. A search
  // or explicit filter stays focused on the results the buyer asked for.
  const showDiscoverySections = !filters.q.trim() && activeFilterCount === 0
  const discoveryShopIds = useMemo(() => {
    const seen = new Set<string>()
    return loadedItems.flatMap((listing) => {
      const id = listing.user?.id
      if (!id || seen.has(id)) return []
      seen.add(id)
      return [id]
    }).slice(0, 8)
  }, [loadedItems])
  const discoveryQuery = useQuery({
    queryKey: ['browse-shop-discovery', discoveryShopIds.join(',')],
    enabled: showDiscoverySections && discoveryShopIds.length > 0,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: () => apiGet<ShopDiscoveryResponse>(`/api/shops/discover?ids=${discoveryShopIds.map(encodeURIComponent).join(',')}`),
  })
  // Reuse the buyer's saved category order to prioritize relevant shop circles.
  const discoveryShops = useMemo(() => {
    const rank = new Map<string, number>()
    orderedCategories.forEach((category, index) => rank.set(category.key, index))
    return [...(discoveryQuery.data?.shops ?? [])].sort(
      (a, b) => (rank.get(a.category ?? '') ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.category ?? '') ?? Number.MAX_SAFE_INTEGER),
    )
  }, [discoveryQuery.data?.shops, orderedCategories])

  const renderListingGrid = (items: ListingsPage['items'], primary = false, cluster = false) => {
    if (items.length === 0) return null
    const clustersByFirstId = new Map<string, ListingsPage['items']>()
    const hiddenIds = new Set<string>()
    if (cluster) {
      const groups = new Map<string, ListingsPage['items']>()
      for (const item of items) {
        const ownerId = item.user?.id
        if (!ownerId) continue
        const key = `${ownerId}::${normalizeShopName(item.title)}`
        const group = groups.get(key) ?? []
        group.push(item)
        groups.set(key, group)
      }
      for (const group of groups.values()) {
        if (group.length < 3) continue
        clustersByFirstId.set(group[0].id, group)
        for (const item of group.slice(1)) hiddenIds.add(item.id)
      }
    }
    return (
      <div data-testid={primary ? 'listing-results-grid' : 'listing-feed-grid'} className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        {items.map((listing) => {
          if (hiddenIds.has(listing.id)) return null
          const clusterItems = clustersByFirstId.get(listing.id)
          return clusterItems ? (
            <ShopClusterCard key={listing.id} items={clusterItems} onOpenShop={(shopId) => navigate({ name: 'shop', id: shopId })} />
          ) : (
            <ListingBlock
              key={listing.id}
              listing={listing}
              shopLabel={shopLabels.get(listing.id)}
              distanceLabel={distanceLabels.get(listing.id)}
              onOpen={(id) => navigate({ name: 'listing', id })}
              onOpenShop={(shopId) => navigate({ name: 'shop', id: shopId })}
              onAdd={addToBasket}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            placeholder="Search products, shops, and things near you"
            className="min-w-0 pl-9 text-xs sm:text-sm"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label={copy.browse.searchLabel}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowFilters(true)}
          className="shrink-0 gap-1.5 px-3"
          aria-label={copy.browse.openFiltersAria}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          <span className="hidden sm:inline">{copy.browse.filters}</span>
          {activeFilterCount > 0 ? (
            <span className="flex size-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>
      </div>

      {filters.q.trim() && (inferredSearchCategories.length > 0 || priceIntentHint || priceSortHint) ? (
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {inferredSearchCategories.length > 0
            ? `Also matching ${inferredSearchCategories.map(categoryLabel).join(', ')} products`
            : 'Search filters applied'}
          {priceIntentHint ? ` · ${priceIntentHint}` : ''}
          {priceSortHint ? ` · ${priceSortHint}` : ''}
        </p>
      ) : null}

      {/* Category shortcuts use the canonical category registry and preserve the full filter dialog. */}
      <nav aria-label="Browse categories" className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1 scrollbar-slim">
        <button type="button" onClick={() => setFilters({ category: 'any', page: 1 })} aria-pressed={filters.category === 'any'} className={cn('press min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors', filters.category === 'any' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-secondary')}>
          All
        </button>
        {orderedCategories.map((category) => (
          <button key={category.key} type="button" onClick={() => setFilters({ category: category.key, page: 1 })} aria-pressed={filters.category === category.key} className={cn('press min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors', filters.category === category.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-secondary')}>
            {category.label}
          </button>
        ))}
      </nav>

      {/* Active filter chips + sort */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-slim pb-0.5">
        <Select value={filters.sort} onValueChange={(v) => setFilters({ sort: v as typeof filters.sort })}>
          <SelectTrigger size="sm" className="shrink-0 border-dashed text-muted-foreground" aria-label={copy.browse.sortLabel}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="discovery">Discover</SelectItem>
            <SelectItem value="newest">{copy.browse.sortNewest}</SelectItem>
            {nearOn ? <SelectItem value="nearest">{copy.browse.sortNearest}</SelectItem> : null}
            <SelectItem value="price_asc">{copy.browse.sortPriceAsc}</SelectItem>
            <SelectItem value="price_desc">{copy.browse.sortPriceDesc}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant={nearOn ? 'default' : 'outline'}
          className="shrink-0 gap-1.5"
          onClick={toggleNearMe}
          disabled={nearMe.status === 'locating'}
          aria-pressed={nearOn}
        >
          <MapPin className="size-3.5" aria-hidden />
          {nearMe.status === 'locating' ? copy.browse.nearMeLocating : copy.browse.nearMe}
        </Button>
        <SaveSearchButton />
        {/* Loved - the buyer's shortlist. Same family as Near me: an explicit
            mode chip, count visible at a glance, pressed state unambiguous. */}
        <Button
          type="button"
          size="sm"
          variant={lovedOnly ? 'default' : 'outline'}
          className="shrink-0 gap-1.5"
          onClick={() => setLovedOnly((v) => !v)}
          aria-pressed={lovedOnly}
          aria-label={lovedOnly ? copy.browse.lovedAriaOn : copy.browse.lovedAriaOff(lovedIds.length)}
        >
          <Heart className={cn('size-3.5', lovedOnly && 'fill-current')} aria-hidden />
          {copy.browse.loved}
          {lovedIds.length > 0 ? (
            <span
              className={cn(
                'flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                lovedOnly ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/10 text-primary',
              )}
            >
              {lovedIds.length}
            </span>
          ) : null}
        </Button>
        {activeFilterCount > 0 ? (
          <Button type="button" variant="ghost" size="sm" className="shrink-0 gap-1 text-muted-foreground" onClick={resetFilters}>
            <X className="size-3.5" aria-hidden /> {copy.common.clearAll}
          </Button>
        ) : null}
      </div>

      {nearMe.status === 'denied' ? (
        <p
          role="status"
          className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Location is off. Allow it when the browser asks and shops closest to you come first. You can still browse everything.</span>
        </p>
      ) : null}

      <FilterDialog open={showFilters} onOpenChange={setShowFilters} />

      {!lovedOnly && codeQuery === '' ? (
        <ShopNameSearchResults query={filters.q} onOpenShop={(shopId) => navigate({ name: 'shop', id: shopId })} />
      ) : null}

      {/* Loved mode replaces the whole feed - the buyer asked for their
          shortlist, not the market. Explicit intent wins over every other
          mode (search, filters, code punch all wait their turn). */}
      {lovedOnly ? (
        <LovedShelf
          onOpen={(id) => navigate({ name: 'listing', id })}
          onOpenShop={(shopId) => navigate({ name: 'shop', id: shopId })}
          onAdd={addToBasket}
          onBrowse={() => setLovedOnly(false)}
        />
      ) : codeQuery !== '' ? (
        codeLookup.isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">
            {copy.browse.codeFinding(codeQuery)}
          </p>
        ) : codeLookup.isError ? (
          <p
            role="status"
            className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20"
          >
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {codeLookup.error instanceof Error
                ? codeLookup.error.message
                : copy.browse.codeError}
            </span>
          </p>
        ) : codeShop ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground" role="status">
              {copy.browse.codeShopLabel(codeQuery)}
            </p>
            <ShopCodeCard shop={codeShop} onOpen={() => navigate({ name: 'shop', id: codeShop.id })} />
          </div>
        ) : null
      ) : isLoading ? (
        <ListingGridSkeleton />
      ) : isError ? (
        <ErrorState
          message={error instanceof Error ? error.message : 'Could not load listings'}
          onRetry={() => refetch()}
        />
      ) : data && data.items.length === 0 ? (
        <EmptyState
          title={activeFilterCount > 0 || filters.q ? copy.browse.emptyFilteredTitle : copy.browse.emptyTitle}
          description={
            activeFilterCount > 0 || filters.q ? copy.browse.emptyFilteredSub : copy.browse.emptySub
          }
          action={
            activeFilterCount > 0 || filters.q ? (
              <Button variant="outline" onClick={resetFilters}>
                {copy.browse.clearSearchFilters}
              </Button>
            ) : (
              <Button onClick={() => navigate({ name: 'publish' })}>{copy.common.postAnAd}</Button>
            )
          }
        />
      ) : data ? (
        <div className="space-y-4">
          {showDiscoverySections ? (
            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(220px,1fr)]">
              <FeaturedShopPanel items={loadedItems} />
              <BrowseActionTiles onSell={() => navigate({ name: 'publish' })} />
            </div>
          ) : null}
          <div className={isFetching ? 'space-y-3 opacity-60 transition-opacity' : 'space-y-3'}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="text-xl font-bold leading-tight tracking-tight">
                {filters.q.trim() || activeFilterCount > 0 ? 'Products' : 'Products near you'}
              </h1>
              <p className="text-xs text-muted-foreground" role="status">
                {copy.browse.resultsFound(data.total, data.pageCount > 1 ? { page: data.page, pageCount: data.pageCount } : undefined)}
              </p>
            </div>
            {showDiscoverySections ? (
              <>
                <ExploreShopsSection
                  shops={discoveryShops}
                  loading={discoveryQuery.isLoading}
                  onOpenShop={(shopId) => navigate({ name: 'shop', id: shopId })}
                />
                <SpecialOffersSection
                  items={loadedItems.filter((item) => item.type === 'OFFER' && item.compareAtPrice !== null && item.price !== null && item.compareAtPrice > item.price)}
                  shopLabels={shopLabels}
                  distanceLabels={distanceLabels}
                  onOpen={(id) => navigate({ name: 'listing', id })}
                  onOpenShop={(shopId) => navigate({ name: 'shop', id: shopId })}
                  onAdd={addToBasket}
                />
                <CategoryDiscoveryRows
                  items={loadedItems.filter((item) => item.type === 'OFFER')}
                  onSeeAll={(category) => setFilters({ category, type: 'OFFER', page: 1 })}
                  onOpen={(id) => navigate({ name: 'listing', id })}
                  onOpenShop={(shopId) => navigate({ name: 'shop', id: shopId })}
                  onAdd={addToBasket}
                />
                <ExploreShowroomsSection
                  shops={discoveryQuery.data?.shops ?? []}
                  onOpenShop={(shopId) => navigate({ name: 'shop', id: shopId })}
                />
                <BuyersAskingSection
                  items={loadedItems.filter((item) => item.type === 'REQUEST')}
                  onPostRequest={() => navigate({ name: 'publish', id: 'request' })}
                />
                <section className="space-y-2" aria-label="Latest listings">
                  <h2 className="text-base font-semibold">Latest listings</h2>
                  {renderListingGrid(loadedItems.filter((item) => item.type === 'OFFER'), true, true)}
                </section>
              </>
            ) : (
              renderListingGrid(loadedItems, true)
            )}

            {data.page < data.pageCount ? (
              <Pagination loading={isFetching} onLoadMore={() => setFilters({ page: data.page + 1 })} />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

type ShopDiscoveryResponse = {
  shops: Array<{
    id: string
    name: string
    photoUrl: string | null
    category: string | null
    area: string | null
    county: string | null
    showroomItems: ShopPageT['showroomItems']
  }>
}

function shopCategoryLabel(category: string | null): string {
  if (!category) return 'Local shop'
  const labels: Record<string, string> = {
    'textiles-clothing': 'Fashion & shoes',
    electronics: 'Electronics',
    'beauty-personal-care': 'Beauty',
    'home-kitchen': 'Home & living',
    'household-essentials': 'Home essentials',
    'hardware-building': 'Hardware',
    'food-groceries': 'Food & groceries',
  }
  return labels[category] ?? categoryLabel(category)
}

function ShopClusterCard({
  items,
  onOpenShop,
}: {
  items: ListingsPage['items']
  onOpenShop: (shopId: string) => void
}) {
  const first = items[0]
  const shop = first?.user
  if (!first || !shop) return null
  const name = shop.profile?.businessName?.trim() || shop.name
  return (
    <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card p-2.5">
      <div className="grid grid-cols-2 gap-1.5">
        {items.slice(0, 4).map((item) => (
          <div key={item.id} className="aspect-square overflow-hidden rounded-md bg-secondary">
            {item.photos[0] ? <img src={item.photos[0]} alt="" loading="lazy" className="size-full object-cover" /> : <PlaceholderTile category={item.category} className="size-full" />}
          </div>
        ))}
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-semibold">{first.title}</h3>
      <p className="mt-1 truncate text-xs text-muted-foreground">{name}</p>
      <button type="button" onClick={() => onOpenShop(shop.id)} className="press mt-auto flex min-h-11 items-center justify-center rounded-lg border border-primary/30 px-2 text-xs font-semibold text-primary hover:bg-secondary">
        View all {items.length}
      </button>
    </article>
  )
}

function BrowseActionTiles({ onSell }: { onSell: () => void }) {
  return (
    <section className="grid grid-cols-2 gap-2" aria-label="Browse actions">
      <a href="#special-offers" className="press flex min-h-20 flex-col justify-between rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-left text-amber-950 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-800">Deals</span>
        <span className="text-sm font-bold">Shop marked-down prices →</span>
      </a>
      <button type="button" onClick={onSell} className="press flex min-h-20 flex-col justify-between rounded-xl border border-border bg-card p-3 text-left hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Have something to sell?</span>
        <span className="text-sm font-bold text-primary">Sell on Mudaala →</span>
      </button>
    </section>
  )
}

function CategoryDiscoveryRows({
  items,
  onSeeAll,
  onOpen,
  onOpenShop,
  onAdd,
}: {
  items: ListingsPage['items']
  onSeeAll: (category: string) => void
  onOpen: (id: string) => void
  onOpenShop: (shopId: string) => void
  onAdd: (listing: Listing & { user?: ListingShopOwnerT }) => boolean | void
}) {
  const groups = new Map<string, ListingsPage['items']>()
  for (const item of items) {
    const group = groups.get(item.category) ?? []
    if (group.length < 4) group.push(item)
    groups.set(item.category, group)
  }
  const rows = [...groups.entries()].filter(([, group]) => group.length > 0).slice(0, 3)
  if (rows.length === 0) return null
  return (
    <div className="space-y-4">
      {rows.map(([category, group]) => (
        <section key={category} className="min-w-0 space-y-2" aria-label={categoryLabel(category)}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{categoryLabel(category)}</h2>
            <button type="button" onClick={() => onSeeAll(category)} className="min-h-11 shrink-0 px-2 text-xs font-semibold text-primary underline underline-offset-4">See all</button>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
            {group.map((listing) => (
              <ListingBlock key={listing.id} listing={listing} onOpen={onOpen} onOpenShop={onOpenShop} onAdd={onAdd} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function BuyersAskingSection({
  items,
  onPostRequest,
}: {
  items: ListingsPage['items']
  onPostRequest: () => void
}) {
  if (items.length === 0) return null
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-3" aria-labelledby="buyers-asking-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="buyers-asking-heading" className="text-base font-semibold">Buyers are asking</h2>
          <p className="text-xs text-muted-foreground">Have what someone needs? Contact the buyer directly.</p>
        </div>
        <button type="button" onClick={onPostRequest} className="min-h-11 shrink-0 rounded-lg border px-3 text-xs font-semibold hover:bg-secondary">Post a request</button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.slice(0, 4).map((item) => (
          <article key={item.id} className="flex min-w-0 items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-2 text-sm font-semibold">{item.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{[item.area, item.county].filter(Boolean).join(', ') || 'Location not specified'}</p>
              <p className="mt-1 text-sm font-bold text-foreground">{item.price === null ? 'Budget not specified' : `Budget USh ${Math.round(item.price).toLocaleString('en-UG')}`}</p>
            </div>
            <a
              href={item.contactWhatsapp ? whatsappLink(item.contactWhatsapp, item.title, item.type) : telLink(item.contactPhone)}
              target={item.contactWhatsapp ? '_blank' : undefined}
              rel={item.contactWhatsapp ? 'noopener noreferrer' : undefined}
              className="press inline-flex min-h-11 shrink-0 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
            >
              I have this
            </a>
          </article>
        ))}
      </div>
    </section>
  )
}

function ExploreShopsSection({
  shops,
  loading,
  onOpenShop,
}: {
  shops: ShopDiscoveryResponse['shops']
  loading: boolean
  onOpenShop: (shopId: string) => void
}) {
  if (shops.length === 0 && !loading) return null
  return (
    <section className="min-w-0 space-y-3 py-1" aria-labelledby="explore-shops-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="explore-shops-heading" className="text-base font-semibold tracking-tight">Explore shops</h2>
        <span className="text-xs text-muted-foreground">Meet local sellers</span>
      </div>
      {shops.length > 0 ? (
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4" role="list" aria-label="Shops on Mudaala">
          {shops.map((shop) => (
            <button key={shop.id} type="button" role="listitem" onClick={() => onOpenShop(shop.id)} className="press relative flex min-h-36 min-w-0 flex-col items-start overflow-hidden rounded-xl border border-border bg-card px-3 pb-3 pt-8 text-left hover:border-primary/50 hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Visit ${shop.name}`}>
              <span className="absolute inset-x-0 top-0 h-9 bg-secondary" aria-hidden />
              {shop.photoUrl ? <img src={shop.photoUrl} alt="" loading="lazy" className="relative -mt-1 size-12 shrink-0 rounded-full border-2 border-card bg-card object-cover" /> : <span className="relative -mt-1 flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-card bg-secondary text-base font-bold text-primary">{shop.name.charAt(0).toUpperCase()}</span>}
              <span className="mt-2 block w-full min-w-0"><span className="block line-clamp-2 break-words text-sm font-semibold">{shop.name}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{shopCategoryLabel(shop.category)}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{[shop.area, shop.county].filter(Boolean).join(', ') || 'Mudaala shop'}</span><span className="mt-2 block text-xs font-semibold text-primary">Visit shop →</span></span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-hidden" aria-hidden>
          {[0, 1, 2, 3, 4].map((key) => <span key={key} className="size-16 shrink-0 animate-pulse rounded-full bg-muted" />)}
        </div>
      )}
    </section>
  )
}

function ExploreShowroomsSection({
  shops,
  onOpenShop,
}: {
  shops: ShopDiscoveryResponse['shops']
  onOpenShop: (shopId: string) => void
}) {
  const entries = shops.flatMap((shop) =>
    shop.showroomItems.slice(0, 2).map((item) => ({ shop, item })),
  ).slice(0, 8)
  if (entries.length === 0) return null

  return (
    <section className="min-w-0 space-y-3 py-1" aria-labelledby="explore-showrooms-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="explore-showrooms-heading" className="text-base font-semibold tracking-tight">Explore showrooms</h2>
        <span className="text-xs text-muted-foreground">More from local shops</span>
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 scrollbar-slim">
        {entries.map(({ shop, item }) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpenShop(shop.id)}
            className="press w-40 shrink-0 overflow-hidden rounded-lg border bg-card text-left hover:border-primary/40"
            aria-label={`View ${item.title} in ${shop.name}'s showroom`}
          >
            {item.photoUrl ? (
              <img src={item.photoUrl} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
            ) : (
              <span className="flex aspect-[4/3] w-full items-center justify-center bg-secondary text-primary">
                <Store className="size-7" aria-hidden />
              </span>
            )}
            <span className="block space-y-1 p-2.5">
              <span className="block truncate text-xs font-semibold">{item.title}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{shop.name}</span>
              <span className="block text-xs font-semibold text-primary">
                {item.price === null ? 'Ask for price' : `UGX ${Math.round(item.price).toLocaleString('en-UG')}`}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function SpecialOffersSection({
  items,
  shopLabels,
  distanceLabels,
  onOpen,
  onOpenShop,
  onAdd,
}: {
  items: ListingsPage['items']
  shopLabels: Map<string, string>
  distanceLabels: Map<string, string>
  onOpen: (id: string) => void
  onOpenShop: (shopId: string) => void
  onAdd: (listing: Listing & { user?: ListingShopOwnerT }) => boolean | void
}) {
  return (
    <section id="special-offers" className="min-w-0 space-y-3 py-1" aria-labelledby="special-offers-heading">
      <h2 id="special-offers-heading" className="text-base font-semibold tracking-tight">Hot deals</h2>
      {items.length > 0 ? (
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
          {items.slice(0, 6).map((listing) => (
            <ListingBlock
              key={listing.id}
              listing={listing}
              shopLabel={shopLabels.get(listing.id)}
              distanceLabel={distanceLabels.get(listing.id)}
              onOpen={onOpen}
              onOpenShop={onOpenShop}
              onAdd={onAdd}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">No discounted listings are available in this feed right now.</p>
      )}
    </section>
  )
}

// Shop names are searched independently from product listings. This means a
// customer can reach a known shop even when its current catalogue is empty or
// its listing titles do not contain the shop's name.
function ShopNameSearchResults({ query, onOpenShop }: { query: string; onOpenShop: (shopId: string) => void }) {
  const q = query.trim()
  const search = useQuery({
    queryKey: ['shop-name-search', q.toLocaleLowerCase()],
    enabled: q.length >= 2,
    staleTime: 30_000,
    retry: false,
    queryFn: () => apiGet<ShopNameSearchResponse>(`/api/shops/search?q=${encodeURIComponent(q)}`),
  })
  if (q.length < 2) return null

  if (search.isError) {
    return (
      <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        Shop-name search is temporarily unavailable; product results are still shown.
        <button type="button" className="font-semibold text-primary underline underline-offset-2" onClick={() => void search.refetch()}>
          Try again
        </button>
      </p>
    )
  }

  if (search.isLoading || !search.data) return null
  if (search.data.shops.length === 0) {
    return <p className="text-xs text-muted-foreground" role="status">No shop names matched “{q}”. Product matches, if any, appear below.</p>
  }

  return (
    <section className="space-y-2" aria-label="Shops matching your search">
      <h2 className="text-sm font-semibold text-foreground">Shops matching “{q}”</h2>
      <div className="divide-y rounded-lg border bg-card">
        {search.data.shops.map((shop) => (
          <button
            key={shop.id}
            type="button"
            onClick={() => onOpenShop(shop.id)}
            className="press flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            aria-label={`Open shop ${shop.name}`}
          >
            {shop.photoUrl ? (
              <img src={shop.photoUrl} alt="" loading="lazy" className="size-11 shrink-0 rounded-md border object-cover" />
            ) : (
              <span className="flex size-11 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
                <Store className="size-5" aria-hidden />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{shop.name}</span>
              {shop.area || shop.county ? (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{[shop.area, shop.county].filter(Boolean).join(', ')}</span>
              ) : (
                <span className="mt-0.5 block text-xs text-muted-foreground">Shop on Mudaala</span>
              )}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        ))}
      </div>
    </section>
  )
}

// The featured shop rotates daily among distinct shops represented in the
// current public results. A shared day bucket keeps the choice stable across
// refreshes without paid placement or user-level tracking.
function subscribeToFeaturedShopRotation(onStoreChange: () => void) {
  const timer = window.setInterval(onStoreChange, 60_000)
  return () => window.clearInterval(timer)
}

function FeaturedShopPanel({ items }: { items: ListingsPage['items'] }) {
  // Same hydration-safe origin pattern as shop-view: '' during SSR, the real
  // origin after mount (a page's origin never changes while it is open).
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => '',
  )
  // Use a server snapshot of zero to keep SSR and the first hydration render
  // identical; after hydration the client advances to the current time bucket.
  const rotationBucket = useSyncExternalStore(
    subscribeToFeaturedShopRotation,
    () => Math.floor(Date.now() / FEATURED_SHOP_ROTATION_INTERVAL_MS),
    () => 0,
  )
  const eligibleShopIds = useMemo(() => eligibleFeaturedShopIds(items), [items])
  const shopId = chooseFeaturedShopId(eligibleShopIds, rotationBucket)
  const shopQuery = useQuery({
    queryKey: ['featured-shop', shopId],
    enabled: Boolean(shopId),
    staleTime: 60_000,
    retry: 1,
    queryFn: () => apiGet<ShopPageT>(`/api/shops/${shopId}`),
  })
  const shop = shopQuery.data?.shop ?? null
  const shopListings = shopQuery.data?.listings ?? []
  const shopUrl = useMemo(
    () => (origin && shop ? `${origin}/#/shop/${shop.id}` : ''),
    [origin, shop],
  )

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-primary bg-primary text-primary-foreground" aria-label="Shop of the day">
      {shop ? (
        <>
          {shop.photoUrl ? (
            <img src={shop.photoUrl} alt="" loading="lazy" className="h-28 w-full object-cover sm:h-36" />
          ) : (
            <PlaceholderTile title={shop.name} label={copy.shop.coverTileAria(shop.name)} className="h-28 w-full sm:h-36" />
          )}
          <div className="p-4">
            <p className="text-xs font-semibold text-primary-foreground/75">{copy.browse.featuredShop}</p>
            <h2 className="mt-1 font-display text-lg font-semibold leading-tight tracking-tight text-primary-foreground">
              {shop.name}
            </h2>
            {shop.area || shop.county ? (
              <p className="mt-0.5 text-xs text-primary-foreground/75">{[shop.area, shop.county].filter(Boolean).join(', ')}</p>
            ) : null}
            {shopListings.length > 0 ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {shopListings.slice(0, 3).map((listing) => (
                  <div key={listing.id} className="min-w-0 overflow-hidden rounded-md border border-primary-foreground/20 bg-primary-foreground/10">
                    {listing.photos[0] ? <img src={listing.photos[0]} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" /> : <div className="aspect-[4/3] bg-muted" />}
                    <p className="line-clamp-2 p-1.5 text-[11px] font-medium text-primary-foreground">{listing.title}</p>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-3 flex items-center gap-3">
              <div className="shrink-0 rounded-md bg-white p-1.5">
                {shopUrl ? <QRCode value={shopUrl} size={64} role="img" aria-label={`QR code for ${shop.name}'s shop`} /> : null}
              </div>
              <div className="min-w-0">
                {shop.shopCode ? (
                  <p className="text-sm font-bold tracking-widest text-primary-foreground tabular-nums">{shop.shopCode}</p>
                ) : null}
                <p className="text-[11px] leading-snug text-primary-foreground/75">{copy.browse.featuredCodeHint}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a href={shopUrl || `/#/shop/${shop.id}`} className="press flex min-h-11 items-center justify-center rounded-md bg-amber-400 px-3 text-sm font-bold text-amber-950 hover:bg-amber-300">Visit shop</a>
              <a href={telLink(shop.phone)} className="press flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-primary-foreground/40 px-3 text-sm font-semibold text-primary-foreground hover:bg-primary-foreground/10">
                <Phone className="size-4" aria-hidden /> {copy.common.call}
              </a>
            </div>
          </div>
        </>
      ) : shopId && shopQuery.isLoading ? (
        <div className="h-64 animate-pulse rounded-lg border bg-muted/40" role="status" aria-label="Loading featured shop" />
      ) : shopId && shopQuery.isError ? (
        <div className="rounded-lg border bg-card p-4" role="status">
          <p className="text-sm font-medium">{copy.browse.featuredShop}</p>
          <p className="mt-1 text-sm text-muted-foreground">This shop could not be loaded just now.</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => { void shopQuery.refetch() }}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-medium">{copy.browse.featuredShop}</p>
          <p className="mt-1 text-sm text-muted-foreground">No eligible shop appears in these results yet.</p>
        </div>
      )}
    </section>
  )
}

// The Loved shelf - the shortlist, rendered as the same photo-first blocks
// as the feed. Every item is re-fetched from the public API when the shelf
// opens (the heart stores only an id), so what the buyer sees is what is
// really there right now: sold-out items say so instead of pretending.
function LovedShelf({
  onOpen,
  onOpenShop,
  onAdd,
  onBrowse,
}: {
  onOpen: (id: string) => void
  onOpenShop: (shopId: string) => void
  // Same shape ListingBlock hands every caller - blocks may come back from
  // the public detail endpoint, but the add contract stays the wide one.
  onAdd: (listing: Listing & { user?: ListingShopOwnerT }) => boolean | void
  onBrowse: () => void
}) {
  const lovedIds = useLovedIds()

  const itemsQuery = useQuery({
    queryKey: ['loved-items', lovedIds.join(',')],
    enabled: lovedIds.length > 0,
    retry: false,
    staleTime: 15_000,
    queryFn: async () => {
      const results = await Promise.all(
        lovedIds.map(async (id) => {
          try {
            const res = await apiGet<{ listing: ListingDetailT }>(`/api/listings/${id}`)
            return res.listing
          } catch (err) {
            // A 404 means the seller deleted it - a heart on a ghost is
            // clutter that also eats a shortlist slot, so it unloves itself.
            if (err instanceof Error && /404|does not exist|removed/i.test(err.message)) {
              unlove(id)
              return null
            }
            throw err
          }
        }),
      )
      return results.filter((l): l is ListingDetailT => l !== null)
    },
  })

  if (lovedIds.length === 0) {
    return (
      <EmptyState
        title={copy.browse.lovedEmptyTitle}
        description={copy.browse.lovedEmptySub}
        action={<Button onClick={onBrowse}>{copy.common.browseListings}</Button>}
      />
    )
  }

  if (itemsQuery.isLoading) {
    return <ListingGridSkeleton />
  }

  if (itemsQuery.isError || !itemsQuery.data) {
    return <ErrorState message="Could not load your loved items" onRetry={() => itemsQuery.refetch()} />
  }

  const items = itemsQuery.data
  const available = items.filter((l) => l.status === 'ACTIVE')
  const unavailable = items.filter((l) => l.status !== 'ACTIVE')

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground" role="status">
        {copy.browse.lovedShelfCount(items.length)}
      </p>

      {available.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
          {available.map((listing) => (
            <ListingBlock
              key={listing.id}
              listing={listing}
              onOpen={onOpen}
              onOpenShop={onOpenShop}
              onAdd={onAdd}
            />
          ))}
        </div>
      ) : null}

      {/* Honest shelf: what expired or sold out is said out loud, with the
          one action that fixes it. */}
      {unavailable.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3">
          <p className="flex items-start gap-1.5 text-xs font-medium text-amber-800">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {unavailable.length === 1
              ? copy.browse.lovedUnavailable(1)
              : copy.browse.lovedUnavailable(unavailable.length)}
          </p>
          <ul className="mt-1.5 space-y-1">
            {unavailable.map((listing) => (
              <li key={listing.id} className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => onOpen(listing.id)}
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                >
                  {listing.title}
                </button>
                <HeartButton listingId={listing.id} title={listing.title} className="size-7 shrink-0 border-0 bg-transparent hover:bg-transparent" />
                <span className="shrink-0 text-xs text-amber-800">{copy.browse.lovedForget}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

// The result of punching a MD code into search - one shop, whole card taps
// through, same affordance as a listing card. The code chip repeats so the
// buyer can confirm the number they typed matches the shop they got.
function ShopCodeCard({ shop, onOpen }: { shop: ShopLookupResponse['shop']; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent/40"
      aria-label={`Open shop: ${shop.name}`}
    >
      {shop.photoUrl ? (
        <img src={shop.photoUrl} alt="" className="size-14 shrink-0 rounded-lg border object-cover" />
      ) : (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-lg border bg-accent text-xl font-bold text-accent-foreground">
          {shop.name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{shop.name}</span>
        <span className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          {[shop.area, shop.county].filter(Boolean).join(', ') || 'Shop on Mudaala'}
        </span>
        <span className="mt-1.5 inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20">
          <Hash className="size-3" aria-hidden /> <span className="tracking-wide tabular-nums">{shop.shopCode}</span>
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}

function Pagination({ loading, onLoadMore }: { loading: boolean; onLoadMore: () => void }) {
  return (
    <div className="flex justify-center pt-2">
      <Button type="button" variant="outline" size="lg" className="min-h-11 min-w-48" disabled={loading} onClick={onLoadMore}>
        {loading ? 'Loading…' : 'Load more listings'}
        {!loading ? <ChevronRight className="size-4" aria-hidden /> : null}
      </Button>
    </div>
  )
}

function FilterDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { filters, setFilters } = useAppStore()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.browse.filterHeading}</DialogTitle>
          <DialogDescription>{copy.browse.filterSub}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{copy.browse.type}</Label>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Listing type">
              {(['any', 'OFFER', 'REQUEST'] as const).map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant={filters.type === t ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilters({ type: t })}
                  aria-pressed={filters.type === t}
                >
                  {t === 'any' ? copy.common.all : t}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="f-category">{copy.browse.category}</Label>
            <Select value={filters.category} onValueChange={(v) => setFilters({ category: v })}>
              <SelectTrigger id="f-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="any">{copy.common.anyCategory}</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="f-county">{copy.browse.district}</Label>
            <Select value={filters.county} onValueChange={(v) => setFilters({ county: v })}>
              <SelectTrigger id="f-county">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="any">{copy.common.anyDistrict}</SelectItem>
                {COUNTIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="f-min">{copy.browse.minPrice}</Label>
              <Input
                id="f-min"
                type="number"
                inputMode="numeric"
                min={0}
                value={filters.minPrice}
                onChange={(e) => setFilters({ minPrice: e.target.value })}
                placeholder="Any"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-max">{copy.browse.maxPrice}</Label>
              <Input
                id="f-max"
                type="number"
                inputMode="numeric"
                min={0}
                value={filters.maxPrice}
                onChange={(e) => setFilters({ maxPrice: e.target.value })}
                placeholder="Any"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="f-unit">{copy.browse.priceUnit}</Label>
            <Select value={filters.unit} onValueChange={(v) => setFilters({ unit: v })}>
              <SelectTrigger id="f-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{copy.common.anyUnit}</SelectItem>
                {UNITS.map((u) => (
                  <SelectItem key={u.key} value={u.key}>
                    per {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setFilters({ ...DEFAULT_FILTERS, q: filters.q, sort: filters.sort })
            }}
          >
            {copy.browse.reset}
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {copy.browse.showResults}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SaveSearchButton() {
  const { filters } = useAppStore()
  const { user } = useSession()
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  function openDialog() {
    if (!user) {
      setAuthOpen(true)
      return
    }
    // Suggest an honest, readable name from current filters.
    const bits: string[] = []
    if (filters.type !== 'any') bits.push(filters.type === 'OFFER' ? 'Offers' : 'Requests')
    if (filters.category !== 'any') bits.push(CATEGORIES.find((c) => c.key === filters.category)?.label ?? filters.category)
    if (filters.county !== 'any') bits.push(filters.county)
    if (filters.q) bits.push(`"${filters.q}"`)
    setName(bits.join(' · ') || 'Everything')
    setOpen(true)
  }

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await apiPost('/api/saved-searches', {
        name: name.trim(),
        query: {
          q: filters.q || undefined,
          type: filters.type !== 'any' ? filters.type : undefined,
          category: filters.category !== 'any' ? filters.category : undefined,
          county: filters.county !== 'any' ? filters.county : undefined,
          unit: filters.unit !== 'any' ? filters.unit : undefined,
          minPrice: filters.minPrice !== '' ? Number(filters.minPrice) : undefined,
          maxPrice: filters.maxPrice !== '' ? Number(filters.maxPrice) : undefined,
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['saved-searches'] })
      toast({ title: 'Search saved', description: 'You will get alerts when new listings match.' })
      setOpen(false)
    } catch (err) {
      toast({ title: 'Could not save search', description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={openDialog}>
        <Bookmark className="size-3.5" aria-hidden /> {copy.browse.saveSearch}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{copy.browse.saveSearch}</DialogTitle>
            <DialogDescription>We will alert you when new listings match these filters.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ss-name">Search name</Label>
            <Input id="ss-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <DialogFooter>
            <Button type="button" onClick={save} disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : copy.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-center">
      <p className="text-sm font-medium">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">Try again in a moment. If the problem continues, the service may be having trouble.</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}
