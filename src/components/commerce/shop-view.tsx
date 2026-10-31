'use client'

// The shop - a seller's own space on Mudaala. Everything a buyer needs to trust
// them and browse their whole catalogue: who they are, where they are, when
// they are open, a call/WhatsApp button, and every active listing they run.
// Buyers never sign in to see any of this.
// The shop's identity code (MD-XXXX) and its printable QR poster live here
// too - the poster is the seller's tool for pulling walk-up customers onto
// their page (print it, stick it on the stall, buyers scan).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, BadgeCheck, Check, Clock, Copy, ExternalLink, Eye, MapPin, Pencil, Phone, Printer, QrCode, Share2, Store, X } from 'lucide-react'
import { WhatsAppIcon } from '@/components/commerce/brand-icons'
import QRCode from 'react-qr-code'
import { Button } from '@/components/ui/button'
import { apiFetch, apiGet } from '@/lib/client'
import type { ShopPage as ShopPageT, ListingShopOwner } from '@/lib/client'
import { telLink, whatsappLink, formatPhonePretty } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { useSession } from '@/hooks/use-session'
import { useAddToBasket } from './basket-view'
import { MudaalaCurve } from './mudaala-curve'
import { ListingBlock } from './listing-card'
import { PublicShopCollections } from './public-shop-collections'
import { ShopShowroom } from './shop-showroom'
import { ListingGridSkeleton } from './skeletons'
import { ErrorState } from './listings-browse'
import { EmptyState } from './empty-state'
import { PlaceholderTile } from './placeholder-tile'
import { copy } from '@/lib/copy'
import { categoryLabel } from '@/lib/constants'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

async function posterImageData(url: string | null | undefined): Promise<string | null> {
  if (!url) return null
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' })
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch { return null }
}

function posterXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&apos;')
}

async function createShopPosterFile(
  poster: HTMLElement,
  shop: { name: string; area: string | null; county: string | null; phone: string; shopCode: string; phoneConfirmed: boolean; photoUrl: string | null; coverPhotoUrl: string | null },
): Promise<File | null> {
  const qr = poster.querySelector('.poster-qr svg')
  if (!qr) return null
  const values = await Promise.all([
    posterImageData(shop.coverPhotoUrl || shop.photoUrl),
    posterImageData(shop.photoUrl),
    posterImageData('/logo.svg'),
    posterImageData('/mudaala-african-textile.svg'),
  ])
  if ((shop.coverPhotoUrl || shop.photoUrl) && !values[0]) return null
  if (shop.photoUrl && !values[1]) return null
  const qrMarkup = new XMLSerializer().serializeToString(qr)
  const qrData = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qrMarkup)
  const location = [shop.area, shop.county].filter(Boolean).join(', ') || 'Find us on Mudaala'
  const name = posterXml(shop.name)
  const place = posterXml(location)
  const phone = posterXml(formatPhonePretty(shop.phone))
  const trustLabel = shop.phoneConfirmed ? 'Trusted Shop' : 'Local Shop'
  const cover = values[0] ? '<image href="' + values[0] + '" x="28" y="150" width="1024" height="440" preserveAspectRatio="xMidYMid slice"/>' : ''
  const profile = values[1] ? '<image href="' + values[1] + '" x="70" y="645" width="200" height="200" preserveAspectRatio="xMidYMid slice"/>' : ''
  const markHeader = values[2] ? '<image href="' + values[2] + '" x="70" y="56" width="52" height="52"/>' : ''
  const mark = values[2] ? '<image href="' + values[2] + '" x="796" y="751" width="38" height="38"/>' : ''
  const textile = values[3] ? '<image href="' + values[3] + '" x="820" y="0" width="260" height="140" preserveAspectRatio="xMidYMid slice"/>' : ''
  const ringPattern = values[3] ? '<image href="' + values[3] + '" x="48" y="34" width="96" height="96" preserveAspectRatio="xMidYMid slice"/>' : '<circle cx="96" cy="82" r="48" fill="#10100f"/>'
  const qrPattern = values[3] ? '<image href="' + values[3] + '" x="665" y="620" width="300" height="300" preserveAspectRatio="xMidYMid slice"/>' : '<rect x="665" y="620" width="300" height="300" rx="24" fill="#10100f"/>'
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">',
    '<defs><clipPath id="logoRing"><circle cx="96" cy="82" r="48"/></clipPath><clipPath id="cover"><rect x="28" y="150" width="1024" height="440" rx="34"/></clipPath><clipPath id="profile"><circle cx="170" cy="745" r="100"/></clipPath><linearGradient id="shade"><stop stop-color="#10100f" stop-opacity=".05"/><stop offset="1" stop-color="#10100f" stop-opacity=".75"/></linearGradient></defs>',
    '<rect width="1080" height="1350" fill="#fbf6e9"/><path d="M0 0H1080V130C850 185 630 90 390 130S90 175 0 115Z" fill="#f4ecd9"/>',
    '<g clip-path="url(#logoRing)">', ringPattern, '</g>', markHeader,
    '<text x="166" y="91" font-family="Arial,sans-serif" font-size="58" font-weight="700" fill="#164a34">mudaala</text><text x="168" y="124" font-family="Arial,sans-serif" font-size="24" fill="#164a34">Buy and sell near you</text>',
    '<g clip-path="url(#cover)"><rect x="28" y="150" width="1024" height="440" fill="#d9d2c2"/>', cover, '<rect x="28" y="150" width="1024" height="440" fill="url(#shade)"/>',
    '<text x="590" y="310" font-family="Arial,sans-serif" font-size="70" font-weight="700" fill="#fff">Shop</text><text x="590" y="390" font-family="Arial,sans-serif" font-size="82" font-weight="800" fill="#ffd04a">Online</text><text x="590" y="455" font-family="Arial,sans-serif" font-size="48" font-weight="700" fill="#fff">with Mudaala!</text><text x="594" y="520" font-family="Arial,sans-serif" font-size="26" fill="#fff">Discover • Browse • Buy</text></g>',
    '<rect x="28" y="555" width="1024" height="410" rx="36" fill="#fffdf7" stroke="#e9d9b4" stroke-width="3"/><circle cx="170" cy="745" r="108" fill="#f2b82e"/><circle cx="170" cy="745" r="100" fill="#e7e0d1"/><g clip-path="url(#profile)">', profile, '</g>',
    '<text x="315" y="715" font-family="Arial,sans-serif" font-size="48" textLength="320" lengthAdjust="spacingAndGlyphs" font-weight="800" fill="#171717">' + name + '</text><text x="315" y="770" font-family="Arial,sans-serif" font-size="27" fill="#3b453e">⌖  ' + place + '</text><path d="M315 800H610" stroke="#eadfca" stroke-width="3"/><text x="315" y="855" font-family="Arial,sans-serif" font-size="24" textLength="300" lengthAdjust="spacingAndGlyphs" font-weight="600" fill="#171717">☎  ' + phone + '</text>',
    qrPattern, '<rect x="677" y="632" width="276" height="276" rx="14" fill="#fff"/><image href="' + qrData + '" x="686" y="641" width="258" height="258"/><circle cx="815" cy="770" r="30" fill="#fff" stroke="#f2b82e" stroke-width="5"/>', mark,
    '<rect x="678" y="928" width="276" height="42" rx="21" fill="#174a35"/><text x="816" y="957" text-anchor="middle" font-family="Arial,sans-serif" font-size="23" font-weight="700" fill="#fff">Scan to visit this shop</text>',
    '<text x="540" y="1035" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#174a35">' + posterXml(trustLabel) + '  •  Quality Products</text><text x="540" y="1080" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#174a35">Great Deals  •  Near You</text>',
    '<rect x="145" y="1120" width="790" height="112" rx="56" fill="#174a35" stroke="#f2b82e" stroke-width="7"/><text x="540" y="1190" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" font-weight="800" fill="#fff">Share on WhatsApp →</text><text x="540" y="1288" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-style="italic" fill="#174a35">Help others discover this shop</text><path d="M0 1320H1080V1350H0Z" fill="#174a35"/></svg>'
  ].join('')
  try {
    const objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    const image = new Image()
    image.src = objectUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 1080; canvas.height = 1350
    const context = canvas.getContext('2d')
    if (!context) { URL.revokeObjectURL(objectUrl); return null }
    context.drawImage(image, 0, 0)
    URL.revokeObjectURL(objectUrl)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return blob ? new File([blob], shop.shopCode.toLowerCase() + '-mudaala-poster.png', { type: 'image/png' }) : null
  } catch { return null }
}
export function ShopView({ id }: { id: string }) {
  const { navigate } = useAppStore()
  const { user, isLoading: sessionLoading } = useSession()
  const addToBasket = useAddToBasket()
  const [posterOpen, setPosterOpen] = useState(false)
  const posterRef = useRef<HTMLDivElement>(null)
  const [posterSharing, setPosterSharing] = useState(false)
  const [posterFile, setPosterFile] = useState<File | null>(null)
  const [posterFileReady, setPosterFileReady] = useState(false)
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false)
  // Copy-the-code feedback: the button itself becomes the receipt - it swaps
  // to a check + "Copied" for a beat, the same swap pattern as Add to basket.
  const [copied, setCopied] = useState(false)
  // The QR encodes an absolute URL, which only exists in the browser.
  // useSyncExternalStore gives '' during SSR/hydration and the real origin
  // after mount - hydration-safe without setState-in-effect (the origin of a
  // page never changes while it is open, so no real subscription is needed).
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => '',
  )
  const shopUrl = useMemo(
    () => (origin ? `${origin}/#/shop/${id}` : ''),
    [origin, id],
  )

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['shop', id],
    queryFn: () => apiGet<ShopPageT>(`/api/shops/${id}`),
  })

  useEffect(() => {
    const currentShop = data?.shop
    if (!posterOpen || !posterRef.current || !currentShop?.shopCode || !shopUrl) {
      setPosterFile(null)
      setPosterFileReady(false)
      return
    }
    let cancelled = false
    setPosterFileReady(false)
    void createShopPosterFile(posterRef.current, {
      name: currentShop.name, area: currentShop.area, county: currentShop.county,
      phone: currentShop.phone, shopCode: currentShop.shopCode, phoneConfirmed: currentShop.phoneConfirmed,
      photoUrl: currentShop.photoUrl, coverPhotoUrl: currentShop.coverPhotoUrl ?? null,
    }).then((file) => {
      if (!cancelled) { setPosterFile(file); setPosterFileReady(true) }
    })
    return () => { cancelled = true }
  }, [posterOpen, data, shopUrl])

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2 gap-1" onClick={() => navigate({ name: 'browse' })}>
          <ArrowLeft className="size-4" aria-hidden /> Back to browse
        </Button>
        <ListingGridSkeleton count={6} />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2 gap-1" onClick={() => navigate({ name: 'browse' })}>
          <ArrowLeft className="size-4" aria-hidden /> Back to browse
        </Button>
        <ErrorState message={error instanceof Error ? error.message : 'Could not load this shop'} onRetry={() => refetch()} />
      </div>
    )
  }

  const { shop, listings, showroomItems } = data
  const trackShopEngagement = (event: 'CALL_CLICK' | 'WHATSAPP_CLICK' | 'SHARE_CLICK') => {
    void apiFetch(`/api/shops/${encodeURIComponent(shop.id)}/engagement`, {
      method: 'POST',
      body: JSON.stringify({ event }),
      keepalive: true,
    }).catch(() => undefined)
  }
  const whatsappNumber = shop.whatsapp ?? shop.phone
  const doneCount = Object.values(shop.checklist).filter(Boolean).length
  const isOwner = !sessionLoading && user?.id === shop.id
  // Copy the till-style code. If the clipboard refuses (permissions), nothing
  // breaks - the code sits right there in big monospace; typing it was always
  // the honest fallback.
  const copyShopCode = async () => {
    if (!shop.shopCode) return
    try {
      await navigator.clipboard.writeText(shop.shopCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // No clipboard permission - nothing to fix, the code is on screen.
    }
  }
  // Share link: opens WhatsApp with the text pre-written (wa.me with no
  // recipient → the sender picks the chat or status). The code rides along so
  // the shop stays findable even after forwarding. Owner says "our"; a buyer
  // forwarding the shop says "found" - same link, honest voice for whoever
  // is tapping share.
  const shareHref =
    shopUrl && shop.shopCode
      ? `https://wa.me/?text=${encodeURIComponent(
          isOwner
            ? copy.shop.shareTextOwner(shop.name, shop.shopCode, shopUrl)
            : copy.shop.shareTextBuyer(shop.name, shop.shopCode, shopUrl),
        )}`
      : null

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2 gap-1" onClick={() => navigate({ name: 'browse' })}>
        <ArrowLeft className="size-4" aria-hidden /> Back to browse
      </Button>

      {/* The owner's mirror: only the seller ever sees this strip. It names
          the page as THEIRS - ownership is felt, not claimed - and answers
          the first question every new seller has ("what do customers actually
          get shown?") with a one-tap edit. A buyer loading this page never
          knows the strip exists. */}
      {isOwner ? (
        <section
          aria-label="Owner note"
          className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg border border-primary/20 bg-accent/60 px-3 py-2"
        >
          <Eye className="size-3.5 shrink-0 text-primary" aria-hidden />
          <p className="min-w-0 flex-1 text-xs leading-snug">
            <span className="font-semibold text-primary">{copy.shop.ownerStrip}</span>
          </p>
          <Button
            variant="outline"
            size="sm"
            className="press h-7 gap-1 border-primary/30 px-2.5 text-xs text-primary hover:bg-accent"
            onClick={() => navigate({ name: 'account' })}
          >
            <Pencil className="size-3" aria-hidden /> {copy.shop.editShop}
          </Button>
        </section>
      ) : null}

      {/* Shop identity - the seller's own space, named by them. The name is
          the signboard: serif, in the brand green, the way a market shop
          paints its name. The cover carries no photo until the seller uploads
          one: the flat grey tile (shop name + camera) stands in - no stock,
          no seed, no generated images anywhere. */}
      <section className="overflow-hidden rounded-lg border bg-card" aria-label={`Shop: ${shop.name}`}>
        {/* Existing shop photos remain the cover until a seller adds a distinct
            cover image. This keeps every current shop looking familiar. */}
        {(shop.coverPhotoUrl || shop.photoUrl) ? (
          <div className="relative">
            <img
              src={shop.coverPhotoUrl || shop.photoUrl || ''}
              alt={`Cover photo of ${shop.name}`}
              className="h-36 w-full object-cover object-center sm:h-48"
            />
            <MudaalaCurve className="absolute inset-x-0 bottom-0 block h-5 w-full text-card sm:h-6" />
            {shop.photoUrl ? (
              <button
                type="button"
                onClick={() => setPhotoPreviewOpen(true)}
                aria-label={`Enlarge ${shop.name} profile photo`}
                className="absolute -bottom-4 left-4 z-10 size-14 overflow-hidden rounded-lg border border-border bg-card object-cover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:-bottom-5 sm:left-5 sm:size-16"
              >
                <img
                  src={shop.photoUrl}
                  alt={`${shop.name} profile photo`}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            ) : null}
            <Dialog open={photoPreviewOpen} onOpenChange={setPhotoPreviewOpen}>
              <DialogContent className="max-w-[min(92vw,34rem)] p-3 sm:p-4">
                <DialogHeader>
                  <DialogTitle>{shop.name}</DialogTitle>
                  <DialogDescription>Shop profile photo</DialogDescription>
                </DialogHeader>
                {shop.photoUrl ? (
                  <img
                    src={shop.photoUrl}
                    alt={`Enlarged profile photo of ${shop.name}`}
                    className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-md object-contain"
                  />
                ) : null}
              </DialogContent>
            </Dialog>
          </div>
        ) : (
          <div className="relative">
            <PlaceholderTile
              title={shop.name}
              label={copy.shop.coverTileAria(shop.name)}
              iconClassName="size-7"
              className="h-36 w-full sm:h-44"
            />
            <MudaalaCurve className="absolute inset-x-0 bottom-0 block h-5 w-full text-card sm:h-6" />
          </div>
        )}
        <div className="p-4 sm:p-5">
          <div className={shop.photoUrl ? 'pl-[4.5rem] sm:pl-[5.5rem]' : undefined}>
            <h1 className="flex flex-wrap items-center gap-2 font-display text-[1.65rem] font-semibold leading-tight tracking-tight text-primary sm:text-3xl">
              <span>{shop.name}</span>
              {shop.isAdmin ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-600/25 bg-emerald-50 px-2 py-0.5 font-sans text-xs font-semibold text-emerald-700" title="Verified Mudaala administrator">
                  <BadgeCheck className="size-4" aria-hidden /> Admin
                </span>
              ) : null}
            </h1>
            {shop.category ? (
              <span className="mt-2 inline-flex rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                {categoryLabel(shop.category)}
              </span>
            ) : null}
            {/* The painter's stroke under a market signboard - drawn once on
                open, then it just sits there, the way a good sign does. */}
            <svg viewBox="0 0 150 8" className="mt-1.5 h-2 w-32 text-mango sm:w-48" aria-hidden="true">
              <path
                d="M2 6 C 30 2.2, 58 1.4, 82 3.4 S 130 6.4, 148 3"
                pathLength={1}
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                className="sign-draw"
              />
            </svg>
          </div>

          <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
            {shop.area || shop.county ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden /> {[shop.area, shop.county].filter(Boolean).join(', ')}
              </span>
            ) : null}
            {shop.hours ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden /> {shop.hours}
              </span>
            ) : null}
            <span className="tabular-nums">
              On Mudaala since {new Date(shop.memberSince).toLocaleDateString('en', { month: 'short', year: 'numeric' })}
            </span>
            {shop.shopCode ? (
              <span className="text-[13px] font-semibold tracking-widest text-foreground/70 tabular-nums">{shop.shopCode}</span>
            ) : null}
          </p>

          {/* Trust, not decoration: the one chip we can actually back - the
              number on screen IS the seller's login line, the API guarantees
              it. No "verified" claims we cannot prove. The profile-completeness
              chip is the seller's to-do, so only the seller ever sees it. */}
          {shop.phoneConfirmed || isOwner ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {shop.phoneConfirmed ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground ring-1 ring-inset ring-primary/15">
                  <BadgeCheck className="size-3.5" aria-hidden /> Phone confirmed
                </span>
              ) : null}
              {isOwner ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {shop.complete ? 'Complete shop profile' : `Profile ${doneCount}/5 complete`}
                </span>
              ) : null}
            </div>
          ) : null}

          {shop.description ? (
            <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-foreground/90">{shop.description}</p>
          ) : isOwner ? (
            // The empty slot works FOR the seller: it names what belongs here
            // and hands them the pen. Not a blank gap, not a lorem ipsum.
            <p className="mt-3 max-w-prose rounded-md border border-dashed border-primary/30 bg-accent/40 px-3 py-2 text-sm leading-relaxed text-foreground/80">
              {copy.shop.writeAboutPrompt}{' '}
              <button
                type="button"
                className="press inline-flex items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline"
                onClick={() => navigate({ name: 'account' })}
              >
                <Pencil className="size-3" aria-hidden /> {copy.shop.writeAbout}
              </button>
            </p>
          ) : (
            // And no invented copy for buyers either - the honest line beats
            // a template's polished filler.
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground/85">
              {copy.listing.noStory}
            </p>
          )}
        </div>

        {/* Shop contact - the same direct links buyers get everywhere. The
            line above the buttons says WHY they exist: no middleman, no fees,
            the shop's own phone rings. The owner reads the mirror version -
            these are their incoming lines. */}
        <div className="border-t bg-secondary/40 p-4 sm:p-5">
          <p className="mb-2.5 text-xs leading-relaxed text-muted-foreground">
            {isOwner ? copy.shop.contactOwnerNote : copy.shop.contactBuyerNote}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="press h-11 flex-1 text-[15px]">
              <a href={telLink(shop.phone)} aria-label={`Call ${shop.name}`} onClick={() => trackShopEngagement('CALL_CLICK')}>
                <Phone className="size-4" aria-hidden /> {copy.common.call}
              </a>
            </Button>
            {shop.websiteUrl ? (
              <Button asChild variant="outline" className="press h-11 flex-1 text-[15px]">
                <a href={shop.websiteUrl} target="_blank" rel="noopener noreferrer" aria-label={`Visit ${shop.name}'s website`}>
                  <ExternalLink className="size-4" aria-hidden /> Visit website
                </a>
              </Button>
            ) : null}
            {whatsappNumber ? (
              <Button
                asChild
                variant="outline"
                className="press h-11 flex-1 border-emerald-600 text-[15px] text-emerald-800 hover:bg-emerald-50"
              >
                <a
                  href={whatsappLink(whatsappNumber, shop.name, 'OFFER')}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`WhatsApp ${shop.name}`}
                  onClick={() => trackShopEngagement('WHATSAPP_CLICK')}
                >
                  <WhatsAppIcon className="size-4" aria-hidden /> WhatsApp
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {/* The bridge for buyers: the code IS the address. Someone who landed
          here from a shared link can carry the shop away - copy the till-style
          code, or forward the page on WhatsApp. The owner gets the poster tool
          below instead; two QRs on one page is one too many. */}
      {!isOwner && shop.shopCode ? (
        <section aria-label="Find this shop again" className="rounded-lg border bg-card p-4 sm:p-5">
          <div className="flex items-center gap-3.5">
            <div className="flex size-16 shrink-0 items-center justify-center rounded-md border bg-white p-1.5">
              {shopUrl ? <QRCode value={shopUrl} size={48} role="img" aria-label={`QR code for ${shop.name}'s shop`} /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">{copy.shop.findAgain}</h2>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{copy.shop.findAgainHint}</p>
              <p className="mt-1 text-lg font-bold tracking-widest text-primary tabular-nums">{shop.shopCode}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              <Button variant="outline" size="sm" className="press h-8 gap-1 px-2.5 text-xs" onClick={copyShopCode}>
                {copied ? (
                  <>
                    <Check className="size-3.5 text-emerald-700" aria-hidden /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5" aria-hidden /> Copy
                  </>
                )}
              </Button>
              {shareHref ? (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="press h-8 gap-1 border-emerald-600 px-2.5 text-xs text-emerald-800 hover:bg-emerald-50"
                >
                  <a
                    href={shareHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Share ${shop.name} on WhatsApp`}
                    onClick={() => trackShopEngagement('SHARE_CLICK')}
                  >
                    <Share2 className="size-3.5" aria-hidden /> Share
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* Owner tool: the printable QR poster. Buyers never see this - they are
          already on the page. The seller prints it for the stall, a wheelbarrow
          notice or the shop window; one scan lands on this exact shop. */}
      {isOwner && shop.shopCode ? (
        <section aria-label="Your shop QR poster" className="rounded-lg border bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex size-20 shrink-0 items-center justify-center rounded-md border bg-white p-2">
              {shopUrl ? <QRCode value={shopUrl} size={64} role="img" aria-label={`QR code for ${shop.name}'s shop`} /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">{copy.shop.posterTitle}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{copy.shop.posterSub}</p>
              <p className="mt-1 text-xs text-muted-foreground">{copy.shop.posterCodeNote(shop.shopCode)}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <Button variant="outline" className="gap-1.5" onClick={() => setPosterOpen(true)}>
                <QrCode className="size-4" aria-hidden /> {copy.shop.posterShow}
              </Button>
              {shareHref ? (
                <Button asChild variant="outline" className="gap-1.5 border-emerald-600 text-emerald-800 hover:bg-emerald-50">
                  <a
                    href={shareHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Share ${shop.name} on WhatsApp`}
                  >
                    <Share2 className="size-4" aria-hidden /> Share on WhatsApp
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <PublicShopCollections shopId={shop.id} onOpenListing={(listingId) => navigate({ name: 'listing', id: listingId })} />

      <ShopShowroom shopId={shop.id} items={showroomItems ?? []} isOwner={isOwner} contactPhone={whatsappNumber} />

      {/* The catalogue - every active listing this shop runs */}
      <section aria-label="Shop catalogue" className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">{copy.shop.catalogue(shop.activeCount)}</h2>
          {/* The platform's position, in one line: we host, we never set the
              price. It reads as trust in the seller. */}
          <p className="mt-0.5 text-xs text-muted-foreground">{copy.shop.catalogueNote}</p>
        </div>

        {listings.length === 0 ? (
          <EmptyState
            title={copy.shop.emptyOwnerTitle}
            description={isOwner ? copy.shop.emptyOwnerSub : copy.shop.emptyBuyerSub}
            action={
              isOwner ? (
                <Button className="press" onClick={() => navigate({ name: 'publish' })}>
                  {copy.common.postAnAd}
                </Button>
              ) : (
                <Button variant="outline" className="press" onClick={() => navigate({ name: 'browse' })}>
                  {copy.common.browseAll}
                </Button>
              )
            }
          />
        ) : (
          // Rows on the phone, compact blocks in a grid on desktop - the
          // same card as the browse feed, so a shop feels like its own
          // corner of the same market.
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
            {listings.map((listing) => (
              <ListingBlock
                key={listing.id}
                listing={{ ...listing, user: shopOwnerFrom(shop) }}
                onOpen={(lid) => navigate({ name: 'listing', id: lid })}
                onAdd={addToBasket}
              />
            ))}
          </div>
        )}
      </section>

      {/* Shareable shop poster: real shop photos, stable QR destination and Mudaala brand assets. */}
      {posterOpen ? (
        <div className="shop-poster fixed inset-0 z-50 overflow-y-auto bg-[#f5efdf] p-3 sm:p-5" role="dialog" aria-modal="true" aria-label={'QR poster for ' + shop.name}>
          <div className="no-print mx-auto flex max-w-lg items-center justify-between pb-3">
            <p className="text-sm font-medium text-neutral-600">{copy.shop.posterHint}</p>
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setPosterOpen(false)}><ArrowLeft className="size-4" aria-hidden /> Back to shop</Button>
          </div>
          <div ref={posterRef} className="mx-auto max-w-lg overflow-hidden rounded-[1.6rem] border border-[#e7d9bb] bg-[#fbf6e9] text-neutral-950 shadow-sm">
            <header className="relative flex items-center gap-3 overflow-hidden px-5 py-4 sm:px-7">
              <span className="absolute right-0 top-0 h-24 w-36 opacity-90" style={{ backgroundImage: "url('/mudaala-african-textile.svg')", backgroundSize: 'cover', maskImage: 'linear-gradient(135deg, transparent, black 45%)' }} />
              <span className="relative size-12 shrink-0 rounded-full bg-[#10100f] p-1" style={{ backgroundImage: "url('/mudaala-african-textile.svg')", backgroundSize: 'cover' }}><img src="/logo.svg" alt="" className="size-full rounded-full border-2 border-[#f2b82e] bg-[#fbf6e9] p-1" /></span>
              <div className="relative min-w-0"><p className="font-display text-[1.75rem] font-bold leading-none tracking-tight text-[#174a35]">mudaala</p><p className="mt-1 text-xs font-semibold tracking-wide text-[#315b43]">Buy and sell near you</p></div>
            </header>
            <section className="relative mx-3 overflow-hidden rounded-[1.25rem] bg-[#d8d1c2] sm:mx-4">
              {shop.coverPhotoUrl || shop.photoUrl ? <img src={shop.coverPhotoUrl || shop.photoUrl || ''} alt={shop.name + ' shop cover'} className="h-52 w-full object-cover sm:h-64" /> : <div className="flex h-52 items-center justify-center bg-[#e9e1cf] px-8 text-center sm:h-64"><span className="font-display text-3xl font-semibold text-[#174a35]">{shop.name}</span></div>}
              <div className="absolute inset-0 bg-gradient-to-l from-black/75 via-black/25 to-transparent" />
              <div className="absolute inset-y-0 right-0 flex w-[58%] flex-col justify-center px-3 text-right sm:px-6"><p className="text-3xl font-extrabold leading-[0.95] text-white sm:text-5xl">Shop</p><p className="mt-1 inline-block text-4xl font-black leading-none text-[#ffc928] sm:text-6xl">Online</p><p className="mt-2 text-lg font-bold text-white sm:text-2xl">with Mudaala!</p><p className="mt-3 text-[10px] font-semibold tracking-wide text-white sm:text-xs">Discover <span className="text-[#ffc928]">•</span> Browse <span className="text-[#ffc928]">•</span> Buy</p></div>
            </section>
            <section className="mx-3 mt-3 grid grid-cols-1 items-center gap-3 rounded-[1.25rem] sm:grid-cols-[minmax(0,1fr)_auto] border border-[#eadfca] bg-[#fffdf7] p-3 sm:mx-4 sm:gap-5 sm:p-5">
              <div className="flex min-w-0 items-center gap-3">
                {shop.photoUrl ? <img src={shop.photoUrl} alt={shop.name + ' profile'} className="size-[4.5rem] shrink-0 rounded-full border-[3px] border-[#f2b82e] object-cover sm:size-24" /> : <div className="flex size-[4.5rem] shrink-0 items-center justify-center rounded-full border-[3px] border-[#f2b82e] bg-[#e9e1cf] font-display text-xl text-[#174a35] sm:size-24">{shop.name.slice(0, 1).toUpperCase()}</div>}
                <div className="min-w-0"><h2 className="break-words font-display text-xl font-bold leading-tight text-[#171717] sm:text-3xl">{shop.name}</h2><p className="mt-1 flex items-start gap-1 text-xs leading-snug text-neutral-700 sm:text-sm"><MapPin className="mt-0.5 size-3.5 shrink-0 text-[#174a35]" aria-hidden />{[shop.area, shop.county].filter(Boolean).join(', ') || 'Find us on Mudaala'}</p><p className="mt-2 flex items-center gap-1 text-xs font-semibold text-neutral-800 sm:text-sm"><Phone className="size-3.5 shrink-0 text-[#174a35]" aria-hidden /><span className="break-all">{formatPhonePretty(shop.phone)}</span></p></div>
              </div>
              <div className="mt-1 flex min-w-0 flex-col items-center sm:mt-0"><div className="rounded-xl bg-[#10100f] p-1.5" style={{ backgroundImage: "url('/mudaala-african-textile.svg')", backgroundSize: 'cover' }}><div className="poster-qr relative rounded-lg bg-white p-1.5">{shopUrl ? <QRCode value={shopUrl} size={112} level="H" role="img" aria-label={'QR code for ' + shop.name + "'s shop"} /> : null}<span className="absolute left-1/2 top-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#10100f] p-0.5" style={{ backgroundImage: "url('/mudaala-african-textile.svg')", backgroundSize: 'cover' }}><img src="/logo.svg" alt="" className="size-full rounded-full border-2 border-[#f2b82e]" /></span></div></div><span className="mt-1.5 rounded-full bg-[#174a35] px-2.5 py-1 text-center text-[9px] font-bold leading-tight text-white sm:text-[10px]">Scan to visit this shop</span></div>
            </section>
            <div className="mx-4 mt-3 flex items-center justify-center gap-2 text-center text-[10px] font-bold text-[#174a35] sm:gap-4 sm:text-xs"><span className="flex-1">{shop.phoneConfirmed ? '✓ Phone Confirmed' : 'Local Shop'}</span><span className="h-6 w-px bg-[#efb923]" /><span className="flex-1">◇ Quality Products</span><span className="h-6 w-px bg-[#efb923]" /><span className="flex-1">↗ Great Deals</span><span className="h-6 w-px bg-[#efb923]" /><span className="flex-1">⌖ Near You</span></div>
            <footer className="relative mt-4 overflow-hidden bg-[#174a35] px-5 pb-5 pt-4 text-center text-white"><div className="absolute inset-x-0 top-0 h-2 bg-[#f2b82e]" /><div className="pointer-events-none absolute -bottom-14 -right-10 size-36 rounded-full border-[18px] border-[#f2b82e]/90" /><p className="relative font-semibold italic text-white/90">Help others discover this shop!</p><p className="relative mt-1 text-[10px] font-semibold tracking-[0.18em] text-[#f7cf69]">{shop.shopCode}</p></footer>
          </div>
          <div className="no-print mx-auto grid max-w-lg grid-cols-2 gap-2 pt-3">
            <Button className="h-12 gap-2 bg-[#174a35] text-white hover:bg-[#103b2a]" disabled={posterSharing || !posterFileReady} onClick={async () => {
              if (!posterRef.current || !shopUrl) return
              setPosterSharing(true); trackShopEngagement('SHARE_CLICK')
              try {
                if (posterFile && navigator.share && navigator.canShare?.({ files: [posterFile] })) await navigator.share({ files: [posterFile], title: shop.name + ' on Mudaala', text: 'Discover ' + shop.name + ' on Mudaala — ' + shopUrl })
                else window.location.assign('https://wa.me/?text=' + encodeURIComponent(copy.shop.shareTextOwner(shop.name, shop.shopCode!, shopUrl)))
              } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) window.location.assign('https://wa.me/?text=' + encodeURIComponent(copy.shop.shareTextOwner(shop.name, shop.shopCode!, shopUrl))) }
              finally { setPosterSharing(false) }
            }}><WhatsAppIcon className="size-5" />{posterSharing || !posterFileReady ? 'Preparing…' : posterFile ? 'Share on WhatsApp' : 'Share shop link'}</Button>
            <Button variant="outline" className="h-12 gap-2 border-[#d4b45d] bg-[#fffdf7] text-[#174a35]" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print poster</Button>
          </div>
          <p className="no-print mx-auto max-w-lg px-2 pt-2 text-center text-[11px] text-neutral-600">On your phone, WhatsApp appears in the share sheet. Choose Status to post it for your customers.</p>
        </div>
      ) : null}


    </div>
  )
}

// Catalogue cards already sit inside the shop, so the per-card shop chip is
// redundant - attach the owner identity for the record, not for navigation.
// (The shop page has no use for coordinates; nulls keep the shape honest.)
function shopOwnerFrom(shop: ShopPageT['shop']): ListingShopOwner {
  return {
    id: shop.id,
    name: shop.name,
    profile: { businessName: shop.name, photoUrl: shop.photoUrl, area: shop.area, county: shop.county, lat: null, lng: null },
  }
}
