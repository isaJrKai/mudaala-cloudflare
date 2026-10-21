'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Layers3, Plus, Trash2, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch, apiGet, type Listing } from '@/lib/client'
import { PhotoPicker } from './photo-picker'

type CollectionItem = {
  id: string
  sortOrder: number
  listing: Listing
}
type ProductCollection = {
  id: string
  title: string
  description: string | null
  coverPhotoUrl: string | null
  isActive: boolean
  sortOrder: number
  items: CollectionItem[]
}
type CollectionResponse = { collections: ProductCollection[] }

export function ProductCollectionsManager() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [coverPhotoUrl, setCoverPhotoUrl] = useState('')
  const [selectedListing, setSelectedListing] = useState<Record<string, string>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editCoverPhotoUrl, setEditCoverPhotoUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const collectionsQuery = useQuery({
    queryKey: ['my-product-collections'],
    queryFn: () => apiGet<CollectionResponse>('/api/my/collections'),
  })
  const listingsQuery = useQuery({
    queryKey: ['my-listings-for-collections'],
    queryFn: () => apiGet<{ listings: Listing[] }>('/api/my/listings'),
  })
  const collections = collectionsQuery.data?.collections ?? []
  const availableListings = (listingsQuery.data?.listings ?? []).filter((listing) =>
    listing.type === 'OFFER' &&
    listing.status === 'ACTIVE' &&
    new Date(listing.expiresAt).getTime() > Date.now(),
  )

  async function refresh() {
    await collectionsQuery.refetch()
    await listingsQuery.refetch()
  }

  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      setMessage(success)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your collection. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function createCollection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('Enter a collection title.')
      return
    }
    void perform(async () => {
      await apiFetch('/api/my/collections', {
        method: 'POST',
        body: JSON.stringify({
          title: cleanTitle,
          description: description.trim() || null,
          coverPhotoUrl: coverPhotoUrl.trim() || null,
        }),
      })
      setTitle('')
      setDescription('')
      setCoverPhotoUrl('')
    }, 'Collection created.')
  }

  function beginEdit(collection: ProductCollection) {
    setEditingId(collection.id)
    setEditTitle(collection.title)
    setEditDescription(collection.description ?? '')
    setEditCoverPhotoUrl(collection.coverPhotoUrl ?? '')
    setError('')
    setMessage('')
  }

  function saveEdit(event: React.FormEvent<HTMLFormElement>, collectionId: string) {
    event.preventDefault()
    void perform(async () => {
      await apiFetch('/api/my/collections/' + collectionId, {
        method: 'PATCH',
        body: JSON.stringify({ title: editTitle.trim(), description: editDescription.trim() || null, coverPhotoUrl: editCoverPhotoUrl.trim() || null }),
      })
      setEditingId(null)
    }, 'Collection details saved.')
  }
  async function reorderCollection(index: number, direction: -1 | 1) {
    const next = [...collections]
    const swap = index + direction
    if (swap < 0 || swap >= next.length) return
    ;[next[index], next[swap]] = [next[swap], next[index]]
    await perform(() => apiFetch('/api/my/collections/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ items: next.map((collection, sortOrder) => ({ id: collection.id, sortOrder })) }),
    }), 'Collection order saved.')
  }

  async function reorderItem(collection: ProductCollection, index: number, direction: -1 | 1) {
    const next = [...collection.items]
    const swap = index + direction
    if (swap < 0 || swap >= next.length) return
    ;[next[index], next[swap]] = [next[swap], next[index]]
    await perform(() => apiFetch(`/api/my/collections/${collection.id}/items/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ items: next.map((item, sortOrder) => ({ id: item.id, sortOrder })) }),
    }), 'Product order saved.')
  }

  return (
    <section className="space-y-4" aria-labelledby="product-collections-heading">
      <div>
        <p className="text-sm font-medium text-primary">Curate your shop</p>
        <h2 id="product-collections-heading" className="text-xl font-semibold tracking-tight">Product collections</h2>
        <p className="mt-1 text-sm text-muted-foreground">Group your own active offers into useful sets, such as New arrivals, Cakes for birthdays or Drinks by the bottle. Only active collections are visible to buyers.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Create a collection</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={createCollection}>
            <label className="space-y-1 text-sm font-medium sm:col-span-2">
              Collection name
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required placeholder="e.g. Freshly baked today" className="h-10 w-full rounded-md border bg-background px-3 font-normal" />
            </label>
            <label className="space-y-1 text-sm font-medium sm:col-span-2">
              Description (optional)
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={2} placeholder="Tell buyers what belongs in this collection." className="w-full rounded-md border bg-background px-3 py-2 font-normal" />
            </label>
            <div className="space-y-1 text-sm font-medium sm:col-span-2">
              <p>Cover photo (optional)</p>
              <PhotoPicker value={coverPhotoUrl ? [coverPhotoUrl] : []} onChange={(photos) => setCoverPhotoUrl(photos[0] ?? '')} single cover label="Collection cover photo" />
              <p className="text-xs font-normal text-muted-foreground">Take a photo with your phone or choose one from your gallery.</p>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}><Plus className="mr-2 size-4" aria-hidden />Create collection</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">{error}</p> : null}
      {message ? <p role="status" className="rounded-md border bg-muted/40 p-3 text-sm">{message}</p> : null}

      {collectionsQuery.isLoading || listingsQuery.isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading your collections…</p>
      ) : collectionsQuery.isError || listingsQuery.isError ? (
        <div className="rounded-md border p-4 text-sm">
          <p>We could not load your collections or listings.</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => void refresh()}>Try again</Button>
        </div>
      ) : collections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <Layers3 className="mx-auto size-7 text-muted-foreground" aria-hidden />
          <p className="mt-2 font-medium">Your first collection starts here</p>
          <p className="mt-1 text-sm text-muted-foreground">Create one above, then add active products from your own shop.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {collections.map((collection, index) => (
            <Card key={collection.id}>
              <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="break-words text-base">{collection.title}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{collection.description || 'No description yet.'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{collection.items.length} {collection.items.length === 1 ? 'product' : 'products'} · {collection.isActive ? 'Visible to buyers' : 'Hidden from buyers'}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" disabled={busy || editingId === collection.id} onClick={() => beginEdit(collection)}><Pencil className="mr-1 size-3.5" aria-hidden />Edit</Button>
                  <Button size="sm" variant="outline" disabled={busy || index === 0 || editingId === collection.id} aria-label={`Move ${collection.title} up`} onClick={() => void reorderCollection(index, -1)}><ArrowUp className="size-4" aria-hidden /></Button>
                  <Button size="sm" variant="outline" disabled={busy || index === collections.length - 1} aria-label={`Move ${collection.title} down`} onClick={() => void reorderCollection(index, 1)}><ArrowDown className="size-4" aria-hidden /></Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(() => apiFetch(`/api/my/collections/${collection.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !collection.isActive }) }), collection.isActive ? 'Collection hidden from buyers.' : 'Collection visible to buyers.')}>{collection.isActive ? 'Hide' : 'Publish'}</Button>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => {
                    if (window.confirm(`Delete “${collection.title}”? The products themselves will not be deleted.`)) {
                      void perform(() => apiFetch(`/api/my/collections/${collection.id}`, { method: 'DELETE' }), 'Collection deleted.')
                    }
                  }}><Trash2 className="mr-1 size-3.5" aria-hidden />Delete</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {editingId === collection.id ? (
                  <form className="grid gap-3 rounded-md border bg-muted/20 p-3" onSubmit={(event) => saveEdit(event, collection.id)}>
                    <label className="space-y-1 text-sm font-medium">Collection name<input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={80} required className="h-10 w-full rounded-md border bg-background px-3 font-normal" /></label>
                    <label className="space-y-1 text-sm font-medium">Description<textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={500} rows={2} className="w-full rounded-md border bg-background px-3 py-2 font-normal" /></label>
                    <div className="space-y-1 text-sm font-medium"><p>Cover photo</p><PhotoPicker value={editCoverPhotoUrl ? [editCoverPhotoUrl] : []} onChange={(photos) => setEditCoverPhotoUrl(photos[0] ?? '')} single cover label="Collection cover photo" /></div>
                    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !editTitle.trim()}>Save details</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setEditingId(null)}><X className="mr-1 size-4" aria-hidden />Cancel</Button></div>
                  </form>
                ) : null}
                {collection.items.length ? (
                  <ul className="divide-y rounded-md border">
                    {collection.items.map((item, itemIndex) => (
                      <li key={item.id} className="flex min-w-0 items-center gap-2 p-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{item.listing.title}</span>
                          <span className="block text-xs text-muted-foreground">{item.listing.status === 'ACTIVE' ? 'Active listing' : 'No longer active'}</span>
                        </span>
                        <Button size="sm" variant="ghost" disabled={busy || itemIndex === 0} aria-label={`Move ${item.listing.title} up`} onClick={() => void reorderItem(collection, itemIndex, -1)}><ArrowUp className="size-4" aria-hidden /></Button>
                        <Button size="sm" variant="ghost" disabled={busy || itemIndex === collection.items.length - 1} aria-label={`Move ${item.listing.title} down`} onClick={() => void reorderItem(collection, itemIndex, 1)}><ArrowDown className="size-4" aria-hidden /></Button>
                        <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${item.listing.title} from collection`} onClick={() => void perform(() => apiFetch(`/api/my/collections/${collection.id}/items/${item.id}`, { method: 'DELETE' }), 'Product removed from collection.')}><Trash2 className="size-4" aria-hidden /></Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No products in this collection yet.</p>
                )}
                <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => {
                  event.preventDefault()
                  const listingId = selectedListing[collection.id]
                  if (!listingId) return
                  void perform(async () => {
                    await apiFetch(`/api/my/collections/${collection.id}/items`, { method: 'POST', body: JSON.stringify({ listingId }) })
                    setSelectedListing((current) => ({ ...current, [collection.id]: '' }))
                  }, 'Product added to collection.')
                }}>
                  <select aria-label={`Choose a product for ${collection.title}`} value={selectedListing[collection.id] ?? ''} onChange={(event) => setSelectedListing((current) => ({ ...current, [collection.id]: event.target.value }))} className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm">
                    <option value="">Choose one of your active offers</option>
                    {availableListings.map((listing) => (
                      <option key={listing.id} value={listing.id}>{listing.title}</option>
                    ))}
                  </select>
                  <Button type="submit" variant="outline" disabled={busy || !selectedListing[collection.id] || availableListings.length === 0}><Plus className="mr-1 size-4" aria-hidden />Add product</Button>
                </form>
                {availableListings.length === 0 ? <p className="text-xs text-muted-foreground">You need an active offer listing before you can add products. Requests and expired listings cannot be added.</p> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}
