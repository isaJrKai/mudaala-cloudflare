'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Package, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiGet, apiPatch } from '@/lib/client'
import { formatPrice } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { EmptyState } from './empty-state'
import { ListingListSkeleton } from './skeletons'
import { ErrorState } from './listings-browse'

type OrderSummary = {
  id: string
  orderNumber: string
  role: 'BUYER' | 'SELLER'
  shopName: string
  status: string
  paymentStatus: string
  currency: string
  total: number
  itemCount: number
  createdAt: string
}
type OrderDetail = Omit<OrderSummary, 'shopName' | 'itemCount'> & {
  paymentMethod: string | null
  paymentReference: string | null
  subtotal: number
  deliveryFee: number
  deliveryMethod: string
  deliveryEstimate: { optionName?: string; district?: string | null; area?: string | null; minDays?: number; maxDays?: number; estimateOnly?: boolean } | null
  deliveryAddress: { district: string; area?: string; addressLine: string; contactPhone?: string } | null
  buyerNote: string | null
  sellerNote: string | null
  seller: { businessName: string; phone: string; whatsapp: string | null; momoMerchantCode: string | null; momoNetwork: string | null; momoMerchantName: string | null } | null
  buyerName: string | null
  items: Array<{ id: string; title: string; variantLabel: string | null; sku: string | null; photoUrl: string | null; quantity: number; unitPrice: number; lineTotal: number }>
}

const statusLabel: Record<string, string> = {
  PENDING_SELLER: 'Waiting for seller',
  ACCEPTED: 'Accepted',
  REJECTED: 'Declined',
  AWAITING_PAYMENT: 'Awaiting payment',
  PAID: 'Paid',
  PROCESSING: 'Preparing',
  READY: 'Ready',
  OUT_FOR_DELIVERY: 'On the way',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Reservation expired',
}

export function OrdersView() {
  const { navigate, setAuthOpen } = useAppStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('MTN_MOMO')
  const list = useQuery({
    queryKey: ['commerce-orders'],
    queryFn: () => apiGet<{ orders: OrderSummary[] }>('/api/orders'),
    retry: false,
  })
  const detail = useQuery({
    queryKey: ['commerce-order', selectedId],
    queryFn: () => apiGet<{ order: OrderDetail }>(`/api/orders/${selectedId}`),
    enabled: Boolean(selectedId),
    retry: false,
  })

  async function act(action: 'ACCEPT' | 'REJECT' | 'CANCEL' | 'MARK_PAID' | 'PROCESSING' | 'READY' | 'OUT_FOR_DELIVERY' | 'COMPLETE') {
    if (!selectedId) return
    setBusy(true)
    try {
      await apiPatch(`/api/orders/${selectedId}`, {
        action,
        ...(action === 'MARK_PAID' ? { paymentMethod } : {}),
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['commerce-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['commerce-order', selectedId] }),
      ])
      toast({ title: action === 'ACCEPT' ? 'Order accepted' : action === 'REJECT' ? 'Order declined' : action === 'CANCEL' ? 'Order cancelled' : action === 'MARK_PAID' ? 'Payment recorded' : 'Order updated' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update this order.'
      toast({ title: 'Order update failed', description: message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (list.isLoading) return <ListingListSkeleton count={3} />
  if (list.error) {
    const message = list.error instanceof Error ? list.error.message : 'Could not load orders.'
    if (/sign in|session|unauthor/i.test(message)) {
      return <div className="rounded-lg border bg-card p-6 text-center"><h1 className="font-semibold">Sign in to view orders</h1><p className="mt-1 text-sm text-muted-foreground">Your orders stay attached to your Mudaala account.</p><Button className="mt-4" onClick={() => setAuthOpen(true)}>Sign in</Button></div>
    }
    return <ErrorState message={message} onRetry={() => void list.refetch()} />
  }

  if (selectedId) {
    if (detail.isLoading) return <ListingListSkeleton count={2} />
    if (detail.error || !detail.data) return <ErrorState message="Could not load this order." onRetry={() => void detail.refetch()} />
    const order = detail.data.order
    const sellerCanReview = order.role === 'SELLER' && order.status === 'PENDING_SELLER'
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2 gap-1" onClick={() => setSelectedId(null)}><ArrowLeft className="size-4" /> All orders</Button>
        <section className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-xs text-muted-foreground">Order reference</p><h1 className="text-lg font-semibold">{order.orderNumber}</h1><p className="mt-1 text-sm text-muted-foreground">{new Date(order.createdAt).toLocaleString()}</p></div>
            <span className="rounded-full border px-3 py-1 text-xs font-semibold">{statusLabel[order.status] ?? order.status}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3">
            <div><p className="text-xs text-muted-foreground">Order total</p><p className="text-lg font-semibold tabular-nums">{formatPrice(order.total, null, order.currency)}</p></div>
            <div><p className="text-xs text-muted-foreground">Payment</p><p className="text-sm font-medium">{order.paymentStatus === 'PAID' ? 'Confirmed by seller' : 'Not yet confirmed'}</p></div>
          </div>
        </section>
        <section className="rounded-xl border bg-card p-4">
          <h2 className="font-semibold">Items</h2>
          <div className="mt-3 space-y-3">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                {item.photoUrl ? <img src={item.photoUrl} alt="" className="size-14 rounded-md border object-cover" /> : <div className="flex size-14 items-center justify-center rounded-md bg-secondary"><Package className="size-5 text-muted-foreground" /></div>}
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.title}</p>{item.variantLabel ? <p className="text-xs text-muted-foreground">{item.variantLabel}</p> : null}<p className="text-xs text-muted-foreground">Qty {item.quantity} · {formatPrice(item.unitPrice, null, order.currency)} each</p></div>
                <p className="text-sm font-semibold tabular-nums">{formatPrice(item.lineTotal, null, order.currency)}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-1 border-t pt-3 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatPrice(order.subtotal, null, order.currency)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Delivery</span><span>{formatPrice(order.deliveryFee, null, order.currency)}</span></div><div className="flex justify-between font-semibold"><span>Total</span><span>{formatPrice(order.total, null, order.currency)}</span></div></div>
        </section>
        {order.role === 'BUYER' && order.seller ? (
          <section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">{order.seller.businessName}</h2><p className="mt-1 text-sm text-muted-foreground">Payment is made directly to the seller. Confirm the recipient name in your mobile-money app before sending.</p>{order.seller.momoMerchantCode ? <div className="mt-3 rounded-lg border bg-secondary/35 p-3"><p className="text-xs text-muted-foreground">{order.seller.momoNetwork ?? 'Mobile money'} merchant code · self-reported</p><p className="mt-1 text-lg font-semibold tracking-wider">{order.seller.momoMerchantCode}</p>{order.seller.momoMerchantName ? <p className="mt-1 text-xs text-muted-foreground">Expected recipient name: {order.seller.momoMerchantName}</p> : null}</div> : null}<div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" asChild><a href={`tel:${order.seller.phone}`}>Call seller</a></Button>{order.seller.whatsapp ? <Button variant="outline" asChild><a href={`https://wa.me/${order.seller.whatsapp.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">WhatsApp</a></Button> : null}</div></section>
        ) : null}
        {order.deliveryEstimate ? <section className="rounded-xl border bg-card p-4"><h2 className="flex items-center gap-2 font-semibold"><Truck className="size-4" /> Delivery estimate</h2><p className="mt-1 text-sm text-muted-foreground">{order.deliveryEstimate.optionName ?? 'Seller delivery'} · {order.deliveryEstimate.minDays}-{order.deliveryEstimate.maxDays} days · Estimate only, seller confirms availability</p>{order.deliveryAddress ? <div className="mt-2 space-y-1 text-sm"><p>{order.deliveryAddress.addressLine}, {order.deliveryAddress.area ? order.deliveryAddress.area + ', ' : ''}{order.deliveryAddress.district}</p>{order.role === 'SELLER' && order.deliveryAddress.contactPhone ? <p className="text-xs text-muted-foreground">Delivery contact: {order.deliveryAddress.contactPhone}</p> : null}</div> : null}</section> : null}
        {order.buyerNote ? <p className="rounded-lg bg-secondary/40 p-3 text-sm">Buyer note: {order.buyerNote}</p> : null}
        {order.sellerNote ? <p className="rounded-lg bg-secondary/40 p-3 text-sm">Seller note: {order.sellerNote}</p> : null}
        {order.role === 'BUYER' && order.status === 'PENDING_SELLER' ? (
          <section className="rounded-xl border bg-card p-4">
            <Button variant="outline" className="w-full" disabled={busy} onClick={() => void act('CANCEL')}>Cancel order</Button>
            <p className="mt-2 text-xs text-muted-foreground">You can cancel while the seller has not accepted. The temporary stock reservation will be released.</p>
          </section>
        ) : null}
        {order.role === 'SELLER' ? (
          <section className="space-y-2 rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Manage order</h2>
            {sellerCanReview ? <div className="grid grid-cols-2 gap-2"><Button variant="outline" disabled={busy} onClick={() => void act('REJECT')}>Decline</Button><Button disabled={busy} onClick={() => void act('ACCEPT')}>Accept & deduct stock</Button></div> : null}
            {order.status === 'ACCEPTED' && order.paymentStatus !== 'PAID' ? <div className="space-y-2"><Select value={paymentMethod} onValueChange={setPaymentMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MTN_MOMO">MTN MoMo</SelectItem><SelectItem value="AIRTEL_MONEY">Airtel Money</SelectItem><SelectItem value="CASH">Cash</SelectItem><SelectItem value="OTHER">Other</SelectItem></SelectContent></Select><Button className="w-full" variant="outline" disabled={busy} onClick={() => void act('MARK_PAID')}>Confirm payment received</Button></div> : null}
            {order.status === 'ACCEPTED' ? <Button className="w-full" disabled={busy} onClick={() => void act('PROCESSING')}>Start preparing</Button> : null}
            {order.status === 'PROCESSING' ? <Button className="w-full" disabled={busy} onClick={() => void act('READY')}>Mark ready</Button> : null}
            {order.status === 'READY' ? <Button className="w-full" disabled={busy} onClick={() => void act('OUT_FOR_DELIVERY')}>Dispatch order</Button> : null}
            {(order.status === 'READY' || order.status === 'OUT_FOR_DELIVERY') && order.paymentStatus === 'PAID' ? <Button className="w-full" disabled={busy} onClick={() => void act('COMPLETE')}>Mark completed</Button> : null}
            {(order.status === 'READY' || order.status === 'OUT_FOR_DELIVERY') && order.paymentStatus !== 'PAID' ? <p className="text-xs text-muted-foreground">Confirm the payment received before marking this order completed.</p> : null}
            <p className="text-xs text-muted-foreground">Accepting confirms the order and deducts tracked stock once. Record payment only after checking your own payment receipt.</p>
          </section>
        ) : null}
      </div>
    )
  }

  const orders = list.data?.orders ?? []
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold">Your orders</h1><p className="mt-1 text-sm text-muted-foreground">Orders you placed and orders customers sent to your shop.</p></div>
      {orders.length === 0 ? <EmptyState title="No orders yet" description="When you place an order or a customer orders from your shop, it will appear here." action={<Button onClick={() => navigate({ name: 'browse' })}>Browse products</Button>} /> : (
        <div className="space-y-2">{orders.map((order) => (
          <button key={order.id} type="button" onClick={() => setSelectedId(order.id)} className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent/40">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary"><Package className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{order.orderNumber}</span><span className="block text-xs text-muted-foreground">{order.role === 'BUYER' ? order.shopName : 'Customer order'} · {order.itemCount} items</span></span>
            <span className="text-right"><span className="block text-sm font-semibold tabular-nums">{formatPrice(order.total, null, order.currency)}</span><span className="block text-xs text-muted-foreground">{statusLabel[order.status] ?? order.status}</span></span>
          </button>
        ))}</div>
      )}
    </div>
  )
}
