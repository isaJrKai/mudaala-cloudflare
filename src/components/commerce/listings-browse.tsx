'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, SlidersHorizontal, Bookmark, X, ChevronLeft, ChevronRight, Hash, Heart, MapPin, Info, Store } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { apiGet, apiPost } from '@/lib/client'
import type { ListingsPage, ShopLookupResponse, ShopNameSearchResponse, ListingDetail as ListingDetailT, Listing, ListingShopOwner as ListingShopOwnerT, ShopPage as ShopPageT } from '@/lib/client'
import { normalizeShopName, normalizeShopCode } from '@/lib/format'
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
import { copy } from '@/lib/copy'
import { TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
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

  const codeLookup = useQuery({
    queryKey: ['shop-code', codeQuery],
    queryFn: () => apiGet<ShopLookupResponse>(`/api/shops/lookup?code=${encodeURIComponent(codeQuery)}`),
    enabled: codeQuery !== '',
    // A code either exists or it doesn't - the first honest answer is final.
    retry: false,
  })
  const codeShop = codeQuery !== '' && codeLookup.data ? codeLookup.data.shop : null

  const shopLabels = useMemo(() => computeShopLabels(data?.items), [data])

  // Keep the discovery feed editorially distinct: genuinely discounted
  // listings are reserved for Special offers and never repeated in the
  // ordinary local feed. A discount is valid only when the old price is
  // strictly higher than the current price.
  // Distance chips - computed from the same blurred coords the server used,
  // so the label a buyer reads always matches the order they see.
  const distanceLabels = useMemo(() => {
    const map = new Map<string, string>()
    if (!data || nearMe.lat === null || nearMe.lng === null) return map
    for (const listing of data.items) {
      const spot = listing.user?.profile
      if (!spot || spot.lat === null || spot.lng === null) continue
      map.set(listing.id, formatDistance(haversineMeters({ lat: nearMe.lat, lng: nearMe.lng }, { lat: spot.lat, lng: spot.lng })))
    }
    return map
  }, [data, nearMe.lat, nearMe.lng])

  const activeFilterCount = [
    filters.type !== 'any' ? 1 : 0,
    filters.category !== 'any' ? 1 : 0,
    filters.county !== 'any' ? 1 : 0,
    filters.unit !== 'any' ? 1 : 0,
    filters.minPrice !== '' ? 1 : 0,
    filters.maxPrice !== '' ? 1 : 0,
  ].reduce<number>((a, b) => a + b, 0)
  const nonCategoryFilterCount = [
    filters.type !== 'any' ? 1 : 0,
    filters.county !== 'any' ? 1 : 0,
    filters.unit !== 'any' ? 1 : 0,
    filters.minPrice !== '' ? 1 : 0,
    filters.maxPrice !== '' ? 1 : 0,
  ].reduce<number>((a, b) => a + b, 0)

  // Category shortcuts keep the shop-led Browse layout and narrow each
  // merchant's products/showroom. Search and other explicit filters use the
  // focused results view instead.
  const showDiscoverySections = !filters.q.trim() && nonCategoryFilterCount === 0 && (data?.page ?? 1) === 1
  // Shop discovery is independent of the current product page: include
  // public shops with active listings OR real showroom items, grouped by
  // the merchant's declared business category.
  const discoveryQuery = useQuery({
    queryKey: ['browse-shop-directory'],
    enabled: showDiscoverySections,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: () => apiGet<ShopDiscoveryResponse>('/api/shops/discover?directory=1'),
  })
  // Reuse the buyer's saved category order to prioritize relevant shop circles.
  const discoveryShops = useMemo(() => {
    const rank = new Map<string, number>()
    orderedCategories.forEach((category, index) => rank.set(category.key, index))
    const shops = (discoveryQuery.data?.shops ?? []).map((shop) => filters.category === 'any'
      ? shop
      : {
          ...shop,
          listings: shop.listings.filter((listing) => listing.category === filters.category),
          showroomItems: shop.showroomItems.filter((item) => item.category === filters.category),
        }).filter((shop) => filters.category === 'any' || shop.listings.length > 0 || shop.showroomItems.length > 0)
    return [...shops].sort(
      (a, b) => (rank.get(a.category ?? '') ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.category ?? '') ?? Number.MAX_SAFE_INTEGER),
    )
  }, [discoveryQuery.data?.shops, orderedCategories, filters.category])

  const renderListingGrid = (items: ListingsPage['items'], primary = false) => items.length > 0 ? (
    <div data-testid={primary ? 'listing-results-grid' : 'listing-feed-grid'} className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
      {items.map((listing) => (
        <ListingBlock
          key={listing.id}
          listing={listing}
          shopLabel={shopLabels.get(listing.id)}
          distanceLabel={distanceLabels.get(listing.id)}
          onOpen={(id) => navigate({ name: 'listing', id })}
          onOpenShop={(shopId) => navigate({ name: 'shop', id: shopId })}
          onAdd={addToBasket}
        />
      ))}
    </div>
  ) : null

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

      {showDiscoverySections ? (
        <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-slim" aria-label="Quick product categories">
          <button type="button" onClick={() => setFilters({ category: 'any', page: 1 })}
            aria-current={filters.category === 'any' ? 'true' : undefined}
            className={cn('shrink-0 rounded-full border px-3 py-2 text-xs font-semibold', filters.category === 'any' ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted')}>
            All
          </button>
          {orderedCategories.slice(0, 8).map((category) => (
            <button key={category.key} type="button" onClick={() => setFilters({ category: category.key, page: 1 })}
              aria-current={filters.category === category.key ? 'true' : undefined}
              className={cn('shrink-0 rounded-full border px-3 py-2 text-xs font-semibold', filters.category === category.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted')}>
              {category.label}
            </button>
          ))}
        </nav>
      ) : null}

      {filters.q.trim() && (inferredSearchCategories.length > 0 || priceIntentHint || priceSortHint) ? (
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {inferredSearchCategories.length > 0
            ? `Also matching ${inferredSearchCategories.map(categoryLabel).join(', ')} products`
            : 'Search filters applied'}
          {priceIntentHint ? ` · ${priceIntentHint}` : ''}
          {priceSortHint ? ` · ${priceSortHint}` : ''}
        </p>
      ) : null}

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
        <div className={isFetching ? 'space-y-4 opacity-60 transition-opacity' : 'space-y-4'}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-tight tracking-tight">
                {filters.q.trim() || activeFilterCount > 0 ? 'Search results' : 'Discover near you'}
              </h1>
              {showDiscoverySections ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Start with a shop. Explore its products, then its showroom where available.
                </p>
              ) : null}
            </div>
            <p className="shrink-0 text-xs text-muted-foreground" role="status">
              {copy.browse.resultsFound(data.total, data.pageCount > 1 ? { page: data.page, pageCount: data.pageCount } : undefined)}
            </p>
          </div>
          {showDiscoverySections ? (
            <ShopLedDiscoverySection
              shops={discoveryShops}
              loading={discoveryQuery.isLoading}
              onOpenShop={(shopId) => navigate({ name: 'shop', id: shopId })}
              onOpenListing={(id) => navigate({ name: 'listing', id })}
              onAdd={addToBasket}
            />
          ) : (
            renderListingGrid(data.items, true)
          )}

          {data.pageCount > 1 ? (
            <Pagination page={data.page} pageCount={data.pageCount} onPage={(p) => setFilters({ page: p })} />
          ) : null}
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
    listings: Array<Listing & { user: ListingShopOwnerT }>
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

function ShopLedDiscoverySection({
  shops,
  loading,
  onOpenShop,
  onOpenListing,
  onAdd,
}: {
  shops: ShopDiscoveryResponse['shops']
  loading: boolean
  onOpenShop: (shopId: string) => void
  onOpenListing: (listingId: string) => void
  onAdd: (listing: Listing & { user?: ListingShopOwnerT }) => boolean | void
}) {
  if (shops.length === 0 && !loading) return null
  return (
    <section className="space-y-6" aria-label="Shops, products and showrooms">
      {shops.map((shop) => (
        <section key={shop.id} className="min-w-0 space-y-3 border-b border-border/70 pb-6 last:border-0" aria-labelledby={`shop-${shop.id}-heading`}>
          <div className="flex items-center gap-3">
            {shop.photoUrl ? (
              <img src={shop.photoUrl} alt="" loading="lazy" className="size-14 shrink-0 rounded-md border object-cover" />
            ) : (
              <span className="flex size-14 shrink-0 items-center justify-center rounded-md border bg-secondary text-primary"><Store className="size-6" aria-hidden /></span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">{shopCategoryLabel(shop.category)}</p>
              <h2 id={`shop-${shop.id}-heading`} className="truncate text-base font-bold tracking-tight">{shop.name}</h2>
              <p className="truncate text-xs text-muted-foreground">{[shop.area, shop.county].filter(Boolean).join(', ') || 'Local shop on Mudaala'}</p>
            </div>
            <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => onOpenShop(shop.id)}>View shop</Button>
          </div>

          {shop.listings.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Products</h3>
                <span className="text-[11px] text-muted-foreground">{shop.listings.length} shown</span>
              </div>
              <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {shop.listings.map((listing) => (
                  <ListingBlock
                    key={listing.id}
                    listing={listing}
                    onOpen={onOpenListing}
                    onOpenShop={onOpenShop}
                    onAdd={onAdd}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="rounded-md bg-muted/40 px-3 py-3 text-xs text-muted-foreground">This shop has no active products listed yet.</p>
          )}

          {shop.showroomItems.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Showroom</h3>
                <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => onOpenShop(shop.id)}>View showroom</button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {shop.showroomItems.map((item) => (
                  <button key={item.id} type="button" onClick={() => onOpenShop(shop.id)} className="flex min-w-0 items-center gap-2 rounded-md border bg-card p-2 text-left hover:bg-muted/30">
                    {item.photoUrl ? <img src={item.photoUrl} alt="" loading="lazy" className="size-14 shrink-0 rounded object-cover" /> : <span className="flex size-14 shrink-0 items-center justify-center rounded bg-secondary text-primary"><Store className="size-5" aria-hidden /></span>}
                    <span className="min-w-0">
                      <span className="block line-clamp-2 text-xs font-semibold">{item.title}</span>
                      <span className="mt-1 block text-xs font-bold text-primary">{item.price === null ? 'Ask for price' : `UGX ${Math.round(item.price).toLocaleString('en-UG')}`}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ))}
      {shops.length === 0 && loading ? (
        <div className="space-y-3" aria-label="Loading shops" aria-busy="true">
          {[0, 1, 2].map((key) => <div key={key} className="h-40 animate-pulse rounded-lg bg-muted/50" />)}
        </div>
      ) : null}
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

function Pagination({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  return (
    <nav className="flex items-center justify-center gap-2 pt-2" aria-label="Pagination">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="size-4" aria-hidden /> {copy.common.prev}
      </Button>
      <span className="px-2 text-sm text-muted-foreground tabular-nums">
        {page} / {pageCount}
      </span>
      <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        {copy.common.next} <ChevronRight className="size-4" aria-hidden />
      </Button>
    </nav>
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
