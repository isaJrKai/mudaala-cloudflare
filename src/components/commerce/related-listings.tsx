'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/client'
import { categoryLabel, unitLabel } from '@/lib/constants'
import { formatPrice } from '@/lib/format'
import { listingThumbnailUrl } from '@/lib/image'
import { PlaceholderTile } from './placeholder-tile'
import { Skeleton } from '@/components/ui/skeleton'

interface RecommendationItem {
  id: string
  title: string
  description: string
  category: string
  price: number | null
  currency: string
  unit: string | null
  county: string
  area: string | null
  photos: string[]
  publishedAt: string
  reason: string
}

export function RelatedListings({
  listingId,
  linkPrefix = '/#/listing/',
}: {
  listingId: string
  /** Public ad pages use /l/{id}; the in-app view uses the hash route. */
  linkPrefix?: string
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['listing-recommendations', listingId],
    queryFn: () => apiGet<{ items: RecommendationItem[] }>(`/api/listings/${listingId}/recommendations`),
    staleTime: 60_000,
  })
  const items = data?.items ?? []

  if (loading) {
    return (
      <section aria-label="Finding related products" className="space-y-3">
        <Skeleton className="h-6 w-44" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-44 rounded-lg" />)}
        </div>
      </section>
    )
  }

  // No weak filler: if the live catalogue has no genuinely related items,
  // the section stays absent rather than pretending unrelated stock fits.
  if (items.length === 0) return null

  return (
    <section aria-label="You may also like" className="space-y-3">
      <div>
        <h2 className="text-lg font-bold tracking-tight">You may also like</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Matched by product details, style, price and category, not category alone.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => {
          const photo = item.photos[0]
          const thumbnail = photo ? listingThumbnailUrl(photo) : null
          const location = [item.area, item.county].filter(Boolean).join(', ')
          return (
            <a
              key={item.id}
              href={`${linkPrefix}${item.id}`}
              className="group min-w-0 overflow-hidden rounded-lg border bg-card transition-colors hover:border-primary/40 hover:bg-accent/20"
              aria-label={`View ${item.title}, ${formatPrice(item.price, item.unit ? unitLabel(item.unit) : null, item.currency)}`}
            >
              <div className="aspect-[4/3] overflow-hidden bg-muted">
                {thumbnail && photo ? (
                  <img
                    src={thumbnail}
                    alt={item.title}
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                    onError={(event) => {
                      if (event.currentTarget.src.includes('.thumb.webp')) event.currentTarget.src = photo
                    }}
                  />
                ) : (
                  <PlaceholderTile category={item.category} className="size-full" />
                )}
              </div>
              <div className="space-y-1.5 p-3">
                <p className="line-clamp-2 min-h-10 text-sm font-semibold leading-snug">{item.title}</p>
                <p className="text-xs text-muted-foreground">{categoryLabel(item.category)}</p>
                <p className="text-sm font-bold text-primary tabular-nums">
                  {formatPrice(item.price, item.unit ? unitLabel(item.unit) : null, item.currency)}
                </p>
                <p className="line-clamp-1 text-xs text-muted-foreground">{location}</p>
                <p className="pt-1 text-[11px] font-medium text-emerald-800">{item.reason}</p>
              </div>
            </a>
          )
        })}
      </div>
    </section>
  )
}
