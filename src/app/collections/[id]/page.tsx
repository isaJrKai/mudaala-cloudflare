import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { Layers3, Store } from 'lucide-react'
import { ShareAdRow } from '@/components/commerce/share-row'
import { SiteFooter } from '@/components/commerce/site-footer'
import { db, withRequestDb } from '@/lib/db'
import { absolutePhoto, photosOf } from '@/lib/ad-page'
import { formatPrice } from '@/lib/format'
import { siteUrl } from '@/lib/site'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const loadCollection = cache(async (id: string) => withRequestDb(async () => {
  const collection = await db.productCollection.findFirst({
    where: { id, isActive: true },
    select: {
      id: true,
      userId: true,
      title: true,
      description: true,
      coverPhotoUrl: true,
      user: {
        select: {
          id: true,
          name: true,
          country: true,
          profile: { select: { businessName: true, photoUrl: true, area: true, county: true, shopCode: true } },
        },
      },
    },
  })
  if (!collection) return null
  const items = await db.productCollectionItem.findMany({
    where: {
      collectionId: id,
      listing: { is: { userId: collection.userId, status: 'ACTIVE', type: 'OFFER', isSeed: false, expiresAt: { gt: new Date() } } },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: 100,
    select: {
      id: true,
      listing: { select: { id: true, title: true, description: true, photos: true, price: true, currency: true, unit: true } },
    },
  })
  const { userId, user, ...publicCollection } = collection
  return {
    collection: publicCollection,
    shop: {
      id: user.id,
      name: user.profile?.businessName?.trim() || user.name,
      area: user.profile?.area ?? null,
      county: user.profile?.county ?? null,
      shopCode: user.profile?.shopCode ?? null,
    },
    items,
  }
}))

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  const data = await loadCollection(id)
  if (!data) return { title: 'Collection unavailable · Mudaala', robots: { index: false, follow: false } }
  const { collection, shop, items } = data
  const title = `${collection.title} · ${shop.name} · Mudaala`
  const description = (collection.description?.trim() || `Explore ${items.length} available products from ${shop.name} on Mudaala.`).replace(/\\s+/g, ' ').slice(0, 200)
  const cover = collection.coverPhotoUrl
    ? absolutePhoto(collection.coverPhotoUrl)
    : items.flatMap((item) => photosOf(item.listing.photos)).map(absolutePhoto)[0]
  const shareImage = cover ?? `${siteUrl}/api/og/collection?title=${encodeURIComponent(collection.title)}&shop=${encodeURIComponent(shop.name)}`
  return {
    title,
    description,
    alternates: { canonical: `/collections/${collection.id}` },
    robots: { index: true, follow: true },
    openGraph: { title, description, url: `/collections/${collection.id}`, siteName: 'Mudaala', type: 'website', images: [{ url: shareImage, alt: `${collection.title} from ${shop.name}` }] },
    twitter: { card: 'summary_large_image', title, description, images: [shareImage] },
  }
}

export default async function PublicCollectionPage({ params }: Params) {
  const { id } = await params
  const data = await loadCollection(id)
  if (!data) notFound()
  const { collection, shop, items } = data
  const shareUrl = `${siteUrl}/collections/${collection.id}`
  const cover = collection.coverPhotoUrl ? absolutePhoto(collection.coverPhotoUrl) : null

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">
        <Link href="/" className="font-display text-xl font-bold lowercase tracking-tight text-foreground">mudaala</Link>
        <header className="mt-6 overflow-hidden rounded-2xl border bg-card">
          {cover ? <img src={cover} alt="" className="max-h-80 w-full object-cover" /> : null}
          <div className="p-5 sm:p-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Layers3 className="size-4" aria-hidden /> Product collection</div>
            <h1 className="mt-2 break-words text-2xl font-bold tracking-tight sm:text-3xl">{collection.title}</h1>
            {collection.description ? <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm text-muted-foreground sm:text-base">{collection.description}</p> : null}
            <Link href={shop.shopCode ? `/s/${shop.shopCode}` : '/'} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
              <Store className="size-4" aria-hidden />
              {shop.name}{shop.area || shop.county ? ` · ${[shop.area, shop.county].filter(Boolean).join(', ')}` : ''}
            </Link>
          </div>
        </header>

        <section className="mt-8" aria-labelledby="collection-products-title">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 id="collection-products-title" className="text-lg font-semibold">Products in this collection</h2>
              <p className="mt-1 text-sm text-muted-foreground">{items.length} available {items.length === 1 ? 'product' : 'products'}</p>
            </div>
          </div>
          {items.length ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {items.map(({ id: itemId, listing }) => {
                const photo = photosOf(listing.photos).filter((value) => !value.includes('/uploads/seed/'))[0]
                return (
                  <li key={itemId} className="overflow-hidden rounded-xl border bg-card">
                    <Link href={`/l/${listing.id}`} className="block h-full hover:bg-accent/20">
                      {photo ? <img src={absolutePhoto(photo)} alt="" loading="lazy" className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center bg-secondary text-sm text-muted-foreground">No photo</div>}
                      <div className="p-3">
                        <h3 className="line-clamp-2 min-h-10 text-sm font-semibold">{listing.title}</h3>
                        <p className="mt-2 text-sm font-medium">{formatPrice(listing.price, listing.unit, listing.currency)}</p>
                        <span className="mt-3 inline-block text-xs font-medium text-primary">View product →</span>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="rounded-xl border p-6 text-sm text-muted-foreground">There are no active products in this collection right now. Visit the shop to see other listings.</div>
          )}
        </section>

        <section className="mt-8 rounded-xl border p-4 sm:p-5">
          <ShareAdRow title={collection.title} url={shareUrl} noun="collection" label="Share this collection" />
        </section>
        <p className="mt-5 text-xs text-muted-foreground">Product availability and prices can change. Confirm details with the seller before paying.</p>
      </div>
      <SiteFooter />
    </main>
  )
}
