'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, MessageCircle, PackageCheck, Trash2 } from 'lucide-react'
import { apiFetch } from '@/lib/client'
import { whatsappLink } from '@/lib/format'
import type { ShopShowroomItemT } from '@/lib/client'
import { categoryLabel } from '@/lib/constants'
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
  return new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(price) + (currency === 'UGX' ? ' UGX' : ` ${currency}`)
}

export function ShopShowroom({
  shopId,
  items,
  isOwner,
  contactPhone,
}: {
  shopId: string
  items: ShopShowroomItemT[]
  isOwner: boolean
  contactPhone: string
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [removingId, setRemovingId] = useState<string | null>(null)

  const refreshShop = () => queryClient.invalidateQueries({ queryKey: ['shop', shopId] })

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
          <div className="flex flex-wrap items-center gap-3"><h2 className="text-base font-semibold">Showroom</h2>{isOwner ? <a href="/seller/showrooms" className="inline-flex min-h-9 items-center rounded-full border border-primary/25 bg-accent px-4 text-xs font-semibold text-primary transition hover:border-primary/50">Design your showroom <span className="ml-2" aria-hidden="true">↗</span></a> : null}</div>
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
                <Button asChild variant="outline" size="sm" className="w-full gap-2">
                  <a href={whatsappLink(contactPhone, item.title, 'OFFER')} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="size-4" aria-hidden /> Ask about this item
                  </a>
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

    </section>
  )
}
