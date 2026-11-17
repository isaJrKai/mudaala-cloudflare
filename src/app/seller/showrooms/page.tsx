'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/client'
import { SHOWROOM_TEMPLATES, type ShowroomTemplate } from '@/lib/showroom/templates'

type Product = { id: string; title: string; category: string; price: number | null; currency: string; photos: string[] }
type Existing = { id: string; slug: string; title: string; templateId: string; status: string; updatedAt: string; headline?: string | null; introduction?: string | null; story?: string | null; logoUrl?: string | null; primaryColor?: string | null; accentColor?: string | null; coverPhotoUrl?: string | null; photos?: string[]; sections?: Array<{ heading?: string; body?: string }>; listingIds?: string[] }
type Upload = { url: string }
type ApiResponse = { showrooms: Existing[] }
type ProductResponse = { products: Product[] }

const surface: Record<string, string> = {
  paper: 'bg-[#f2ece1]', chalk: 'bg-[#f7f7f3]', sand: 'bg-[#e8dece]',
  ink: 'bg-[#1c1d19] text-white', clay: 'bg-[#eee0d5]', stone: 'bg-[#e5e4dd]',
}
const accent: Record<string, string> = {
  leaf: '#47734d', mango: '#dfa02c', copper: '#a66c4c',
  cobalt: '#345d9b', terracotta: '#b76d51', mono: '#77766f',
}

const previewLayouts: Record<string, string[]> = {
  'atelier-edit': ['col-span-4 row-span-3', 'col-span-2 row-span-2', 'col-span-2 row-span-1', 'col-span-2 row-span-1'],
  'the-collection': ['col-span-3 row-span-3', 'col-span-3 row-span-2', 'col-span-3 row-span-1', 'col-span-3 row-span-1'],
  'object-study': ['col-span-6 row-span-3', 'col-span-2 row-span-1', 'col-span-2 row-span-1', 'col-span-2 row-span-1'],
  'daily-goods': ['col-span-2 row-span-2', 'col-span-2 row-span-2', 'col-span-2 row-span-2', 'col-span-3 row-span-1'],
  'maison-noir': ['col-span-3 row-span-3', 'col-span-3 row-span-3', 'col-span-2 row-span-1', 'col-span-2 row-span-1'],
  'new-wave': ['col-span-4 row-span-2', 'col-span-2 row-span-3', 'col-span-2 row-span-1', 'col-span-2 row-span-1'],
  'the-brand-story': ['col-span-2 row-span-3', 'col-span-4 row-span-2', 'col-span-2 row-span-1', 'col-span-2 row-span-1'],
  'market-day': ['col-span-2 row-span-2', 'col-span-2 row-span-3', 'col-span-2 row-span-1', 'col-span-2 row-span-2'],
  'skin-notes': ['col-span-3 row-span-3 rounded-t-full', 'col-span-3 row-span-2 rounded-t-full', 'col-span-2 row-span-1', 'col-span-2 row-span-1'],
  'street-uniform': ['col-span-6 row-span-2', 'col-span-3 row-span-2', 'col-span-3 row-span-2', 'col-span-2 row-span-1'],
  'tech-index': ['col-span-2 row-span-3', 'col-span-4 row-span-1', 'col-span-4 row-span-1', 'col-span-4 row-span-1'],
  'living-spaces': ['col-span-6 row-span-2', 'col-span-3 row-span-2', 'col-span-3 row-span-2', 'col-span-2 row-span-1'],
  'small-treasures': ['col-span-3 row-span-3 rounded-full', 'col-span-3 row-span-3 rounded-full', 'col-span-2 row-span-1', 'col-span-2 row-span-1'],
  'form-and-function': ['col-span-4 row-span-2', 'col-span-2 row-span-3', 'col-span-2 row-span-2', 'col-span-2 row-span-1'],
  'home-rituals': ['col-span-3 row-span-3', 'col-span-3 row-span-3', 'col-span-3 row-span-1', 'col-span-3 row-span-1'],
  'the-pantry': ['col-span-3 row-span-2', 'col-span-3 row-span-2', 'col-span-2 row-span-2', 'col-span-2 row-span-2'],
  'made-by-hand': ['col-span-2 row-span-3', 'col-span-4 row-span-2', 'col-span-2 row-span-1', 'col-span-2 row-span-1'],
  'the-footnote': ['col-span-2 row-span-3', 'col-span-2 row-span-2', 'col-span-2 row-span-3', 'col-span-2 row-span-1'],
  'the-studio-shop': ['col-span-3 row-span-2', 'col-span-3 row-span-1', 'col-span-2 row-span-2', 'col-span-2 row-span-2'],
  'open-shelf': ['col-span-2 row-span-2', 'col-span-2 row-span-2', 'col-span-2 row-span-2', 'col-span-3 row-span-1'],
}

function TemplateCard({ template, selected, onSelect }: { template: ShowroomTemplate; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={`group overflow-hidden rounded-2xl border text-left transition-all ${selected ? 'border-[#47734d] ring-2 ring-[#47734d]/20' : 'border-black/10 hover:border-black/30'}`}>
      <div className={`relative flex aspect-[1.35/1] flex-col justify-between overflow-hidden p-4 sm:p-5 ${surface[template.surface] || 'bg-stone-100'}`}>
        <div className="flex items-center justify-between gap-2"><span className="text-[8px] uppercase tracking-[.2em] opacity-60">{template.name}</span><span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent[template.accent] }} /></div>
        <div className={`max-w-[90%] ${template.hero === 'type-led' || template.hero === 'manifesto' ? 'font-serif text-2xl leading-[.95]' : template.hero === 'campaign' ? 'text-2xl font-black uppercase leading-[.85]' : 'text-xl font-semibold leading-[.95]'}`}>{template.name}</div>
        <div className="grid h-16 grid-cols-6 grid-rows-3 gap-1.5">
          {(previewLayouts[template.id] || previewLayouts['open-shelf']).map((tile, index) => <span key={index} className={`block min-h-0 bg-current/10 ${tile}`} />)}
        </div>
        {selected && <span className="absolute right-3 top-3 rounded-full bg-[#47734d] px-2.5 py-1 text-[9px] font-semibold text-white">Selected</span>}
      </div>
      <div className="bg-white px-4 py-3 sm:px-5">
        <p className="text-xs font-semibold">{template.name}</p>
        <p className="mt-1 text-[11px] leading-5 text-neutral-500">{template.promise}</p>
        <p className="mt-2 text-[9px] uppercase tracking-[.14em] text-neutral-400">{template.bestFor}</p>
      </div>
    </button>
  )
}

export default function SellerShowroomsPage() {
  const router = useRouter()
  const [selected, setSelected] = useState(SHOWROOM_TEMPLATES[0].id)
  const [title, setTitle] = useState('')
  const [headline, setHeadline] = useState('')
  const [introduction, setIntroduction] = useState('')
  const [story, setStory] = useState('')
  const [sectionHeading, setSectionHeading] = useState('')
  const [sectionBody, setSectionBody] = useState('')
  const [coverPhotoUrl, setCoverPhotoUrl] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#47734d')
  const [accentColor, setAccentColor] = useState('#dfa02c')
  const [photos, setPhotos] = useState<string[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [listingIds, setListingIds] = useState<string[]>([])
  const [showrooms, setShowrooms] = useState<Existing[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingStatus, setEditingStatus] = useState('DRAFT')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [vertical, setVertical] = useState('all')
  const [step, setStep] = useState(1)
  const chosen = useMemo(() => SHOWROOM_TEMPLATES.find((item) => item.id === selected) || SHOWROOM_TEMPLATES[0], [selected])
  const visibleTemplates = useMemo(() => SHOWROOM_TEMPLATES.filter((item) => (vertical === 'all' || item.vertical === vertical) && `${item.name} ${item.bestFor} ${item.vertical}`.toLowerCase().includes(search.toLowerCase())), [search, vertical])

  useEffect(() => {
    let active = true
    Promise.all([
      apiFetch<ApiResponse>('/api/showrooms'),
      apiFetch<ProductResponse>('/api/showrooms/products'),
    ]).then(([showroomData, productData]) => {
      if (!active) return
      setShowrooms(showroomData.showrooms)
      setProducts(productData.products)
      const editId = new URLSearchParams(window.location.search).get('edit')
      const existing = showroomData.showrooms.find((item) => item.id === editId)
      if (existing) {
        setEditingId(existing.id)
        setEditingStatus(existing.status)
        setSelected(existing.templateId)
        setTitle(existing.title)
        setHeadline(existing.headline || '')
        setIntroduction(existing.introduction || '')
        setStory(existing.story || '')
        setLogoUrl(existing.logoUrl || '')
        setPrimaryColor(existing.primaryColor || '#47734d')
        setAccentColor(existing.accentColor || '#dfa02c')
        setCoverPhotoUrl(existing.coverPhotoUrl || '')
        setPhotos(existing.photos || [])
        setListingIds(existing.listingIds || [])
        setSectionHeading(existing.sections?.[0]?.heading || '')
        setSectionBody(existing.sections?.[0]?.body || '')
      }
    }).catch((err) => {
      if (active) setError(err instanceof Error ? err.message : 'Could not load your shop data. Sign in and try again.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  function chooseCover(photo: string) {
    if (photo === coverPhotoUrl) return
    setPhotos((current) => [coverPhotoUrl, ...current.filter((item) => item !== photo)].filter(Boolean).slice(0, 15))
    setCoverPhotoUrl(photo)
  }

  function movePhoto(index: number, direction: -1 | 1) {
    setPhotos((current) => {
      const next = [...current]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      const selectedPhoto = next[index]
      next[index] = next[target]
      next[target] = selectedPhoto
      return next
    })
  }

  function removePhoto(photo: string) {
    setPhotos((current) => current.filter((item) => item !== photo))
  }

  async function uploadPhoto(file?: File) {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file, file.name)
      const result = await apiFetch<Upload>('/api/upload/local', { method: 'POST', body: form })
      if (!coverPhotoUrl) setCoverPhotoUrl(result.url)
      else setPhotos((current) => [...current, result.url].slice(0, 15))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  async function uploadLogo(file?: File) {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file, file.name)
      const result = await apiFetch<Upload>('/api/upload/local', { method: 'POST', body: form })
      setLogoUrl(result.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logo upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  async function create(status: 'DRAFT' | 'PUBLISHED') {
    setBusy(true)
    setError('')
    try {
      const nextStatus = editingId && editingStatus === 'PUBLISHED' ? 'PUBLISHED' : status
      const payload = {
        templateId: selected,
        title: title.trim() || chosen.name,
        headline: headline.trim() || null,
        introduction: introduction.trim() || null,
        story: story.trim() || null,
        sections: sectionHeading.trim() || sectionBody.trim() ? [{ heading: sectionHeading.trim() || undefined, body: sectionBody.trim() || undefined }] : [],
        coverPhotoUrl: coverPhotoUrl || null,
        logoUrl: logoUrl || null,
        primaryColor,
        accentColor,
        photos,
        listingIds,
        status: nextStatus,
      }
      const result = editingId
        ? await apiFetch<{ showroom: Existing }>('/api/showrooms/' + encodeURIComponent(editingId), { method: 'PATCH', body: JSON.stringify(payload) })
        : await apiFetch<{ showroom: Existing }>('/api/showrooms', { method: 'POST', body: JSON.stringify(payload) })
      if (nextStatus === 'PUBLISHED') router.push(`/showroom/${result.showroom.slug}`)
      else router.push(`/seller/showrooms/${result.showroom.slug}/preview`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your showroom could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  function toggleProduct(id: string) {
    setListingIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  return (
    <main className="min-h-screen bg-[#f5f3ed] text-[#24251f]">
      <div className="mx-auto max-w-7xl px-4 py-7 sm:px-8 sm:py-12">
        <a href="/" className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#47734d]">Mudaala <span className="px-1 text-neutral-400">/</span> Your shop</a>
        <div className="mt-7 flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-[10px] uppercase tracking-[.2em] text-neutral-500">Your shop, presented your way</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">{editingId ? 'Edit your showroom' : 'Create your showroom'}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">Choose a design, add the photos and words you want customers to see, then publish a shop website you can share anywhere.</p></div>
          <p className="rounded-full border border-black/10 bg-white px-4 py-2 text-[10px] uppercase tracking-[.16em] text-neutral-500">20 designs · No builder required</p>
        </div>

        {showrooms.length > 0 && <section className="mt-9 rounded-2xl border border-black/10 bg-white p-5 sm:p-6"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Your showrooms</h2><span className="text-xs text-neutral-400">{showrooms.length}</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{showrooms.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-black/10 p-4"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.title}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-neutral-400">{item.status}</p></div><div className="flex shrink-0 items-center gap-3"><a className="text-xs font-semibold text-[#47734d]" href={'/seller/showrooms?edit=' + item.id}>Edit</a>{item.status === 'PUBLISHED' ? <a className="text-xs font-semibold text-[#47734d]" href={'/showroom/' + item.slug} target="_blank" rel="noreferrer">Open ↗</a> : <a className="text-xs font-semibold text-[#47734d]" href={'/seller/showrooms/' + item.slug + '/preview'}>Preview ↗</a>}</div></div>)}</div></section>}

        <section className={`${step === 1 ? 'mt-10' : 'hidden'}`}>
          <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Step 1 of 4</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Choose a design</h2></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a design or shop type" className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-[#47734d] sm:w-72" /></div>
          <div className="mt-4 flex flex-wrap gap-2">{[{id:'all',label:'All designs'},{id:'fashion',label:'Fashion'},{id:'beauty',label:'Beauty'},{id:'electronics',label:'Electronics'},{id:'furniture',label:'Furniture'},{id:'jewellery',label:'Jewellery'},{id:'footwear',label:'Footwear'},{id:'home',label:'Home'},{id:'food',label:'Food'},{id:'craft',label:'Craft'},{id:'general',label:'General'}].map((item) => <button key={item.id} type="button" onClick={() => setVertical(item.id)} className={`rounded-full px-3 py-2 text-[10px] font-semibold transition-colors ${vertical === item.id ? 'bg-[#47734d] text-white' : 'border border-black/10 bg-white text-neutral-600 hover:border-[#47734d]'}`}>{item.label}</button>)}</div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">{visibleTemplates.map((template) => <TemplateCard key={template.id} template={template} selected={selected === template.id} onSelect={() => setSelected(template.id)} />)}</div>
          <div className="mt-5 rounded-2xl border border-[#47734d]/20 bg-[#e9eee6] p-5 sm:p-6"><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-[#47734d]">Selected direction · {chosen.vertical}</p><div className="mt-2 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-semibold">{chosen.name}</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-600">{chosen.artDirection}</p></div><span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-semibold text-[#47734d]">{chosen.hero.replaceAll('-', ' ')}</span></div></div>
        </section>

        <section className={`mx-auto mt-12 grid w-full max-w-3xl grid-cols-1 gap-6 ${step === 1 ? 'hidden' : ''}`}>
          <div className={`w-full rounded-2xl border border-black/10 bg-white p-5 sm:p-7 ${step === 2 ? '' : 'hidden'}`}>
            <p className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Step 2 of 4</p><h2 className="mt-1 text-2xl font-semibold">Your shop story</h2><p className="mt-2 text-xs leading-5 text-neutral-500">Your shop name and shop code come from your Mudaala profile. Add only the words you want customers to see.</p>
            <label className="mt-6 block text-xs font-medium">Showroom title</label><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. The new season collection" maxLength={100} className="mt-2 w-full rounded-xl border border-black/10 bg-[#faf9f6] px-4 py-3 text-sm outline-none focus:border-[#47734d]" />
            <label className="mt-4 block text-xs font-medium">Main heading <span className="font-normal text-neutral-400">(optional)</span></label><input value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="A line customers should remember" maxLength={140} className="mt-2 w-full rounded-xl border border-black/10 bg-[#faf9f6] px-4 py-3 text-sm outline-none focus:border-[#47734d]" />
            <label className="mt-4 block text-xs font-medium">Welcome message <span className="font-normal text-neutral-400">(optional)</span></label><textarea value={introduction} onChange={(event) => setIntroduction(event.target.value)} placeholder="What should people know when they arrive?" maxLength={1000} rows={3} className="mt-2 w-full resize-y rounded-xl border border-black/10 bg-[#faf9f6] px-4 py-3 text-sm outline-none focus:border-[#47734d]" />
            <label className="mt-4 block text-xs font-medium">About your shop <span className="font-normal text-neutral-400">(optional)</span></label><textarea value={story} onChange={(event) => setStory(event.target.value)} placeholder="Your story, what you make or what makes your shop different" maxLength={5000} rows={4} className="mt-2 w-full resize-y rounded-xl border border-black/10 bg-[#faf9f6] px-4 py-3 text-sm outline-none focus:border-[#47734d]" />
            <div className="mt-6 border-t border-black/10 pt-5"><p className="text-xs font-semibold">Add a featured section <span className="font-normal text-neutral-400">(optional)</span></p><label className="mt-3 block text-xs font-medium">Section heading</label><input value={sectionHeading} onChange={(event) => setSectionHeading(event.target.value)} placeholder="e.g. Made for everyday living" maxLength={100} className="mt-2 w-full rounded-xl border border-black/10 bg-[#faf9f6] px-4 py-3 text-sm outline-none focus:border-[#47734d]" /><label className="mt-3 block text-xs font-medium">Section text</label><textarea value={sectionBody} onChange={(event) => setSectionBody(event.target.value)} placeholder="A little more about this collection, product or offer" maxLength={1200} rows={3} className="mt-2 w-full resize-y rounded-xl border border-black/10 bg-[#faf9f6] px-4 py-3 text-sm outline-none focus:border-[#47734d]" /></div>
          </div>

          <div className="w-full space-y-6">
            <div className={`rounded-2xl border border-black/10 bg-white p-5 sm:p-7 ${step === 3 ? '' : 'hidden'}`}>
              <p className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Step 3 of 4</p><h2 className="mt-1 text-2xl font-semibold">Choose your photos</h2><p className="mt-2 text-xs leading-5 text-neutral-500">Only photos you upload here are used in the showroom. Mudaala will not pick photos from your existing product listings.</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_1fr]">
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-black/20 bg-[#faf9f6] p-4 text-xs hover:border-[#47734d]">{logoUrl ? <span className="relative h-10 w-10 overflow-hidden rounded-full"><Image src={logoUrl} alt="Shop logo" fill unoptimized sizes="40px" className="object-cover" /></span> : <span className="grid h-10 w-10 place-items-center rounded-full bg-black/5 text-lg">＋</span>}<span>{uploading ? 'Uploading…' : 'Add your shop logo'}<span className="mt-1 block text-[10px] text-neutral-400">Optional</span></span><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading} onChange={(event) => { void uploadLogo(event.target.files?.[0]); event.currentTarget.value = '' }} /></label>
                <div className="rounded-xl border border-black/10 bg-[#faf9f6] p-4"><p className="text-xs font-medium">Your brand colours</p><div className="mt-3 flex gap-4"><label className="flex items-center gap-2 text-[10px] text-neutral-500">Main<input type="color" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent" /></label><label className="flex items-center gap-2 text-[10px] text-neutral-500">Accent<input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent" /></label></div></div>
              </div>
              <label className="mt-4 flex cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-black/20 bg-[#faf9f6] px-4 py-6 text-sm hover:border-[#47734d]">{uploading ? 'Uploading photo…' : '＋ Add a showroom photo'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading} onChange={(event) => { void uploadPhoto(event.target.files?.[0]); event.currentTarget.value = '' }} /></label>
              {(coverPhotoUrl || photos.length > 0) && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {coverPhotoUrl && <div className="min-w-0"><div className="relative aspect-square overflow-hidden rounded-lg"><Image src={coverPhotoUrl} alt="Selected showroom cover" fill unoptimized sizes="120px" className="object-cover" /><span className="absolute bottom-1 left-1 rounded bg-black/65 px-2 py-1 text-[9px] text-white">Cover image</span></div><button type="button" onClick={() => { const next = photos[0] || ''; setPhotos((current) => current.slice(1)); setCoverPhotoUrl(next) }} className="mt-2 text-[10px] font-medium text-red-700">Remove cover</button></div>}
                {photos.map((photo, index) => <div key={photo} className="min-w-0"><div className="relative aspect-square overflow-hidden rounded-lg"><Image src={photo} alt={`Showroom photo ${index + 2}`} fill unoptimized sizes="120px" className="object-cover" /></div><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]"><button type="button" onClick={() => chooseCover(photo)} className="font-semibold text-[#47734d]">Use as cover</button><button type="button" disabled={index === 0} onClick={() => movePhoto(index, -1)} className="disabled:opacity-30">Move left</button><button type="button" disabled={index === photos.length - 1} onClick={() => movePhoto(index, 1)} className="disabled:opacity-30">Move right</button><button type="button" onClick={() => removePhoto(photo)} className="text-red-700">Remove</button></div></div>)}
              </div>}
              <p className="mt-3 text-[10px] text-neutral-400">JPEG, PNG or WebP · up to 8 MB each</p>
            </div>

            <div className={`rounded-2xl border border-black/10 bg-white p-5 sm:p-7 ${step === 4 ? '' : 'hidden'}`}>
              <p className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Step 4 of 4</p><h2 className="mt-1 text-2xl font-semibold">Link your products</h2><p className="mt-2 text-xs leading-5 text-neutral-500">Choose which existing Mudaala products belong in this showroom. Nothing is added automatically.</p>
              <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">{products.length ? products.map((product) => <label key={product.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-black/10 p-3"><input type="checkbox" checked={listingIds.includes(product.id)} onChange={() => toggleProduct(product.id)} className="h-4 w-4 accent-[#47734d]" />{product.photos[0] && <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg"><Image src={product.photos[0]} alt="" fill unoptimized sizes="44px" className="object-cover" /></span>}<span className="min-w-0"><span className="block truncate text-xs font-medium">{product.title}</span><span className="mt-1 block text-[10px] text-neutral-400">{product.category} · {product.price === null ? 'Ask seller' : `${new Intl.NumberFormat('en-UG').format(product.price)} ${product.currency}`}</span></span></label>) : <p className="rounded-xl bg-[#faf9f6] p-4 text-xs text-neutral-500">No active products yet. You can still save your showroom and link products later.</p>}</div>
              <p className="mt-3 text-[10px] text-neutral-400">{listingIds.length} selected · Customers open each product's existing Mudaala listing.</p>
            </div>
          </div>
        </section>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-black/10 bg-white p-5 sm:p-7">
          <div className="min-w-0"><p className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Selected design</p><p className="mt-1 text-sm font-semibold">{chosen.name}</p><p className="mt-1 text-[10px] text-neutral-400">Stage {step} of 4</p><p className="mt-1 text-xs text-neutral-500">{chosen.promise}</p></div>
          <div className="flex flex-wrap gap-3">{step > 1 && <button type="button" onClick={() => setStep((current) => Math.max(1, current - 1))} className="rounded-full border border-black/15 px-5 py-3 text-xs font-semibold">Back</button>}{step < 4 ? <button type="button" onClick={() => setStep((current) => Math.min(4, current + 1))} className="rounded-full bg-[#47734d] px-6 py-3 text-xs font-semibold text-white">Continue</button> : <><button type="button" disabled={busy || loading} onClick={() => void create('DRAFT')} className="rounded-full border border-black/15 px-5 py-3 text-xs font-semibold disabled:opacity-40">{busy ? 'Saving…' : editingId ? 'Save changes' : 'Save draft'}</button><button type="button" disabled={busy || uploading || loading || (!coverPhotoUrl && photos.length === 0)} onClick={() => void create('PUBLISHED')} className="rounded-full bg-[#47734d] px-6 py-3 text-xs font-semibold text-white disabled:opacity-40">{busy ? 'Publishing…' : editingId ? 'Save and publish' : 'Publish showroom'}</button></>}</div>
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {loading && <p className="mt-4 text-xs text-neutral-500">Loading your shop and active products…</p>}
      </div>
    </main>
  )
}
