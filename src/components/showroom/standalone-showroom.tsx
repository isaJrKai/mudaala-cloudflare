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

const templateHeroClasses: Record<string, string> = {
  'atelier-edit': 'grid gap-8 md:grid-cols-[.72fr_1.28fr] md:items-end md:gap-16',
  'the-collection': 'grid gap-5 md:grid-cols-[1fr_1fr] md:items-start',
  'object-study': 'grid gap-8 md:grid-cols-[.55fr_1.45fr] md:items-center',
  'daily-goods': 'grid gap-6 border-y border-current/15 py-8 md:grid-cols-[1fr_.8fr] md:items-end',
  'maison-noir': 'grid gap-10 md:grid-cols-[.8fr_1.2fr] md:items-center',
  'new-wave': 'grid gap-5 md:grid-cols-[1.25fr_.75fr] md:items-end',
  'the-brand-story': 'grid gap-8 md:grid-cols-[.9fr_1.1fr] md:items-center',
  'market-day': 'grid gap-5 md:grid-cols-[1fr_1fr] md:items-stretch',
  'skin-notes': 'grid gap-8 md:grid-cols-[.8fr_1.2fr] md:items-center',
  'street-uniform': 'grid gap-4 md:grid-cols-[1.35fr_.65fr] md:items-end',
  'tech-index': 'grid gap-6 border-y border-current/20 py-8 md:grid-cols-[1.1fr_.9fr] md:items-end',
  'living-spaces': 'grid gap-6 md:grid-cols-1',
  'small-treasures': 'grid gap-8 md:grid-cols-[.65fr_1.35fr] md:items-center',
  'form-and-function': 'grid gap-7 md:grid-cols-[1fr_1fr] md:items-center',
  'home-rituals': 'grid gap-8 md:grid-cols-[1.1fr_.9fr] md:items-end',
  'the-pantry': 'grid gap-6 md:grid-cols-[.85fr_1.15fr] md:items-center',
  'made-by-hand': 'mx-auto grid max-w-5xl gap-8 text-center md:grid-cols-[.8fr_1.2fr] md:items-center',
  'the-footnote': 'grid gap-7 md:grid-cols-[.9fr_1.1fr] md:items-end',
  'the-studio-shop': 'grid gap-6 md:grid-cols-[1fr_1fr] md:items-center',
  'open-shelf': 'grid gap-6 border-y border-current/15 py-8 md:grid-cols-[1fr_1fr] md:items-end',
}

const templateGridClasses: Record<string, string> = {
  'atelier-edit': 'grid grid-cols-2 gap-x-5 gap-y-12 sm:grid-cols-3 sm:gap-x-8 lg:grid-cols-4',
  'the-collection': 'grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-10',
  'object-study': 'grid grid-cols-2 gap-5 sm:grid-cols-3 sm:gap-8',
  'daily-goods': 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4',
  'maison-noir': 'grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-8',
  'new-wave': 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5',
  'the-brand-story': 'grid grid-cols-1 gap-10 sm:grid-cols-2 sm:gap-12',
  'market-day': 'columns-2 gap-3 space-y-4 sm:columns-3 sm:gap-5',
  'skin-notes': 'grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-7',
  'street-uniform': 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5',
  'tech-index': 'grid grid-cols-1 gap-0 sm:grid-cols-2 sm:gap-x-8',
  'living-spaces': 'grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-10',
  'small-treasures': 'grid grid-cols-2 gap-5 sm:grid-cols-3 sm:gap-8',
  'form-and-function': 'grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-7',
  'home-rituals': 'grid grid-cols-1 gap-7 sm:grid-cols-2 sm:gap-10',
  'the-pantry': 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5',
  'made-by-hand': 'grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-12',
  'the-footnote': 'grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 sm:gap-8',
  'the-studio-shop': 'grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6',
  'open-shelf': 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4',
}

const templateHeaderClasses: Record<string, string> = {
  'atelier-edit': 'border-b border-current/15 py-7',
  'maison-noir': 'border-b border-current/20 py-8',
  'new-wave': 'border-b-2 border-current py-4',
  'street-uniform': 'border-b-2 border-current py-4 uppercase',
  'tech-index': 'border-b border-current/25 font-mono',
  'the-pantry': 'border-b border-current/20 py-6',
  'made-by-hand': 'border-b border-dashed border-current/30 py-7',
  'the-footnote': 'border-b border-current/15 py-8',
}

function money(value: number | null, currency: string, negotiable: boolean) {
  if (value === null) return negotiable ? 'Price on enquiry' : 'Ask for price'
  return new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(value) + (currency === 'UGX' ? ' UGX' : ` ${currency}`)
}

function ProductCard({ product, layout, accent, templateId }: { product: Product; layout: string; accent: string; templateId: string }) {
  const image = product.photos[0]
  const wide = layout === 'spec-list' || layout === 'room-scenes' || layout === 'market-table'
  const imageRatios: Record<string, string> = {
    'atelier-edit': 'aspect-[3/4]', 'the-collection': 'aspect-[4/5]', 'object-study': 'aspect-square',
    'daily-goods': 'aspect-[4/5]', 'maison-noir': 'aspect-[5/6]', 'new-wave': 'aspect-[4/5]',
    'the-brand-story': 'aspect-[5/4]', 'market-day': 'aspect-[4/5]', 'skin-notes': 'aspect-square',
    'street-uniform': 'aspect-[3/4]', 'tech-index': 'aspect-square', 'living-spaces': 'aspect-[5/4]',
    'small-treasures': 'aspect-square', 'form-and-function': 'aspect-[4/5]', 'home-rituals': 'aspect-[5/4]',
    'the-pantry': 'aspect-[4/5]', 'made-by-hand': 'aspect-[5/4]', 'the-footnote': 'aspect-[3/4]',
    'the-studio-shop': 'aspect-[4/5]', 'open-shelf': 'aspect-[4/5]',
  }
  const imageRatio = imageRatios[templateId] || 'aspect-[4/5]'
  const titleStyle = templateId === 'tech-index' ? 'font-mono' : ['atelier-edit','the-collection','maison-noir','skin-notes','living-spaces','small-treasures','home-rituals','the-pantry','made-by-hand','the-footnote'].includes(templateId) ? 'font-serif' : 'font-medium'
  return (
    <a href={`/l/${encodeURIComponent(product.id)}`} className={`group block min-w-0 ${wide ? 'grid grid-cols-[minmax(104px,34%)_1fr] gap-4 border-b border-current/15 py-4' : ''} ${templateId === 'market-day' ? 'rounded-xl border border-current/15 p-2 sm:p-3' : ''} ${templateId === 'object-study' ? 'border-b border-current/20 pb-5' : ''}`}>
      <div className={`relative overflow-hidden bg-black/5 ${wide ? 'aspect-square' : imageRatio} ${templateId === 'small-treasures' ? 'rounded-full' : templateId === 'skin-notes' ? 'rounded-[42%_42%_8px_8px]' : templateId === 'daily-goods' || templateId === 'open-shelf' ? 'rounded-md' : ''}`}>
        {image ? <Image src={image} alt={product.title} fill unoptimized sizes="(max-width: 640px) 48vw, 25vw" className="object-cover transition-transform duration-700 group-hover:scale-[1.035]" /> : <div className="absolute inset-0 grid place-items-center text-xs opacity-85">Photo not supplied</div>}
      </div>
      <div className={wide ? 'self-center py-2' : 'pt-3'}>
        <p className="text-[10px] uppercase tracking-[.18em] opacity-85">{product.brand || product.category}</p>
        <h3 className={`mt-1 text-sm leading-snug ${titleStyle}`}>{product.title}</h3>
        {product.description && <p className="mt-2 line-clamp-3 text-xs leading-5 opacity-80">{product.description}</p>}
        <p className="mt-2 text-xs font-semibold" style={{ color: accent }}>{money(product.price, product.currency, product.priceNegotiable)}</p>
        {product.availabilityStatus === 'OUT_OF_STOCK' && <p className="mt-1 text-[10px] uppercase tracking-wider opacity-85">Currently unavailable</p>}
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

  const template = useMemo(() => payload ? getShowroomTemplate(payload.showroom.templateId, payload.showroom.templateVersion) : undefined, [payload])
  if (loading) return <main className="min-h-screen animate-pulse bg-[#f5f0e7] p-6"><div className="mx-auto max-w-6xl"><div className="h-5 w-32 bg-black/10" /><div className="mt-16 h-[42vh] bg-black/10" /><div className="mt-10 h-5 w-1/3 bg-black/10" /></div></main>
  if (error || !payload || !template) return <main className="grid min-h-screen place-items-center bg-[#f5f0e7] px-6 text-center text-[#292820]"><div><p className="text-xs uppercase tracking-[.2em] opacity-80">Mudaala showroom</p><h1 className="mt-4 text-3xl font-semibold">This showroom is unavailable</h1><p className="mt-3 text-sm opacity-85">The shop may have unpublished this page or changed its address.</p><a href="/" className="mt-7 inline-block border-b border-current pb-1 text-sm">Explore Mudaala</a></div></main>

  const { showroom, shop, products } = payload
  const primary = showroom.primaryColor || accents[template.accent] || '#47734d'
  const accent = showroom.accentColor || accents[template.accent] || primary
  const surface = surfaces[template.surface] || surfaces.paper
  const heroPhoto = showroom.coverPhotoUrl || showroom.photos[0] || null
  const galleryPhotos = showroom.coverPhotoUrl ? showroom.photos.slice(0, 3) : showroom.photos.slice(1, 4)
  const contactNumber = (shop.whatsapp || shop.phone || '').replace(/\\D/g, '')
  const heroLayoutClass: Record<string, string> = {
    'cover-story': 'grid gap-8 md:grid-cols-[1.05fr_.95fr] md:items-end',
    'full-bleed': 'grid gap-6',
    'split-editorial': 'grid gap-8 md:grid-cols-[.85fr_1.15fr] md:items-center md:gap-14',
    'product-stage': 'grid gap-8 md:grid-cols-[.7fr_1.3fr] md:items-center md:gap-16',
    'type-led': 'grid gap-8 md:grid-cols-[1fr_.7fr] md:items-end',
    'lookbook': 'grid gap-5',
    'catalogue': 'grid gap-8 md:grid-cols-[1fr_1.1fr] md:items-end',
    'brand-film': 'grid gap-5',
    'campaign': 'grid gap-8 md:grid-cols-[1.2fr_.8fr] md:items-center',
    'manifesto': 'mx-auto grid max-w-4xl gap-8 text-center',
  }
  const titleStyles: Record<string, string> = {
    'atelier-edit': 'font-serif text-5xl font-normal leading-[.9] tracking-[-.055em] sm:text-7xl',
    'the-collection': 'font-serif text-5xl font-normal leading-[.98] sm:text-7xl',
    'object-study': 'text-5xl font-medium leading-[.9] tracking-[-.06em] sm:text-8xl',
    'daily-goods': 'text-4xl font-semibold leading-[1.02] tracking-[-.045em] sm:text-6xl',
    'maison-noir': 'font-serif text-5xl font-normal leading-[.98] tracking-[-.04em] sm:text-7xl',
    'new-wave': 'text-5xl font-black uppercase leading-[.82] tracking-[-.07em] sm:text-8xl',
    'the-brand-story': 'font-serif text-5xl font-normal leading-[1.02] sm:text-7xl',
    'market-day': 'text-5xl font-black uppercase leading-[.84] tracking-[-.065em] sm:text-8xl',
    'skin-notes': 'font-serif text-5xl font-normal leading-[1.04] sm:text-7xl',
    'street-uniform': 'text-5xl font-black uppercase leading-[.82] tracking-[-.07em] sm:text-8xl',
    'tech-index': 'font-mono text-4xl font-semibold leading-[.98] tracking-[-.06em] sm:text-6xl',
    'living-spaces': 'font-serif text-5xl font-normal leading-[.96] tracking-[-.04em] sm:text-7xl',
    'small-treasures': 'font-serif text-5xl font-normal leading-[.98] sm:text-7xl',
    'form-and-function': 'text-5xl font-semibold leading-[.88] tracking-[-.06em] sm:text-7xl',
    'home-rituals': 'font-serif text-5xl font-normal leading-[1.02] sm:text-7xl',
    'the-pantry': 'font-serif text-5xl font-semibold leading-[.94] sm:text-7xl',
    'made-by-hand': 'font-serif text-5xl font-normal italic leading-[1.02] sm:text-7xl',
    'the-footnote': 'font-serif text-5xl font-normal leading-[.9] tracking-[-.05em] sm:text-7xl',
    'the-studio-shop': 'text-5xl font-semibold leading-[.92] tracking-[-.055em] sm:text-7xl',
    'open-shelf': 'text-4xl font-semibold leading-[1.02] tracking-[-.04em] sm:text-6xl',
  }
  const titleClass = titleStyles[template.id] || 'text-4xl font-semibold leading-[.98] tracking-[-.045em] sm:text-6xl'
  const heroImageStyles: Record<string, string> = {
    'atelier-edit': 'aspect-[5/6] md:aspect-[4/5]',
    'the-collection': 'aspect-[16/8]',
    'object-study': 'aspect-[1/1] md:aspect-[5/6]',
    'daily-goods': 'aspect-[5/4]',
    'maison-noir': 'aspect-[4/5]',
    'new-wave': 'aspect-[5/4]',
    'the-brand-story': 'aspect-[16/9]',
    'market-day': 'aspect-[5/4]',
    'skin-notes': 'aspect-[4/5]',
    'street-uniform': 'aspect-[16/9]',
    'tech-index': 'aspect-square',
    'living-spaces': 'aspect-[16/9]',
    'small-treasures': 'aspect-square',
    'form-and-function': 'aspect-[5/4]',
    'home-rituals': 'aspect-[16/10]',
    'the-pantry': 'aspect-[5/4]',
    'made-by-hand': 'aspect-[16/9]',
    'the-footnote': 'aspect-[4/5]',
    'the-studio-shop': 'aspect-[5/4]',
    'open-shelf': 'aspect-[5/4]',
  }
  const gridClass = templateGridClasses[template.id] || (template.productLayout === 'spec-list' || template.productLayout === 'room-scenes' || template.productLayout === 'market-table'
      ? 'grid grid-cols-1 gap-x-8 sm:grid-cols-2'
      : template.productLayout === 'masonry'
        ? 'columns-2 gap-4 space-y-5 sm:columns-3 lg:columns-4'
        : template.productLayout === 'collection-rail'
          ? 'flex snap-x gap-4 overflow-x-auto pb-5'
          : template.productLayout === 'story-cards' || template.productLayout === 'lookbook'
            ? 'grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 sm:gap-x-10'
            : template.productLayout === 'feature-and-grid'
              ? 'grid grid-cols-2 gap-4 sm:gap-6'
              : 'grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4')

  return (
    <main className={`min-h-screen ${surface}`} style={{ '--showroom-accent': accent } as CSSProperties}>
      <header className={`sticky top-0 z-40 border-b border-current/15 bg-inherit/95 backdrop-blur-md ${templateHeaderClasses[template.id] || ''}`}>
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-3 sm:px-10 sm:py-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-5">
            <a href="/" aria-label="Back to Mudaala marketplace" className="shrink-0 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
              <Image src="/logo.svg" alt="Mudaala" width={142} height={44} priority className="h-8 w-auto object-contain sm:h-9" />
            </a>
            <span aria-hidden="true" className="h-8 w-px shrink-0 bg-current/20" />
            <a href="#top" className="flex min-w-0 items-center gap-2">
              {showroom.logoUrl || shop.logoUrl ? <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full"><Image src={showroom.logoUrl || shop.logoUrl!} alt="" fill unoptimized sizes="32px" className="object-cover" /></span> : null}
              <span className="min-w-0"><span className="block max-w-[34vw] truncate text-xs font-semibold tracking-tight sm:max-w-none sm:text-sm">{shop.name}</span><span className="mt-0.5 block truncate text-[9px] font-medium uppercase tracking-[.12em] opacity-85">{shop.area || shop.county || shop.category || 'Independent shop'}</span></span>
            </a>
          </div>
          <nav aria-label="Showroom navigation" className="flex shrink-0 items-center gap-3 text-[10px] font-semibold sm:gap-6 sm:text-xs">
            <a href="/" className="hidden rounded-sm border border-current/25 px-3 py-2 transition-colors hover:bg-current/5 sm:inline-flex">Back to Mudaala</a>
            <a href="#collection" className="rounded-sm py-2 underline-offset-4 hover:underline">Products</a>
            <a href="#about" className="hidden rounded-sm py-2 underline-offset-4 hover:underline sm:inline">About</a>
            <a href="#contact" className="rounded-sm bg-[#0F3D2E] px-3 py-2 text-white transition-colors hover:bg-[#18543F] sm:px-4">Contact</a>
          </nav>
        </div>
        <div className="flex items-center justify-center border-t border-current/10 px-4 py-1.5 sm:hidden">
          <a href="/" className="text-[10px] font-semibold underline underline-offset-4">← Back to Mudaala marketplace</a>
          <span className="mx-3 h-3 w-px bg-current/25" />
          <a href="#about" className="text-[10px] font-semibold underline underline-offset-4">Discover this shop</a>
        </div>
      </header>

      <section id="top" className="mx-auto max-w-[1440px] px-5 pb-14 pt-5 sm:px-10 sm:pb-24 sm:pt-12">
        {template.hero === 'catalogue' ? (
          <div className="grid gap-8 border-y border-current/15 py-10 md:grid-cols-[1fr_1.1fr] md:items-end">
            <div><p className="text-[10px] uppercase tracking-[.22em] opacity-85">{template.name}</p><h1 className={`mt-5 max-w-3xl ${titleClass}`}>{showroom.headline || showroom.title}</h1></div>
            <div className="md:justify-self-end md:max-w-md"><p className="text-sm leading-7 opacity-85">{showroom.introduction || shop.description}</p><p className="mt-5 text-xs opacity-85">{products.length} selected {products.length === 1 ? 'product' : 'products'}</p></div>
          </div>
        ) : (
          <div className={`${templateHeroClasses[template.id] || heroLayoutClass[template.hero] || 'grid gap-8'} ${template.id === 'manifesto' ? 'py-8 sm:py-12' : ''} ${template.id === 'tech-index' ? 'border-y border-current/20 py-8' : ''} ${template.id === 'market-day' ? 'items-stretch' : ''}`}>
            <div className={template.hero === 'full-bleed' ? 'order-2' : ''}>
              <p className="text-[10px] uppercase tracking-[.22em] opacity-85">{template.name} <span className="px-2">/</span> {shop.category || 'Shop'}</p>
              <h1 className={`mt-6 max-w-4xl ${titleClass}`}>{showroom.headline || showroom.title}</h1>
              {showroom.introduction && <p className="mt-6 max-w-xl text-sm leading-7 opacity-85 sm:text-base">{showroom.introduction}</p>}
              <a href="#collection" className="mt-8 inline-flex items-center gap-3 border-b pb-2 text-xs font-semibold" style={{ borderColor: accent }}>Explore the collection <span aria-hidden="true">↗</span></a>
            </div>
            {heroPhoto && <div className={`relative overflow-hidden bg-black/5 ${heroImageStyles[template.id] || 'aspect-[5/4]'} ${template.id === 'street-uniform' || template.id === 'new-wave' ? 'ring-1 ring-current/20' : ''}`}><Image src={heroPhoto} alt={showroom.title} fill priority unoptimized sizes="(max-width: 768px) 100vw, 60vw" className="object-cover" /></div>}
          </div>
        )}
        {template.hero === 'full-bleed' && <p className="mt-4 text-[10px] uppercase tracking-[.18em] opacity-85">{shop.name} · {shop.area || shop.county || 'Uganda'}</p>}
      </section>

      {galleryPhotos.length > 0 && <section className="mx-auto grid max-w-[1440px] grid-cols-2 gap-2 px-5 pb-16 sm:grid-cols-3 sm:gap-4 sm:px-10">{galleryPhotos.map((photo, index) => <div key={photo} className={`relative overflow-hidden bg-black/5 ${index === 0 ? 'aspect-[4/5]' : 'aspect-[4/5]'}`}><Image src={photo} alt={`${shop.name} showroom photograph ${index + 2}`} fill unoptimized sizes="33vw" className="object-cover" /></div>)}</section>}

      {showroom.sections.map((section, index) => <section key={index} className="mx-auto grid max-w-[1440px] gap-5 border-t border-current/15 px-5 py-12 sm:grid-cols-[.7fr_1.3fr] sm:px-10 sm:py-16">{section.photoUrl && <div className="relative aspect-[5/4] overflow-hidden"><Image src={section.photoUrl} alt={section.heading || shop.name} fill unoptimized sizes="50vw" className="object-cover" /></div>}<div className="self-center"><p className="text-[10px] uppercase tracking-[.2em] opacity-85">0{index + 1}</p>{section.heading && <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl">{section.heading}</h2>}{section.body && <p className="mt-4 max-w-2xl whitespace-pre-line text-sm leading-7 opacity-85">{section.body}</p>}</div></section>)}

      <section id="collection" className="mx-auto max-w-[1440px] px-5 py-14 sm:px-10 sm:py-20">
        <div className="mb-8 flex items-end justify-between gap-4 border-b border-current/20 pb-5 sm:mb-12">
          <div><p className="text-[10px] uppercase tracking-[.2em] opacity-85">Selected for you</p><h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">{showroom.title}</h2></div>
          <p className="text-right text-[10px] uppercase tracking-[.14em] opacity-85">{products.length} items</p>
        </div>
        {products.length ? <div className={gridClass}>{products.map((product, index) => <div key={product.id} className={template.productLayout === 'masonry' ? 'mb-5 break-inside-avoid' : template.productLayout === 'collection-rail' ? 'w-[72vw] shrink-0 snap-start sm:w-[32vw]' : template.productLayout === 'feature-and-grid' && index === 0 ? 'col-span-2' : ''}><ProductCard product={product} layout={template.productLayout} accent={accent} templateId={template.id} /></div>)}</div> : <p className="py-16 text-center text-sm opacity-80">The shop is preparing its collection. Check back for products you can enquire about directly on Mudaala.</p>}
      </section>

      {(showroom.story || shop.description) && <section id="about" className="border-y border-current/15 px-5 py-16 sm:px-10 sm:py-24"><div className="mx-auto max-w-3xl"><p className="text-[10px] uppercase tracking-[.2em] opacity-85">A little about us</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">{shop.name}</h2><p className="mt-6 whitespace-pre-line text-sm leading-8 opacity-85 sm:text-base">{showroom.story || shop.description}</p></div></section>}

      <footer id="contact" className="mx-auto max-w-[1440px] px-5 py-12 sm:px-10 sm:py-16">
        <div className="grid gap-10 sm:grid-cols-2 sm:items-end">
          <div><p className="text-[10px] uppercase tracking-[.2em] opacity-85">Continue on Mudaala</p><h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{shop.name}</h2><p className="mt-3 text-sm opacity-80">{[shop.area, shop.county].filter(Boolean).join(', ')}</p>{shop.hours && <p className="mt-2 text-xs opacity-85">{shop.hours}</p>}{shop.shopCode && <p className="mt-4 text-[10px] uppercase tracking-[.18em] opacity-85">Mudaala shop code · {shop.shopCode}</p>}</div>
          <div className="flex flex-wrap gap-3 sm:justify-end">{shop.websiteUrl && <a href={shop.websiteUrl} target="_blank" rel="noreferrer" className="border border-current/30 px-5 py-3 text-xs font-semibold">Website ↗</a>}{contactNumber && <a href={`https://wa.me/${contactNumber}`} target="_blank" rel="noreferrer" className="border border-current/30 px-5 py-3 text-xs font-semibold">WhatsApp shop ↗</a>}<a href="#collection" className="px-5 py-3 text-xs font-semibold" style={{ backgroundColor: primary, color: '#fff' }}>Explore products</a></div>
        </div>
        <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-current/15 pt-5 text-[10px] opacity-85"><span>{shop.name} · {template.name}</span><span>Independent shop on Mudaala</span></div>
      </footer>
    </main>
  )
}
