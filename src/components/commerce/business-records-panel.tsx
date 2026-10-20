'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, PackagePlus, PlusCircle, ShoppingBag, Warehouse } from 'lucide-react'
import { apiGet, apiPost, apiPatch } from '@/lib/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Product = { id: string; name: string; sku: string | null; unit: string; currency: string; sellingPrice: number; costPrice: number | null; stockOnHand: number; reorderLevel: number; trackInventory: boolean; archived: boolean }
type Sale = { id: string; status: string; channel: string; currency: string; soldAt: string; notes: string | null; revenue: number; grossProfit: number | null; items: { productName: string; quantity: number; unit: string; unitPrice: number }[] }
type BusinessAnalytics = { period: string; since: string; sales: { currency: string; completedSales: number; recordedRevenue: number; estimatedGrossProfit: number | null; saleLines: number; linesWithKnownCost: number; costCoverage: number | null }[]; listingViews: number; listingCount: number; engagement: { views: number; callClicks: number; whatsappClicks: number; shareClicks: number; contactClicks: number; topListings: { listingId: string; title: string; views: number; callClicks: number; whatsappClicks: number; shareClicks: number }[]; definitions: Record<string, string> }; activeBusinessProducts: number; inventoryTrackedProducts: number }
const ugx = (amount: number) => new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX', maximumFractionDigits: 0 }).format(amount)

export function BusinessRecordsPanel() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [unit, setUnit] = useState('piece')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [opening, setOpening] = useState('0')
  const [reorderLevel, setReorderLevel] = useState('0')
  const [track, setTrack] = useState(true)
  const [productId, setProductId] = useState('')
  const [saleQty, setSaleQty] = useState('1')
  const [saleRequestKey, setSaleRequestKey] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [channel, setChannel] = useState('IN_PERSON')
  const [stockProductId, setStockProductId] = useState('')
  const [stockQty, setStockQty] = useState('')
  const [stockNote, setStockNote] = useState('')
  const [thresholdProductId, setThresholdProductId] = useState('')
  const [thresholdValue, setThresholdValue] = useState('0')
  const [error, setError] = useState('')

  const productsQuery = useQuery({ queryKey: ['business-products'], queryFn: () => apiGet<{ products: Product[] }>('/api/my/business-products'), staleTime: 15000 })
  const salesQuery = useQuery({ queryKey: ['business-sales'], queryFn: () => apiGet<{ sales: Sale[] }>('/api/my/sales?limit=20'), staleTime: 15000 })
  const analyticsQuery = useQuery({ queryKey: ['business-analytics'], queryFn: () => apiGet<BusinessAnalytics>('/api/my/business-analytics?period=30d'), staleTime: 30000 })
  const products = productsQuery.data?.products ?? []
  const active = useMemo(() => products.filter((p) => !p.archived), [products])
  const selected = active.find((p) => p.id === productId) ?? active[0]
  const lowStockProducts = useMemo(() => active.filter((p) => p.trackInventory && p.reorderLevel > 0 && p.stockOnHand <= p.reorderLevel), [active])
  const salesSummary = analyticsQuery.data?.sales.find((row) => row.currency === 'UGX')
  const refresh = async () => { await Promise.all([qc.invalidateQueries({ queryKey: ['business-products'] }), qc.invalidateQueries({ queryKey: ['business-sales'] }), qc.invalidateQueries({ queryKey: ['business-analytics'] })]) }

  const createProduct = useMutation({
    mutationFn: () => apiPost('/api/my/business-products', { name, sku: sku.trim() || null, unit, currency: 'UGX', sellingPrice: Number(price), costPrice: cost.trim() ? Number(cost) : null, openingStock: Number(opening), reorderLevel: Number(reorderLevel), trackInventory: track }),
    onSuccess: async () => { setName(''); setSku(''); setPrice(''); setCost(''); setOpening('0'); setReorderLevel('0'); setError(''); await refresh() },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save product'),
  })
  const recordSale = useMutation({
    mutationFn: (idempotencyKey: string) => {
      if (!selected) throw new Error('Add a product before recording a sale')
      return apiPost('/api/my/sales', { idempotencyKey, channel, items: [{ productId: selected.id, quantity: Number(saleQty), ...(salePrice.trim() ? { unitPrice: Number(salePrice) } : {}) }] })
    },
    onSuccess: async () => { setSaleQty('1'); setSalePrice(''); setSaleRequestKey(''); setError(''); await refresh() },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not record sale'),
  })
  const restock = useMutation({
    mutationFn: () => apiPost('/api/my/business-products/' + stockProductId + '/stock', { type: 'RESTOCK', quantity: Number(stockQty), note: stockNote.trim() || null }),
    onSuccess: async () => { setStockQty(''); setStockNote(''); setError(''); await refresh() },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not record stock'),
  })
  const voidSale = useMutation({
    mutationFn: (id: string) => apiPost('/api/my/sales/' + id + '/void', { reason: 'Seller marked this recorded sale as entered in error' }),
    onSuccess: async () => { setError(''); await refresh() },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not void sale'),
  })
  const updateThreshold = useMutation({
    mutationFn: () => apiPatch('/api/my/business-products/' + thresholdProductId, { reorderLevel: Number(thresholdValue) }),
    onSuccess: async () => { setThresholdProductId(''); setError(''); await refresh() },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not update low-stock alert'),
  })
  const archive = useMutation({
    mutationFn: (id: string) => apiPatch('/api/my/business-products/' + id, { archived: true }),
    onSuccess: refresh,
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not archive product'),
  })
  const submitProduct = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setError(''); createProduct.mutate() }
  const submitSale = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setError(''); const key = saleRequestKey || crypto.randomUUID(); setSaleRequestKey(key); recordSale.mutate(key) }
  const submitStock = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setError(''); restock.mutate() }

  return <section className="space-y-5" aria-labelledby="business-records-title">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div><h2 id="business-records-title" className="text-xl font-semibold">Products, stock and sales</h2><p className="mt-1 text-sm text-muted-foreground">Keep records for sales made through Mudaala, WhatsApp, phone or in person.</p></div>
      <div className="flex flex-wrap gap-2">
        <a className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent" href="/api/my/business-export?type=products"><Download className="size-4" aria-hidden /> Products CSV</a>
        <a className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent" href="/api/my/business-export?type=sales"><Download className="size-4" aria-hidden /> Sales CSV</a>
        <a className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent" href="/api/my/business-export?type=stock"><Download className="size-4" aria-hidden /> Stock CSV</a>
      </div>
    </div>
    {error ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{error}</div> : null}
    {(productsQuery.isError || salesQuery.isError || analyticsQuery.isError) ? <div role="alert" className="rounded-md border p-3 text-sm">Some records could not be loaded. <Button variant="link" onClick={() => { void productsQuery.refetch(); void salesQuery.refetch(); void analyticsQuery.refetch() }}>Retry</Button></div> : null}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Business performance for the last 30 days">
      <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Recorded revenue · 30 days</p><p className="mt-1 text-2xl font-bold tabular-nums">{ugx(salesSummary?.recordedRevenue ?? 0)}</p><p className="mt-1 text-xs text-muted-foreground">Completed sales you recorded</p></CardContent></Card>
      <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Completed sales · 30 days</p><p className="mt-1 text-2xl font-bold tabular-nums">{salesSummary?.completedSales ?? 0}</p><p className="mt-1 text-xs text-muted-foreground">Voided records excluded</p></CardContent></Card>
      <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Estimated gross profit</p><p className="mt-1 text-2xl font-bold tabular-nums">{salesSummary?.estimatedGrossProfit == null ? 'Unknown' : ugx(salesSummary.estimatedGrossProfit)}</p><p className="mt-1 text-xs text-muted-foreground">{salesSummary && salesSummary.costCoverage !== null ? Math.round(salesSummary.costCoverage * 100) + '% of sale lines have cost data' : 'Add product costs to estimate profit'}</p></CardContent></Card>
      <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Listing views · 30 days</p><p className="mt-1 text-2xl font-bold tabular-nums">{(analyticsQuery.data?.engagement.views ?? 0).toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Page loads, not unique people reached</p></CardContent></Card>
      <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Call clicks · 30 days</p><p className="mt-1 text-2xl font-bold tabular-nums">{(analyticsQuery.data?.engagement.callClicks ?? 0).toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Call-link taps, not connected calls</p></CardContent></Card>
      <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">WhatsApp clicks · 30 days</p><p className="mt-1 text-2xl font-bold tabular-nums">{(analyticsQuery.data?.engagement.whatsappClicks ?? 0).toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Taps, not confirmed messages</p></CardContent></Card>
      <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Share clicks · 30 days</p><p className="mt-1 text-2xl font-bold tabular-nums">{(analyticsQuery.data?.engagement.shareClicks ?? 0).toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Share actions, not delivered links</p></CardContent></Card>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>Products getting attention · 30 days</CardTitle>
        <p className="text-sm text-muted-foreground">Ranked by recorded product-page views. Clicks show interest, not sales.</p>
      </CardHeader>
      <CardContent>
        {(analyticsQuery.data?.engagement.topListings ?? []).length === 0 ? (
          <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No listing engagement has been recorded in this period yet. Public views and Call, WhatsApp and share taps will appear here as customers interact with your listings.</p>
        ) : (
          <div className="divide-y">
            {analyticsQuery.data!.engagement.topListings.map((item) => (
              <div key={item.listingId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.title}</p><p className="text-xs text-muted-foreground">{item.views.toLocaleString()} views</p></div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><span>Call: {item.callClicks}</span><span>WhatsApp: {item.whatsappClicks}</span><span>Shares: {item.shareClicks}</span></div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Mudaala counts button taps and page loads. It does not claim unique reach, completed calls/messages, or sales from these events.</p>
      </CardContent>
    </Card>

    <div className="grid gap-4 xl:grid-cols-2">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><PackagePlus className="size-5" aria-hidden /> Add a product</CardTitle></CardHeader><CardContent>
        <form className="space-y-3" onSubmit={submitProduct}>
          <div className="space-y-1.5"><Label htmlFor="business-product-name">Product name</Label><Input id="business-product-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="e.g. Blue school shirt" /></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="business-product-sku">SKU (optional)</Label><Input id="business-product-sku" value={sku} onChange={(e) => setSku(e.target.value)} maxLength={60} /></div><div className="space-y-1.5"><Label htmlFor="business-product-unit">Unit</Label><Input id="business-product-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={24} required /></div></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="business-product-price">Selling price (UGX)</Label><Input id="business-product-price" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="business-product-cost">Cost per unit (optional)</Label><Input id="business-product-cost" type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Leave blank if unknown" /></div></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="business-product-opening">Opening stock quantity</Label><Input id="business-product-opening" type="number" min="0" step="0.001" value={opening} onChange={(e) => setOpening(e.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="business-product-reorder">Low-stock alert at or below</Label><Input id="business-product-reorder" type="number" min="0" step="0.001" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} required /><p className="text-xs text-muted-foreground">Enter 0 to turn the alert off.</p></div></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} className="mt-1" /> Track stock and prevent recorded sales from taking stock below zero.</label>
          <Button type="submit" disabled={createProduct.isPending} className="w-full"><PlusCircle className="mr-2 size-4" aria-hidden />{createProduct.isPending ? 'Saving product…' : 'Save product'}</Button>
        </form>
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShoppingBag className="size-5" aria-hidden /> Record a sale</CardTitle></CardHeader><CardContent>
        {active.length === 0 ? <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">Add a product first, then record a completed sale from any channel.</p> : <form className="space-y-3" onSubmit={submitSale}>
          <div className="space-y-1.5"><Label htmlFor="business-sale-product">Product</Label><select id="business-sale-product" value={selected?.id ?? ''} onChange={(e) => setProductId(e.target.value)} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm">{active.map((p) => <option key={p.id} value={p.id}>{p.name} - {ugx(p.sellingPrice)}</option>)}</select></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="business-sale-qty">Quantity sold</Label><Input id="business-sale-qty" type="number" min="0.001" step="0.001" value={saleQty} onChange={(e) => setSaleQty(e.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="business-sale-price">Unit sale price (UGX)</Label><Input id="business-sale-price" type="number" min="0" step="0.01" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder={selected ? String(selected.sellingPrice) : ''} /></div></div>
          <div className="space-y-1.5"><Label htmlFor="business-sale-channel">Where was it sold?</Label><select id="business-sale-channel" value={channel} onChange={(e) => setChannel(e.target.value)} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="IN_PERSON">In person</option><option value="WHATSAPP">WhatsApp</option><option value="PHONE">Phone call</option><option value="MUDAALA">Found on Mudaala</option><option value="OTHER">Other</option></select></div>
          {selected ? <p className="text-xs text-muted-foreground">Estimated line revenue: {ugx(Number(saleQty || 0) * Number(salePrice || selected.sellingPrice))}. {selected.trackInventory ? 'Recorded stock decreases when saved.' : 'Stock tracking is off for this product.'}</p> : null}
          <Button type="submit" disabled={recordSale.isPending} className="w-full"><ShoppingBag className="mr-2 size-4" aria-hidden />{recordSale.isPending ? 'Recording sale…' : 'Record completed sale'}</Button><p className="text-xs text-muted-foreground">This records your business book; it does not claim Mudaala processed payment.</p>
        </form>}
      </CardContent></Card>
    </div>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Warehouse className="size-5" aria-hidden /> Stock on hand</CardTitle></CardHeader><CardContent className="space-y-4">
      {lowStockProducts.length > 0 ? <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3"><p className="text-sm font-semibold">Low stock needs attention</p><ul className="mt-1 space-y-1 text-sm">{lowStockProducts.map((p) => <li key={p.id}>{p.name}: {p.stockOnHand} {p.unit} left (alert at {p.reorderLevel})</li>)}</ul></div> : null}
      {productsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading products…</p> : active.length === 0 ? <p className="text-sm text-muted-foreground">Saved products and recorded stock appear here.</p> : <>
        <div className="divide-y">{active.map((p) => <div key={p.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.sku ? 'SKU ' + p.sku + ' · ' : ''}{ugx(p.sellingPrice)} per {p.unit}{p.costPrice === null ? ' · Cost unknown' : ' · Cost ' + ugx(p.costPrice)}</p></div><div className="text-right"><p className="text-sm font-semibold tabular-nums">{p.trackInventory ? p.stockOnHand : 'Not tracked'}</p><p className="text-xs text-muted-foreground">{p.trackInventory ? p.unit : 'Inventory'}</p></div><Button variant="outline" size="sm" onClick={() => setStockProductId(p.id)}>Restock</Button><Button variant="outline" size="sm" onClick={() => { setThresholdProductId(p.id); setThresholdValue(String(p.reorderLevel)) }}>Alert level</Button><Button variant="ghost" size="sm" disabled={archive.isPending} onClick={() => archive.mutate(p.id)}>Archive</Button></div>)}</div>
        {thresholdProductId ? <form className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]" onSubmit={(e) => { e.preventDefault(); updateThreshold.mutate() }}><div className="space-y-1.5"><Label htmlFor="business-threshold-product">Product</Label><select id="business-threshold-product" value={thresholdProductId} onChange={(e) => { setThresholdProductId(e.target.value); setThresholdValue(String(active.find((p) => p.id === e.target.value)?.reorderLevel ?? 0)) }} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm">{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div><div className="space-y-1.5"><Label htmlFor="business-threshold-value">Alert when stock is at or below</Label><Input id="business-threshold-value" type="number" min="0" step="0.001" value={thresholdValue} onChange={(e) => setThresholdValue(e.target.value)} required /></div><div className="flex items-end gap-2"><Button type="submit" disabled={updateThreshold.isPending}>{updateThreshold.isPending ? 'Saving…' : 'Save alert'}</Button><Button type="button" variant="ghost" onClick={() => setThresholdProductId('')}>Cancel</Button></div></form> : null}
        {stockProductId ? <form className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)_auto]" onSubmit={submitStock}><div className="space-y-1.5"><Label htmlFor="business-restock-product">Product</Label><select id="business-restock-product" value={stockProductId} onChange={(e) => setStockProductId(e.target.value)} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm">{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div><div className="space-y-1.5"><Label htmlFor="business-restock-qty">Quantity added</Label><Input id="business-restock-qty" type="number" min="0.001" step="0.001" value={stockQty} onChange={(e) => setStockQty(e.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="business-restock-note">Note (optional)</Label><Input id="business-restock-note" value={stockNote} onChange={(e) => setStockNote(e.target.value)} maxLength={300} /></div><div className="flex items-end gap-2"><Button type="submit" disabled={restock.isPending}>{restock.isPending ? 'Saving…' : 'Save stock'}</Button><Button type="button" variant="ghost" onClick={() => setStockProductId('')}>Cancel</Button></div></form> : null}
      </>}
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Recent recorded sales</CardTitle></CardHeader><CardContent>
      {salesQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading sales…</p> : (salesQuery.data?.sales.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">No sales recorded yet. Include in-person and WhatsApp sales.</p> : <div className="divide-y">{salesQuery.data?.sales.map((sale) => <div key={sale.id} className="flex flex-wrap items-start gap-3 py-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{sale.items.map((item) => item.quantity + ' ' + item.unit + ' · ' + item.productName).join(', ')}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(sale.soldAt).toLocaleString()} · {sale.channel.replace('_', ' ').toLowerCase()}</p></div><div className="text-right"><p className="text-sm font-semibold tabular-nums">{sale.status === 'VOIDED' ? 'Voided · ' + ugx(sale.revenue) : ugx(sale.revenue)}</p><p className="text-xs text-muted-foreground">{sale.status === 'VOIDED' ? 'Excluded from active sales' : sale.grossProfit === null ? 'Profit unknown' : 'Est. gross profit ' + ugx(sale.grossProfit)}</p><p className="text-xs">{sale.status === 'VOIDED' ? 'Voided record' : 'Recorded sale'}</p></div>{sale.status === 'COMPLETED' ? <Button variant="ghost" size="sm" onClick={() => { if (window.confirm('Void this recorded sale? If stock was tracked, its quantity will be restored and the action will remain in the history.')) voidSale.mutate(sale.id) }} disabled={voidSale.isPending}>Void</Button> : null}</div>)}</div>}
      <p className="mt-3 text-xs text-muted-foreground">Gross profit uses entered product costs and excludes rent, transport, wages and other operating expenses. Recent sales are shown here; export CSV for records.</p>
    </CardContent></Card>
  </section>
}
