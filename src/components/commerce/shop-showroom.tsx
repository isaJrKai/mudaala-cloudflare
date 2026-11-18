'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { apiFetch } from '@/lib/client'
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

/**
 * Additional shop offerings use the same quiet product-card language as the
 * catalogue. A showroom is a seller-side presentation choice, not a separate
 * destination or customer-facing feature competing with the products.
 */
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
  const [removingId, setRemovingId] = useState<string | null>(null)

  const refreshShop = () => queryClient.invalidateQueries({ queryKey: ['shop', shopId] })

  async function remove(itemId: string) {
    setRemovingId(itemId)
    try {
      await apiFetch(`/api/shops/${encodeURIComponent(shopId)}/showroom/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
      })
      await refreshShop()
      toast({ title: 'Shop item removed' })
    } catch (error) {
      toast({
        title: 'Could not remove shop item',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setRemovingId(null)
    }
  }

  if (items.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3" aria-label="More from this shop">
      {items.map((item) => (
        <article key={item.id} className="min-w-0 overflow-hidden rounded-lg border bg-card">
          {item.photoUrl ? (
            <img src={item.photoUrl} alt={item.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center bg-secondary text-sm text-muted-foreground">
              No product photo
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
            {item.description ? (
              <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
            ) : null}
            <div className="flex items-center justify-between gap-2 border-t pt-2">
              <span className="text-sm font-semibold">{formatShowroomPrice(item.price, item.currency)}</span>
              {isOwner ? (
                <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" disabled={removingId === item.id} onClick={() => void remove(item.id)} aria-label={`Remove ${item.title} from shop`}>
                  <Trash2 className="mr-1 size-3.5" aria-hidden />
                  {removingId === item.id ? 'Removing…' : 'Remove'}
                </Button>
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}
