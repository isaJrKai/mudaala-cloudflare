// Shop pages - every shop code gets a real web page: /s/MD-4821. The code
// is printed on posters and typed like a mobile-money till number, so the
// URL forgives case, spaces and dashes (normalizeShopCode) while the
// canonical tag always states the stored form. The page shows identity and
// live stock; contact happens per listing, so no phone number is rendered
// here at all - not in the body, not in the metadata.

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { Clock, MapPin } from 'lucide-react'
import { ShareAdRow } from '@/components/commerce/share-row'
import { ReportButton } from '@/components/commerce/report-button'
import { db, withRequestDb } from '@/lib/db'
import { normalizeShopCode } from '@/lib/format'
import { activeListingExpiryFilter } from '@/lib/listing-visibility'
import { siteUrl } from '@/lib/site'
import { copy } from '@/lib/copy'
import { SiteFooter } from '@/components/commerce/site-footer'
import { photosOf, absolutePhoto, placeOf, priceLabelOf } from '@/lib/ad-page'
import { categoryLabel } from '@/lib/constants'
import { findTaxonomyNode } from '@/lib/product-taxonomy'
import { publicCollectionVisibilityWhere } from '@/lib/collection-visibility'
import { ShopProductBrowser, type ShopBrowserProduct } from '@/components/commerce/shop-product-browser'
import { TagTapBeacon } from '@/components/commerce/tag-tap-beacon'
import { normalizeTagCode } from '@/lib/shop-tags'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ code: string }> }
// ?t=<tagCode> (and &v=qr) arrive when the page is opened from a Mudaala NFC
// tag or its QR twin; they only drive tap counting and never change content.
type PageProps = Params & { searchParams: Promise<{ t?: string | string[]; v?: string | string[] }> }

// Request-scoped loader (React.cache dedupes the generateMetadata + page
// pair). Null for malformed or unknown codes; the page turns that into a
// friendly 404.
const loadShop = cache(async (raw: string) => {
  const code = normalizeShopCode(raw)
  if (!code) return null

  return db.businessProfile.findUnique({
    where: { shopCode: code },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          createdAt: true,
          listings: { where: { status: 'ACTIVE', ...activeListingExpiryFilter() }, orderBy: { refreshedAt: 'desc' }, take: 200 },
        },
      },
    },
  })
})

type ShopRow = NonNullable<Awaited<ReturnType<typeof loadShop>>>

function shopName(shop: ShopRow): string {
  return shop.businessName?.trim() || shop.user.name
}

function shopPlace(shop: ShopRow): string {
  return [shop.area, shop.county].filter(Boolean).join(', ')
}

// The preview image: the newest live ad's first photo - a shop IS its stock
// - falling back to the shop photo the seller uploaded.
// PLACEHOLDER RULE - seed photos (/uploads/seed/) are development fixtures:
// they never ship as the shop's OG/Twitter preview.
function shopImage(shop: ShopRow): string | undefined {
  const photo =
    photosOf(shop.user.listings[0]?.photos ?? '[]').find((p) => !p.includes('/uploads/seed/')) ??
    (shop.photoUrl && !shop.photoUrl.includes('/uploads/seed/') ? shop.photoUrl : undefined)
  return photo ? absolutePhoto(photo) : undefined
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return withRequestDb(async () => {
  const { code } = await params
  const shop = await loadShop(code)
  if (!shop) {
    return { title: 'Shop not found · Mudaala', robots: { index: false, follow: false } }
  }

  const name = shopName(shop)
  const place = shopPlace(shop)
  const count = shop.user.listings.length
  const blurb = shop.description?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? ''
  const description = `${count} live ad${count === 1 ? '' : 's'}${place ? ` in ${place}` : ''} on Mudaala.${blurb ? ` ${blurb}` : ''}`
  const image = shopImage(shop)

  return {
    title: `${name} · Mudaala`,
    description,
    alternates: { canonical: `/s/${shop.shopCode}` },
    robots: { index: true, follow: true },
    openGraph: {
      title: `${name} · Mudaala`,
      description,
      url: `/s/${shop.shopCode}`,
      siteName: 'Mudaala',
      type: 'website',
      ...(image ? { images: [image] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: `${name} · Mudaala`,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
  })
}

export default async function ShopPage({ params, searchParams }: PageProps) {
  return withRequestDb(async () => {
  const { code } = await params
  const query = await searchParams
  const tagCode = normalizeTagCode(Array.isArray(query.t) ? query.t[0] : query.t)
  const tagVia = (Array.isArray(query.v) ? query.v[0] : query.v) === 'qr' ? 'qr' : 'nfc'
  const shop = await loadShop(code)
  if (!shop) notFound()

  const name = shopName(shop)
  const place = shopPlace(shop)
  const listings = shop.user.listings
  // Group each shop's products by the product type chosen at publish time.
  const listingGroups = new Map<string, { label: string; items: typeof listings }>()
  for (const listing of listings) {
    const node = listing.taxonomyId ? findTaxonomyNode(listing.taxonomyId) : undefined
    const key = node ? 'taxonomy:' + node.id : 'legacy:' + listing.category
    const group = listingGroups.get(key) ?? { label: node?.label ?? categoryLabel(listing.category), items: [] }
    group.items.push(listing)
    listingGroups.set(key, group)
  }
  const groupedListings = [...listingGroups.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label))
  // Seller-created collections are the flexible layer below standard product
  // types: e.g. Used iPhones, Zara Bags, Italian Cuisine or New Arrivals.
  const shopCollections = await db.productCollection.findMany({
    where: { userId: shop.user.id, ...publicCollectionVisibilityWhere(new Date()) },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      title: true,
      description: true,
      coverPhotoUrl: true,
      items: {
        where: { listing: { is: { userId: shop.user.id, status: 'ACTIVE', type: 'OFFER', isSeed: false, expiresAt: { gt: new Date() } } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, listing: { select: { photos: true } } },
      },
    },
  })
  const visibleShopCollections = shopCollections.filter((collection) => collection.items.length > 0)
  const shareUrl = `${siteUrl}/s/${shop.shopCode}`

  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-background">
      {tagCode ? <TagTapBeacon tagCode={tagCode} via={tagVia} /> : null}
      <header className="flex items-center justify-between border-b bg-card px-4 py-3">
        <a href="/" className="font-display text-xl font-semibold tracking-tight text-primary">
          Mudaala
        </a>
        <a
          href={`/#/shop/${shop.user.id}`}
          className="text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          Open in the app
        </a>
      </header>

      <main className="space-y-4 px-4 py-4">
        {/* Identity - real account facts only, same honesty rules as the
            ad pages: name, real code, real start date, what the seller
            actually filled in. No badges, no ratings. */}
        <section className="rounded-lg border bg-card p-4 sm:p-5" aria-label="About this shop">
          <div className="flex items-center gap-3">
            {shop.photoUrl ? (
              <img src={shop.photoUrl} alt="" className="size-14 shrink-0 rounded-lg border object-cover" />
            ) : (
              <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-accent text-xl font-semibold text-accent-foreground">
                {name.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="truncate font-display text-2xl font-semibold tracking-tight">{name}</h1>
              <p className="text-sm text-muted-foreground">
                Active since {new Date(shop.user.createdAt).toLocaleDateString('en', { month: 'short', year: 'numeric' })}
                {place ? ` · ${place}` : ''}
              </p>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Shop code{' '}
            <span className="rounded border bg-secondary px-1.5 py-0.5 text-[13px] font-semibold tracking-widest text-foreground tabular-nums">
              {shop.shopCode}
            </span>{' '}
            Type it into Mudaala search to find this shop again.
          </p>
          {shop.description ? <p className="mt-2 text-sm leading-relaxed text-foreground/90">{shop.description}</p> : null}
          {shop.hours ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-4" aria-hidden /> {shop.hours}
            </p>
          ) : null}
        </section>

        {visibleShopCollections.length > 0 ? (
          <section aria-label="Shop collections" className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Shop collections</h2>
              <span className="text-xs text-muted-foreground">{visibleShopCollections.length} curated {visibleShopCollections.length === 1 ? 'group' : 'groups'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {visibleShopCollections.map((collection) => {
                const firstPhoto = collection.coverPhotoUrl || collection.items.flatMap((item) => photosOf(item.listing.photos).filter((photo) => !photo.includes('/uploads/seed/')))[0]
                return (
                  <Link key={collection.id} href={"/collections/" + collection.id} className="overflow-hidden rounded-lg border bg-card transition-colors hover:bg-accent/40">
                    {firstPhoto ? (
                      <img src={absolutePhoto(firstPhoto)} alt="" className="aspect-[5/3] w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex aspect-[5/3] items-center justify-center bg-muted text-xs text-muted-foreground">Shop collection</div>
                    )}
                    <div className="space-y-1 p-2.5">
                      <p className="line-clamp-2 text-sm font-semibold">{collection.title}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{collection.description || (collection.items.length + (collection.items.length === 1 ? ' product' : ' products'))}</p>
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        ) : null}

                {/* Search, filter and browse this shop's catalogue without leaving its page. */}
        <section aria-label="Shop products" className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">Products ({listings.length})</h2>
            <span className="text-xs text-muted-foreground">{groupedListings.length} product types</span>
          </div>
          <ShopProductBrowser products={listings.map((ad): ShopBrowserProduct => {
            const node = ad.taxonomyId ? findTaxonomyNode(ad.taxonomyId) : undefined
            const photo = photosOf(ad.photos).find((p) => !p.includes('/uploads/seed/'))
            return {
              id: ad.id,
              title: ad.title,
              href: '/l/' + ad.id,
              photo,
              place: placeOf(ad),
              priceLabel: priceLabelOf(ad) ?? 'Ask seller',
              price: ad.price,
              currency: ad.currency,
              group: node?.label ?? categoryLabel(ad.category),
              brand: ad.brand ?? null,
              model: ad.model ?? null,
              attributes: ad.attributes && typeof ad.attributes === 'object' ? ad.attributes as Record<string, string | number | boolean> : {},
            }
          })} />
        </section>
        <section className="rounded-lg border bg-card p-4 sm:p-5" aria-label="Share this shop">
          <ShareAdRow title={name} url={shareUrl} priceLabel={null} noun="shop" label="Share this shop" />
          <div className="mt-3 border-t pt-3">
            <ReportButton targetType="SHOP" targetId={shop.id} noun="shop" />
          </div>
        </section>
      </main>

      <footer className="border-t px-4 py-4 text-center text-xs text-muted-foreground">
        <p>
          {copy.app.name}: {copy.app.footerLine}.{' '}
          <a href="/#/browse" className="font-medium text-primary underline-offset-2 hover:underline">
            Browse the market
          </a>
        </p>
      </footer>

      <SiteFooter />
    </div>
  )
  })
}
