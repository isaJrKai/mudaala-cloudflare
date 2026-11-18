'use client'
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Search, Users, Store, PackageSearch } from 'lucide-react'
type DirectoryType = 'PEOPLE' | 'SHOPS' | 'LISTINGS'
type Result = { id: string; [key: string]: any }
const tabs: { value: DirectoryType; label: string; icon: typeof Users }[] = [{ value: 'PEOPLE', label: 'People', icon: Users }, { value: 'SHOPS', label: 'Shops', icon: Store }, { value: 'LISTINGS', label: 'Listings', icon: PackageSearch }]
function dateLabel(value: unknown) { return typeof value === 'string' ? new Date(value).toLocaleDateString() : '-' }
export function AdminDirectory() {
 const [type, setType] = useState<DirectoryType>('PEOPLE')
 const [query, setQuery] = useState('')
 const [submitted, setSubmitted] = useState('')
 const [results, setResults] = useState<Result[] | null>(null)
 const [loading, setLoading] = useState(false)
 const [error, setError] = useState('')
 const load = useCallback(async () => {
  if (submitted.trim().length < 2) { setResults(null); return }
  setLoading(true); setError('')
  try { const response = await fetch('/api/admin/directory?type=' + type + '&q=' + encodeURIComponent(submitted.trim()), { cache: 'no-store' }); const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.error ?? 'Could not search the directory.'); setResults(payload?.results ?? []) }
  catch (err) { setError(err instanceof Error ? err.message : 'Connection problem. Try again.'); setResults([]) }
  finally { setLoading(false) }
 }, [type, submitted])
 useEffect(() => { const id = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(id) }, [load])
 function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setSubmitted(query) }
 return <section className='mt-4' aria-label='People, shops and listings directory'>
  <div className='flex flex-wrap gap-2' role='tablist' aria-label='Directory type'>{tabs.map(({ value, label, icon: Icon }) => <button key={value} type='button' role='tab' aria-selected={type === value} onClick={() => { setType(value); setResults(null) }} className={'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium ' + (type === value ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-accent/50')}><Icon className='size-4' aria-hidden />{label}</button>)}</div>
  <form onSubmit={submit} className='mt-3 flex gap-2'><label className='relative min-w-0 flex-1'><span className='sr-only'>Search directory</span><Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' aria-hidden /><input value={query} onChange={e => setQuery(e.target.value)} minLength={2} maxLength={80} placeholder={type === 'PEOPLE' ? 'Name, phone or shop name' : type === 'SHOPS' ? 'Shop name, shop code or district' : 'Product title, seller or listing ID'} className='h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm' /></label><button type='submit' disabled={query.trim().length < 2 || loading} className='h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50'>Search</button></form>
  <p className='mt-2 text-xs text-muted-foreground'>At least 2 characters. Phone numbers are masked. Development seed records are excluded; up to 50 matches are shown.</p>
  {error ? <p role='alert' className='mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive'>{error}</p> : null}
  {loading ? <p className='mt-4 flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='size-4 animate-spin' aria-hidden />Searching…</p> : null}
  {!loading && submitted.length >= 2 && results?.length === 0 ? <p className='mt-4 text-sm text-muted-foreground'>No matching records found.</p> : null}
  {!loading && results && results.length > 0 ? <div className='mt-4 space-y-2'><p className='text-xs text-muted-foreground'>{results.length} results · newest first</p><ul className='space-y-2'>{results.map(item => <li key={String(item.id)} className='rounded-lg border bg-card p-3'>
   {type === 'PEOPLE' ? <><div className='flex flex-wrap items-start justify-between gap-2'><p className='font-medium'>{item.name}</p><span className='text-xs text-muted-foreground'>Joined {dateLabel(item.joinedAt)}</span></div><p className='mt-1 text-sm text-muted-foreground'>{item.phoneMasked} · {item.shop?.businessName ?? 'No shop profile'}</p>{item.shop?.shopCode ? <p className='mt-1 text-xs text-muted-foreground'>Shop code {item.shop.shopCode} · {item.shop.county ?? 'District not set'}</p> : null}<p className='mt-2 text-xs text-muted-foreground'>{item.listingCount} listings · {item.enquiryCount} enquiries</p></> : null}
   {type === 'SHOPS' ? <><div className='flex flex-wrap items-start justify-between gap-2'><p className='font-medium'>{item.businessName}</p><span className='text-xs text-muted-foreground'>Created {dateLabel(item.createdAt)}</span></div><p className='mt-1 text-sm text-muted-foreground'>{item.shopCode ?? 'No shop code'} · {item.county ?? 'District not set'}{item.area ? ' · ' + item.area : ''}</p><p className='mt-1 text-sm'>Owner: {item.ownerName} <span className='text-muted-foreground'>({item.ownerPhoneMasked})</span></p><p className='mt-2 text-xs text-muted-foreground'>{item.listingCount} listings</p></> : null}
   {type === 'LISTINGS' ? <><div className='flex flex-wrap items-start justify-between gap-2'><p className='font-medium'>{item.title}</p><span className='rounded-full border px-2 py-0.5 text-xs'>{item.status}</span></div><p className='mt-1 text-sm text-muted-foreground'>{item.type} · {item.category} · {item.county}</p><p className='mt-1 text-sm'>{item.shopName ?? item.ownerName}{item.shopCode ? ' · ' + item.shopCode : ''}</p><p className='mt-1 text-xs text-muted-foreground'>Created {dateLabel(item.createdAt)} · ID {item.id}</p></> : null}
  </li>)}</ul></div> : null}
 </section>
}