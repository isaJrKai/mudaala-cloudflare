'use client'

import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, PackageCheck, Trash2 } from 'lucide-react'
import { apiFetch } from '@/lib/client'
import type { ShopShowroomItemT } from '@/lib/client'
import { CATEGORY_KEYS, categoryLabel } from '@/lib/constants'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

type Availability = ShopShowroomItemT['availability']

const availabilityLabel: Record<Availability, string> = {
  IN_STOCK: 'In stock',
  AVAILABLE_ON_ORDER: 'Available on order',
  SAMPLE_ONLY: 'Sample or design',
}

function formatShowroomPrice(price: number | null, currency: string): string {
  if (price === null) return 'Ask for price'
  return new Intl.NumberFormat('en-UG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(price)
}

export function ShopShowroom({
  shopId,
  items,
  isOwner,
}: {
  shopId: string
  items: ShopShowroomItemT[]
  isOwner: boolean
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<string>(CATEGORY_KEYS[0] ?? '')
  const [price, setPrice] = useState('')
  const [availability, setAvailability] = useState<Availability>('AVAILABLE_ON_ORDER')
  const [photoUrl, setPhotoUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const refreshShop = () => queryClient.invalidateQueries({ queryKey: ['shop', shopId] })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      await apiFetch(`/api/shops/${encodeURIComponent(shopId)}/showroom`, {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
          price: price.trim() === '' ? null : Number(price),
          availability,
          photoUrl: photoUrl.trim() || null,
        }),
      })
      setTitle('')
      setDescription('')
      setPrice('')
      setPhotoUrl('')
      setAvailability('AVAILABLE_ON_ORDER')
      await refreshShop()
      toast({ title: 'Showroom item added', description: 'It now appears in your shop showroom.' })
    } catch (error) {
      toast({
        title: 'Could not add showroom item',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  async function remove(itemId: string) {
    setRemovingId(itemId)
    try {
      await apiFetch(`/api/shops/${encodeURIComponent(shopId)}/showroom/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
      })
      await refreshShop()
      toast({ title: 'Showroom item removed' })
    } catch (error) {
      toast({
        title: 'Could not remove showroom item',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setRemovingId(null)
    }
  }

  if (!isOwner && items.length === 0) return null

  return (
    <section aria-label="Shop showroom" className="space-y-3 rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
          <ImagePlus className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Showroom</h2>
          <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
            Explore more of what this shop offers, including products it can source on request. Confirm price and availability with the shop.
          </p>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <article key={item.id} className="min-w-0 overflow-hidden rounded-lg border bg-background">
              {item.photoUrl ? (
                <img src={item.photoUrl} alt={item.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-secondary text-muted-foreground">
                  <PackageCheck className="size-8" aria-hidden />
                  <span className="sr-only">No product photo provided</span>
                </div>
              )}
              <div className="space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                    {availabilityLabel[item.availability]}
                  </span>
                  <span className="text-xs text-muted-foreground">{categoryLabel(item.category)}</span>
                </div>
                <h3 className="font-semibold leading-snug">{item.title}</h3>
                <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                <div className="flex items-center justify-between gap-2 border-t pt-2">
                  <span className="text-sm font-semibold">{formatShowroomPrice(item.price, item.currency)}</span>
                  {isOwner ? (
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" disabled={removingId === item.id} onClick={() => void remove(item.id)} aria-label={`Remove ${item.title} from showroom`}>
                      <Trash2 className="mr-1 size-3.5" aria-hidden />
                      {removingId === item.id ? 'Removing…' : 'Remove'}
                    </Button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
          Your showroom is ready. Add products you can source or designs you want customers to discover.
        </p>
      )}

      {isOwner ? (
        <details className="rounded-lg border bg-secondary/30 p-3">
          <summary className="cursor-pointer font-medium text-primary">Add a showroom item</summary>
          <form className="mt-3 space-y-3" onSubmit={submit}>
            <div className="space-y-1">
              <label htmlFor="showroom-title" className="text-sm font-medium">Product or design name</label>
              <input id="showroom-title" value={title} onChange={(event) => setTitle(event.target.value)} minLength={4} maxLength={120} required className="h-10 w-full rounded-md border bg-background px-3 text-sm" placeholder="e.g. Three-seater sofa" />
            </div>
            <div className="space-y-1">
              <label htmlFor="showroom-description" className="text-sm font-medium">Description</label>
              <textarea id="showroom-description" value={description} onChange={(event) => setDescription(event.target.value)} minLength={20} maxLength={1000} required rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Describe the product and what customers should know." />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="showroom-category" className="text-sm font-medium">Category</label>
                <select id="showroom-category" value={category} onChange={(event) => setCategory(event.target.value)} required className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  {CATEGORY_KEYS.map((key) => <option key={key} value={key}>{categoryLabel(key)}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="showroom-availability" className="text-sm font-medium">Availability</label>
                <select id="showroom-availability" value={availability} onChange={(event) => setAvailability(event.target.value as Availability)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="IN_STOCK">In stock</option>
                  <option value="AVAILABLE_ON_ORDER">Available on order</option>
                  <option value="SAMPLE_ONLY">Sample or design</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="showroom-price" className="text-sm font-medium">Price in UGX (optional)</label>
              <input id="showroom-price" type="number" min="0" max="100000000" step="1" value={price} onChange={(event) => setPrice(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" placeholder="Leave blank if price varies" />
            </div>
            <div className="space-y-1">
              <label htmlFor="showroom-photo" className="text-sm font-medium">Product photo URL (optional)</label>
              <input id="showroom-photo" type="url" value={photoUrl} onChange={(event) => setPhotoUrl(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" placeholder="https://… or an uploaded /uploads/ photo URL" />
              <p className="text-xs text-muted-foreground">Use a photo you have permission to display. Photo upload can be added through the existing upload flow in a follow-up.</p>
            </div>
            <Button type="submit" disabled={saving} className="w-full sm:w-auto">{saving ? 'Adding…' : 'Add to showroom'}</Button>
          </form>
        </details>
      ) : null}
    </section>
  )
}
