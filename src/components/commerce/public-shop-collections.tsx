'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Layers3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiGet, type Listing } from '@/lib/client'

type PublicCollection = {
  id: string
  title: string
  description: string | null
  coverPhotoUrl: string | null
  coverImages: string[]
  itemCount: number
}
type PublicCollectionDetail = { collection: PublicCollection; items: Array<{ id: string; listing: Listing }> }

export function PublicShopCollections({ shopId, onOpenListing }: { shopId: string; onOpenListing: (listingId: string) => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const collectionsQuery = useQuery({
    queryKey: ['shop-collections', shopId],
    queryFn: () => apiGet<{ collections: PublicCollection[] }>(`/api/shops/${encodeURIComponent(shopId)}/collections`),
  })
  const detailQuery = useQuery({
    queryKey: ['public-collection', expandedId],
    enabled: Boolean(expandedId),
    queryFn: () => apiGet<PublicCollectionDetail>(`/api/collections/${encodeURIComponent(expandedId!)}`),
  })
  const collections = collectionsQuery.data?.collections ?? []
  if (collectionsQuery.isLoading) return null
  if (collectionsQuery.isError) {
    return <p className="text-sm text-muted-foreground">Collections could not be loaded right now.</p>
  }
  if (collections.length === 0) return null

  return (
    <section aria-label="Shop product collections" className="space-y-3">
      <div className="flex items-center gap-2">
        <Layers3 className="size-4 text-primary" aria-hidden />
        <h2 className="text-base font-semibold">Shop collections</h2>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {collections.map((collection) => {
          const expanded = expandedId === collection.id
          return (
            <div key={collection.id} className="overflow-hidden rounded-lg border bg-card">
              <button type="button" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : collection.id)} className="flex min-h-16 w-full items-center gap-3 p-3 text-left hover:bg-accent/40">
                {collection.coverPhotoUrl ? (
                  <img src={collection.coverPhotoUrl} alt="" loading="lazy" className="size-14 shrink-0 rounded-md object-cover" />
                ) : collection.coverImages?.length === 1 ? (
                  <img src={collection.coverImages[0]} alt="" loading="lazy" className="size-14 shrink-0 rounded-md object-cover" />
                ) : collection.coverImages?.length > 1 ? (
                  <span className="grid size-14 shrink-0 grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-md bg-secondary">
                    {collection.coverImages.slice(0, 4).map((photo, index) => <img key={`${photo}-${index}`} src={photo} alt="" loading="lazy" className="size-full min-h-0 min-w-0 object-cover" />)}
                  </span>
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-secondary"><Layers3 className="size-5 text-muted-foreground" aria-hidden /></span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold">{collection.title}</span>
                  <span className="block text-xs text-muted-foreground">{collection.itemCount} {collection.itemCount === 1 ? 'product' : 'products'}</span>
                  {collection.description ? <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{collection.description}</span> : null}
                </span>
                {expanded ? <ChevronUp className="size-4 shrink-0" aria-hidden /> : <ChevronDown className="size-4 shrink-0" aria-hidden />}
              </button>
              <div className="px-3 pb-3">
                <Link href={`/collections/${collection.id}`} className="text-xs font-semibold text-primary hover:underline">
                  Open collection page · Share link
                </Link>
              </div>
              {expanded ? (
                <div className="border-t p-3">
                  {detailQuery.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading products…</p> : null}
                  {detailQuery.isError ? <p role="alert" className="text-sm text-muted-foreground">This collection could not be opened. Please try again.</p> : null}
                  {detailQuery.data?.collection.id === collection.id && detailQuery.data.items.length === 0 ? <p className="text-sm text-muted-foreground">No active products in this collection right now.</p> : null}
                  {detailQuery.data?.collection.id === collection.id ? (
                    <ul className="space-y-2">
                      {detailQuery.data.items.map(({ id, listing }) => (
                        <li key={id} className="flex min-w-0 items-center gap-3">
                          {listing.photos?.[0] ? <img src={listing.photos[0]} alt="" loading="lazy" className="size-12 shrink-0 rounded-md object-cover" /> : <span className="size-12 shrink-0 rounded-md bg-secondary" />}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{listing.title}</span>
                            <span className="block text-xs text-muted-foreground">{listing.price !== null ? `${listing.currency} ${listing.price.toLocaleString()}${listing.unit ? ` / ${listing.unit}` : ''}` : 'Contact seller for details'}</span>
                          </span>
                          <Button size="sm" variant="outline" onClick={() => onOpenListing(listing.id)}>View</Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
