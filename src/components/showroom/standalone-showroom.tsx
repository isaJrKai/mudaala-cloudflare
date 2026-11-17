'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { getShowroomTemplate } from '@/lib/showroom/templates'

type Product = {
  id: string; title: string; description: string; category: string; brand: string | null
  model: string | null; price: number | null; compareAtPrice: number | null; currency: string
  priceNegotiable: boolean; availabilityStatus: string; photos: string[]
}
type Section = { heading?: string; body?: string; photoUrl?: string | null }
type Payload = {
  showroom: {
    id: string; slug: string; templateId: string; templateVersion: number; title: string
    headline: string | null; introduction: string | null; story: string | null
    logoUrl: string | null; primaryColor: string | null; accentColor: string | null
    coverPhotoUrl: string | null; photos: string[]; sections: Section[]
  }
  shop: {
    id: string; name: string; logoUrl: string | null; category: string | null
    description: string | null; area: string | null; county: string | null
    phone: string | null; whatsapp: string | null; hours: string | null
    shopCode: string | null; websiteUrl: string | null
  }
  products: Product[]
}

const surfaces: Record<string, string> = {
  paper: 'bg-[#f5f0e7] text-[#292820]', chalk: 'bg-[#f8f8f5] text-[#20221e]',
  sand: 'bg-[#e9dfcf] text-[#302c25]', ink: 'bg-[#171916] text-[#f5f0e7]',
  clay: 'bg-[#efe3d9] text-[#332820]', stone: 'bg-[#e7e6e0] text-[#252722]',
}
const accents: Record<string, string> = {
  leaf: '#47734d', mango: '#e5a52f', copper: '#a66c4c',
  cobalt: '#345d9b', terracotta: '#b76d51', mono: '#77766f',
}

function money(value: number | null, currency: string, negotiable: boolean) {
  if (value === null) return negotiable ? 'Price on enquiry' : 'Ask for price'
  return new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(value) + (currency === 'UGX' ? ' UGX' : ` ${currency}`)
}

function ProductCard({ product, layout, accent }: { product: Product; layout: string; accent: string }) {
  const image = product.photos[0]
  const wide = layout === 'spec-list' || layout === 'room-scenes'
  return (
    <a href={`/l/${encodeURIComponent(product.id)}`} className={`group block min-w-0 ${wide ? 'grid grid-cols-[minmax(104px,34%)_1fr] gap-4 border-b border-current/15 py-4' : ''}`}>
      <div className={`relative overflow-hidden bg-black/5 ${wide ? 'aspect-square' : layout === 'masonry' ? 'aspect-[4/5]' : 'aspect-[4/5]'}`}>
        {image ? <Image src={image} alt={product.title} fill unoptimized sizes="(max-width: 640px) 48vw, 25vw" className="object-cover transition-transform duration-700 group-hover:scale-[1.035]" /> : <div className="absolute inset-0 grid place-items-center text-xs opacity-50">Photo not supplied</div>}
      </div>
      <div className={wide ? 'self-center py-2' : 'pt-3'}>
        <p className="text-[10px] uppercase tracking-[.18em] opacity-55">{product.brand || product.category}</p>
        <h3 className="mt-1 text-sm font-medium leading-snug">{product.title}</h3>
        <p className="mt-2 text-xs font-semibold" style={{ color: accent }}>{money(product.price, product.currency, product.priceNegotiable)}</p>
        {product.availabilityStatus === 'OUT_OF_STOCK' && <p className="mt-1 text-[10px] uppercase tracking-wider opacity-55">Currently unavailable</p>}
      </div>
    </a>
  )
}

export function StandaloneShowroom({ slug, preview = false }: { slug: string; preview?: boolean }) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    fetch(`/api/showrooms/public/${encodeURIComponent(slug)}${preview ? '?preview=1' : ''}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('not found')
        return response.json() as Promise<Payload>
      })
      .then((data) => { if (active) setPayload(data) })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [slug])

  const template = useMemo(() => payload ? getShowroomTemplate(payload.showroom.templateId) : undefined, [payload])
  if (loading) return <main className="min-h-screen animate-pulse bg-[#f5f0e7] p-6"><div className="mx-auto max-w-6xl"><div className="h-5 w-32 bg-black/10" /><div className="mt-16 h-[42vh] bg-black/10" /><div className="mt-10 h-5 w-1/3 bg-black/10" /></div></main>
  if (error || !payload || !template) return <main className="grid min-h-screen place-items-center bg-[#f5f0e7] px-6 text-center text-[#292820]"><div><p className="text-xs uppercase tracking-[.2em] opacity-60">Mudaala showroom</p><h1 className="mt-4 text-3xl font-semibold">This showroom is unavailable</h1><p className="mt-3 text-sm opacity-70">The shop may have unpublished this page or changed its address.</p><a href="/" className="mt-7 inline-block border-b border-current pb-1 text-sm">Explore Mudaala</a></div></main>

  const { showroom, shop, products } = payload
  const primary = showroom.primaryColor || accents[template.accent] || '#47734d'\n  const accent = showroom.accentColor || accents[template.accent] || primary
  const surface = surfaces[template.surface] || surfaces.paper
  const heroPhoto = showroom.coverPhotoUrl || showroom.photos[0] || null
  const whatsapp = (shop.whatsapp || shop.phone || '').replace(/\D/g, '')
  const heroSplit = ['split-editorial', 'product-stage', 'type-led', 'catalogue'].includes(template.hero)
  const titleClass = template.id === 'street-uniform' || template.id === 'new-wave'
    ? 'text-5xl font-black uppercase leading-[.88] tracking-[-.06em] sm:text-7xl'
    : template.id === 'maison-noir' || template.id === 'small-treasures'
      ? 'font-serif text-5xl font-normal leading-[.98] sm:text-7xl'
      : 'text-4xl font-semibold leading-[.98] tracking-[-.045em] sm:text-6xl'
  const gridClass = template.productLayout === 'spec-list' || template.productLayout === 'room-scenes'
    ? 'grid grid-cols-1 gap-x-8 sm:grid-cols-2'
    : template.productLayout === 'masonry'
      ? 'columns-2 gap-4 space-y-5 sm:columns-3 lg:columns-4'
      : template.productLayout === 'collection-rail'
        ? 'flex snap-x gap-4 overflow-x-auto pb-5'
        : 'grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4'

  return (
    <main className={`min-h-screen ${surface}`} style={{ '--showroom-accent': accent } as CSSProperties}>
      <header className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-5 sm:px-10">
        <a href="#top" className="flex min-w-0 items-center gap-3">
          {showroom.logoUrl || shop.logoUrl ? <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full"><Image src={showroom.logoUrl || shop.logoUrl!} alt="" fill unoptimized sizes="40px" className="object-cover" /></span> : null}
          <span className="min-w-0"><span className="block truncate text-sm font-semibold tracking-tight">{shop.name}</span><span className="mt-0.5 block text-[9px] uppercase tracking-[.18em] opacity-55">{shop.area || shop.county || shop.category || 'Independent shop'}</span></span>
        </a>
        <nav className="flex items-center gap-4 text-[11px] sm:gap-7 sm:text-xs">
          <a href="#collection" className="opacity-75 hover:opacity-100">Collection</a>
          <a href="#about" className="hidden opacity-75 hover:opacity-100 sm:inline">About</a>
          <a href={whatsapp ? `https://wa.me/${whatsapp}` : `tel:${shop.phone || ''}`} target="_blank" rel="noreferrer" className="border-b pb-1 font-semibold" style={{ borderColor: accent }}>Contact</a>
        </nav>
      </header>

      <section id="top" className="mx-auto max-w-[1440px] px-5 pb-14 pt-5 sm:px-10 sm:pb-24 sm:pt-12">
        {template.hero === 'catalogue' ? (
          <div className="grid gap-8 border-y border-current/15 py-10 md:grid-cols-[1fr_1.1fr] md:items-end">
            <div><p className="text-[10px] uppercase tracking-[.22em] opacity-55">{template.name}</p><h1 className={`mt-5 max-w-3xl ${titleClass}`}>{showroom.headline || showroom.title}</h1></div>
            <div className="md:justify-self-end md:max-w-md"><p className="text-sm leading-7 opacity-70">{showroom.introduction || shop.description}</p><p className="mt-5 text-xs opacity-50">{products.length} selected {products.length === 1 ? 'product' : 'products'}</p></div>
          </div>
        ) : (
          <div className={heroSplit ? 'grid gap-8 md:grid-cols-[.85fr_1.15fr] md:items-center md:gap-14' : 'grid gap-8'}>
            <div className={template.hero === 'full-bleed' ? 'order-2' : ''}>
              <p className="text-[10px] uppercase tracking-[.22em] opacity-55">{template.name} <span className="px-2">/</span> {shop.category || 'Shop'}</p>
              <h1 className={`mt-6 max-w-4xl ${titleClass}`}>{showroom.headline || showroom.title}</h1>
              {showroom.introduction && <p className="mt-6 max-w-xl text-sm leading-7 opacity-70 sm:text-base">{showroom.introduction}</p>}
              <a href="#collection" className="mt-8 inline-flex items-center gap-3 border-b pb-2 text-xs font-semibold" style={{ borderColor: accent }}>Explore the collection <span aria-hidden="true">↗</span></a>
            </div>
            {heroPhoto && <div className={`relative overflow-hidden bg-black/5 ${template.hero === 'full-bleed' ? 'aspect-[16/8]' : template.hero === 'product-stage' ? 'aspect-[4/5] md:aspect-[5/6]' : 'aspect-[5/4]'}`}><Image src={heroPhoto} alt={showroom.title} fill priority unoptimized sizes="(max-width: 768px) 100vw, 60vw" className="object-cover" /></div>}
          </div>
        )}
        {template.hero === 'full-bleed' && <p className="mt-4 text-[10px] uppercase tracking-[.18em] opacity-50">{shop.name} · {shop.area || shop.county || 'Uganda'}</p>}
      </section>

      {showroom.photos.length > 1 && <section className="mx-auto grid max-w-[1440px] grid-cols-2 gap-2 px-5 pb-16 sm:grid-cols-3 sm:gap-4 sm:px-10">{showroom.photos.slice(1, 4).map((photo, index) => <div key={photo} className={`relative overflow-hidden bg-black/5 ${index === 0 ? 'aspect-[4/5]' : 'aspect-[4/5]'}`}><Image src={photo} alt={`${shop.name} showroom photograph ${index + 2}`} fill unoptimized sizes="33vw" className="object-cover" /></div>)}</section>}

      {showroom.sections.map((section, index) => <section key={index} className="mx-auto grid max-w-[1440px] gap-5 border-t border-current/15 px-5 py-12 sm:grid-cols-[.7fr_1.3fr] sm:px-10 sm:py-16">{section.photoUrl && <div className="relative aspect-[5/4] overflow-hidden"><Image src={section.photoUrl} alt={section.heading || shop.name} fill unoptimized sizes="50vw" className="object-cover" /></div>}<div className="self-center"><p className="text-[10px] uppercase tracking-[.2em] opacity-50">0{index + 1}</p>{section.heading && <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl">{section.heading}</h2>}{section.body && <p className="mt-4 max-w-2xl whitespace-pre-line text-sm leading-7 opacity-70">{section.body}</p>}</div></section>)}

      <section id="collection" className="mx-auto max-w-[1440px] px-5 py-14 sm:px-10 sm:py-20">
        <div className="mb-8 flex items-end justify-between gap-4 border-b border-current/20 pb-5 sm:mb-12">
          <div><p className="text-[10px] uppercase tracking-[.2em] opacity-50">Selected for you</p><h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">{showroom.title}</h2></div>
          <p className="text-right text-[10px] uppercase tracking-[.14em] opacity-50">{products.length} items</p>
        </div>
        {products.length ? <div className={gridClass}>{products.map((product) => <div key={product.id} className={template.productLayout === 'masonry' ? 'mb-5 break-inside-avoid' : template.productLayout === 'collection-rail' ? 'w-[72vw] shrink-0 snap-start sm:w-[32vw]' : ''}><ProductCard product={product} layout={template.productLayout} accent={accent} /></div>)}</div> : <p className="py-16 text-center text-sm opacity-60">The shop is preparing its collection. Contact the seller to ask what is available.</p>}
      </section>

      {(showroom.story || shop.description) && <section id="about" className="border-y border-current/15 px-5 py-16 sm:px-10 sm:py-24"><div className="mx-auto max-w-3xl"><p className="text-[10px] uppercase tracking-[.2em] opacity-50">A little about us</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">{shop.name}</h2><p className="mt-6 whitespace-pre-line text-sm leading-8 opacity-75 sm:text-base">{showroom.story || shop.description}</p></div></section>}

      <footer className="mx-auto max-w-[1440px] px-5 py-12 sm:px-10 sm:py-16">
        <div className="grid gap-10 sm:grid-cols-2 sm:items-end">
          <div><p className="text-[10px] uppercase tracking-[.2em] opacity-50">Visit or get in touch</p><h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{shop.name}</h2><p className="mt-3 text-sm opacity-65">{[shop.area, shop.county].filter(Boolean).join(', ')}</p>{shop.hours && <p className="mt-2 text-xs opacity-55">{shop.hours}</p>}{shop.shopCode && <p className="mt-4 text-[10px] uppercase tracking-[.18em] opacity-50">Mudaala shop code · {shop.shopCode}</p>}</div>
          <div className="flex flex-wrap gap-3 sm:justify-end">{whatsapp && <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" className="px-5 py-3 text-xs font-semibold" style={{ backgroundColor: primary, color: '#fff' }}>WhatsApp the shop ↗</a>}{shop.phone && <a href={`tel:${shop.phone}`} className="border border-current/25 px-5 py-3 text-xs font-semibold">Call the shop</a>}{shop.websiteUrl && <a href={shop.websiteUrl} target="_blank" rel="noreferrer" className="border border-current/25 px-5 py-3 text-xs font-semibold">Website ↗</a>}</div>
        </div>
        <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-current/15 pt-5 text-[10px] opacity-45"><span>{shop.name} · {template.name}</span><span>Independent shop on Mudaala</span></div>
      </footer>
    </main>
  )
}
