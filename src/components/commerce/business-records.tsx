'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight, ClipboardList, PackagePlus, ReceiptText } from 'lucide-react'
import { apiFetch, type Listing } from '@/lib/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type Sale = {
  id: string
  listingId: string | null
  productTitle: string
  quantity: number
  unit: string | null
  unitPrice: number
  unitCost: number | null
  currency: string
  channel: string
  note: string | null
  occurredAt: string
  status: string
  voidedAt: string | null
}
type Movement = {
  id: string
  listingId: string | null
  productTitle: string
  quantityDelta: number
  unit: string | null
  reason: string
  note: string | null
  occurredAt: string
}
type Balance = { listingId: string | null; productTitle: string; unit: string | null; quantityOnHand: number; movementCount: number }

const money = (value: number, currency = 'UGX') => new Intl.NumberFormat('en-UG', {
  style: 'currency', currency, maximumFractionDigits: 2,
}).format(value)
const quantityLabel = (value: number, unit: string | null) => `${new Intl.NumberFormat('en-UG', { maximumFractionDigits: 3 }).format(value)}${unit ? ` ${unit}` : ''}`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>
}
function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <Field label={label}><select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">{children}</select></Field>
}

export function BusinessRecords() {
  const queryClient = useQueryClient()
  const [section, setSection] = useState<'sales' | 'stock'>('sales')
  const [listingId, setListingId] = useState('')
  const [productTitle, setProductTitle] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitPrice, setUnitPrice] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [channel, setChannel] = useState('IN_PERSON')
  const [adjustStock, setAdjustStock] = useState(false)
  const [saleNote, setSaleNote] = useState('')
  const [voidingSaleId, setVoidingSaleId] = useState<string | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [stockListingId, setStockListingId] = useState('')
  const [stockTitle, setStockTitle] = useState('')
  const [stockDelta, setStockDelta] = useState('1')
  const [stockReason, setStockReason] = useState('OPENING_BALANCE')
  const [stockNote, setStockNote] = useState('')

  const listingsQuery = useQuery({
    queryKey: ['my-listings'],
    queryFn: () => apiFetch<{ listings: Listing[] }>('/api/my/listings'),
    staleTime: 30_000,
  })
  const salesQuery = useQuery({
    queryKey: ['business-sales', 1],
    queryFn: () => apiFetch<{ sales: Sale[]; total: number; page: number; pageCount: number }>('/api/my/business/sales?page=1'),
    staleTime: 15_000,
  })
  const stockQuery = useQuery({
    queryKey: ['business-stock'],
    queryFn: () => apiFetch<{ movements: Movement[]; balances: Balance[]; total: number }>('/api/my/business/stock'),
    staleTime: 15_000,
  })

  const listings = (listingsQuery.data?.listings ?? []).filter((item) => item.type === 'OFFER' && item.status !== 'ARCHIVED' && item.status !== 'HIDDEN')
  const selectedListing = listings.find((item) => item.id === listingId)
  const selectedStockListing = listings.find((item) => item.id === stockListingId)
  const sales = salesQuery.data?.sales ?? []
  const balances = stockQuery.data?.balances ?? []
  const salesError = salesQuery.error instanceof Error ? salesQuery.error.message : null
  const stockError = stockQuery.error instanceof Error ? stockQuery.error.message : null

  const completedRecent = useMemo(() => sales.filter((sale) => sale.status === 'COMPLETED'), [sales])
  const recordSale = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiFetch<{ sale: Sale }>('/api/my/business/sales', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: async () => {
      setProductTitle(''); setQuantity('1'); setUnitPrice(''); setUnitCost(''); setSaleNote(''); setAdjustStock(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['business-sales'] }),
        queryClient.invalidateQueries({ queryKey: ['business-stock'] }),
      ])
    },
  })
  const voidSale = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiFetch<{ sale: { id: string; status: string } }>(`/api/my/business/sales/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: async () => {
      setVoidingSaleId(null); setVoidReason('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['business-sales'] }),
        queryClient.invalidateQueries({ queryKey: ['business-stock'] }),
      ])
    },
  })
  const recordStock = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiFetch<{ movement: Movement }>('/api/my/business/stock', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: async () => {
      setStockTitle(''); setStockDelta('1'); setStockNote('')
      await queryClient.invalidateQueries({ queryKey: ['business-stock'] })
    },
  })

  function submitSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload: Record<string, unknown> = {
      quantity: Number(quantity), unitPrice: Number(unitPrice), channel, adjustStock,
      ...(unitCost.trim() ? { unitCost: Number(unitCost) } : {}),
      ...(saleNote.trim() ? { note: saleNote.trim() } : {}),
      ...(listingId ? { listingId } : { productTitle: productTitle.trim() }),
    }
    recordSale.mutate(payload)
  }
  function submitStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    recordStock.mutate({
      quantityDelta: Number(stockDelta), reason: stockReason,
      ...(stockNote.trim() ? { note: stockNote.trim() } : {}),
      ...(stockListingId ? { listingId: stockListingId } : { productTitle: stockTitle.trim() }),
    })
  }

  return (
    <section className="space-y-4" aria-labelledby="business-records-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="business-records-heading" className="text-xl font-semibold">Sales and stock records</h2>
          <p className="mt-1 text-sm text-muted-foreground">Record sales from your shop, WhatsApp, phone or in person. These are your records, not inferred orders.</p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Business records section">
          <Button type="button" variant={section === 'sales' ? 'default' : 'outline'} onClick={() => setSection('sales')}><ReceiptText className="mr-2 size-4" aria-hidden /> Sales</Button>
          <Button type="button" variant={section === 'stock' ? 'default' : 'outline'} onClick={() => setSection('stock')}><ClipboardList className="mr-2 size-4" aria-hidden /> Stock</Button>
        </div>
      </div>

      {section === 'sales' ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card>
            <CardHeader><CardTitle>Record a completed sale</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={submitSale}>
                <SelectField label="Product or service" value={listingId} onChange={setListingId}>
                  <option value="">Enter a product not listed on Mudaala</option>
                  {listings.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </SelectField>
                {!listingId ? <Field label="Product name"><Input value={productTitle} onChange={(event) => setProductTitle(event.target.value)} required maxLength={120} placeholder="e.g. 500 ml passion juice" /></Field> : (
                  <p className="text-xs text-muted-foreground">Linked to your listing: {selectedListing?.title}. Historical sale names are saved as a snapshot.</p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label={selectedListing?.unit ? `Quantity (${selectedListing.unit})` : 'Quantity'}><Input inputMode="decimal" type="number" min="0.001" max="1000000" step="0.001" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
                  <Field label="Selling price per unit (UGX)"><Input inputMode="decimal" type="number" min="0" max="100000000" step="0.01" required value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} placeholder="e.g. 2500" /></Field>
                  <Field label="Cost per unit (optional)"><Input inputMode="decimal" type="number" min="0" max="100000000" step="0.01" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} placeholder="Leave blank if unknown" /></Field>
                  <SelectField label="Where was it sold?" value={channel} onChange={setChannel}>
                    <option value="IN_PERSON">In person</option><option value="PHONE">Phone call</option><option value="WHATSAPP">WhatsApp</option><option value="MUDAALA">Through Mudaala</option><option value="OTHER">Other</option>
                  </SelectField>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={adjustStock} onChange={(event) => setAdjustStock(event.target.checked)} className="mt-1 size-4 accent-primary" />
                  <span><span className="font-medium">Reduce stock by this quantity</span><span className="block text-xs text-muted-foreground">Only select this if you have started tracking this product's stock. This creates a linked, auditable movement.</span></span>
                </label>
                <Field label="Note (optional)"><Input value={saleNote} onChange={(event) => setSaleNote(event.target.value)} maxLength={500} placeholder="Optional reference or note" /></Field>
                {recordSale.error instanceof Error ? <p role="alert" className="text-sm text-destructive">{recordSale.error.message}</p> : null}
                {recordSale.isSuccess ? <p role="status" className="text-sm text-primary">Sale recorded.</p> : null}
                <Button type="submit" disabled={recordSale.isPending || (!listingId && !productTitle.trim())} className="w-full">{recordSale.isPending ? 'Recording…' : 'Record sale'}</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle>Recent recorded sales</CardTitle><p className="mt-1 text-sm text-muted-foreground">{salesQuery.data?.total ?? 0} records in your ledger. Showing the latest page.</p></div><Button type="button" variant="outline" size="sm" onClick={() => { window.location.href = '/api/my/business/export?type=sales' }}>Export CSV</Button></CardHeader>
            <CardContent>
              {salesQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading sales…</p> : salesError ? <p role="alert" className="text-sm text-destructive">{salesError}</p> : completedRecent.length === 0 ? <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Your recorded sales will appear here. Sales made outside Mudaala count too, once you record them.</p> : (
                <div className="divide-y">
                  {sales.map((sale) => <div key={sale.id} className="flex items-start gap-3 py-3">
                    <span className="mt-0.5 rounded-md bg-muted p-2"><ReceiptText className="size-4" aria-hidden /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{sale.productTitle}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{quantityLabel(sale.quantity, sale.unit)} · {sale.channel.toLowerCase().replace('_', ' ')} · {new Date(sale.occurredAt).toLocaleDateString('en-UG')}</p>
                      {sale.status === 'VOIDED' ? <p className="text-xs text-destructive">Voided record. Excluded from recognized revenue.</p> : null}
                      {sale.status === 'COMPLETED' && sale.unitCost === null ? <p className="text-xs text-muted-foreground">Cost not entered; profit is unknown.</p> : null}
                      {sale.status === 'COMPLETED' && sale.unitCost !== null ? <p className="text-xs text-muted-foreground">Estimated gross profit: {money(sale.quantity * (sale.unitPrice - sale.unitCost), sale.currency)} before other expenses.</p> : null}
                      {sale.status === 'COMPLETED' && voidingSaleId === sale.id ? (
                        <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (voidReason.trim().length >= 3) voidSale.mutate({ id: sale.id, reason: voidReason.trim() }) }}>
                          <Input aria-label="Reason for voiding sale" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} maxLength={300} minLength={3} required placeholder="Reason for correction" className="min-w-0 flex-1" />
                          <Button type="submit" size="sm" variant="destructive" disabled={voidSale.isPending || voidReason.trim().length < 3}>{voidSale.isPending ? 'Voiding…' : 'Confirm'}</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => { setVoidingSaleId(null); setVoidReason('') }}>Cancel</Button>
                        </form>
                      ) : null}
                      {voidSale.error instanceof Error && voidingSaleId === sale.id ? <p role="alert" className="text-xs text-destructive">{voidSale.error.message}</p> : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">{money(sale.quantity * sale.unitPrice, sale.currency)}</p>
                      {sale.status === 'COMPLETED' ? <Button type="button" size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" onClick={() => { setVoidingSaleId(sale.id); setVoidReason(''); voidSale.reset() }}>Void</Button> : null}
                    </div>
                  </div>)}
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">Revenue shown per recorded sale is quantity × selling price. It is not net profit and excludes unrecorded costs and expenses.</p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card>
            <CardHeader><CardTitle>Record a stock movement</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={submitStock}>
                <SelectField label="Product or service" value={stockListingId} onChange={setStockListingId}>
                  <option value="">Enter a product not listed on Mudaala</option>
                  {listings.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </SelectField>
                {!stockListingId ? <Field label="Product name"><Input value={stockTitle} onChange={(event) => setStockTitle(event.target.value)} required maxLength={120} placeholder="e.g. 500 ml passion juice" /></Field> : <p className="text-xs text-muted-foreground">Linked to your listing: {selectedStockListing?.title}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Reason" value={stockReason} onChange={setStockReason}>
                    <option value="OPENING_BALANCE">Opening stock</option><option value="RESTOCK">Restock</option><option value="RETURN">Customer return</option><option value="ADJUSTMENT">Correction</option><option value="DAMAGED">Damaged goods</option><option value="LOST">Lost goods</option><option value="CORRECTION">Other correction</option>
                  </SelectField>
                  <Field label="Quantity change (use + or −)"><Input inputMode="decimal" type="number" min="-1000000" max="1000000" step="0.001" required value={stockDelta} onChange={(event) => setStockDelta(event.target.value)} /></Field>
                </div>
                <p className="text-xs text-muted-foreground">Opening stock, restocks and returns add stock. Damaged or lost goods remove stock. Corrections should explain what changed.</p>
                <Field label="Note (optional)"><Input value={stockNote} onChange={(event) => setStockNote(event.target.value)} maxLength={500} placeholder="e.g. 12 bottles received from supplier" /></Field>
                {recordStock.error instanceof Error ? <p role="alert" className="text-sm text-destructive">{recordStock.error.message}</p> : null}
                {recordStock.isSuccess ? <p role="status" className="text-sm text-primary">Stock movement recorded.</p> : null}
                <Button type="submit" disabled={recordStock.isPending || (!stockListingId && !stockTitle.trim())} className="w-full">{recordStock.isPending ? 'Recording…' : 'Record stock movement'}</Button>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle>Current recorded stock</CardTitle><p className="mt-1 text-sm text-muted-foreground">Calculated from your stock movement history, not from listing quantity.</p></div><Button type="button" variant="outline" size="sm" onClick={() => { window.location.href = '/api/my/business/export?type=stock' }}>Export CSV</Button></CardHeader>
              <CardContent>
                {stockQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading stock…</p> : stockError ? <p role="alert" className="text-sm text-destructive">{stockError}</p> : balances.length === 0 ? <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Start with an opening balance for each product you want to track.</p> : <div className="divide-y">
                  {balances.map((balance, index) => <div key={`${balance.listingId ?? 'custom'}-${balance.productTitle}-${balance.unit ?? ''}-${index}`} className="flex items-center gap-3 py-3">
                    <span className="rounded-md bg-muted p-2">{balance.quantityOnHand < 0 ? <ArrowDownRight className="size-4 text-destructive" aria-hidden /> : <ArrowUpRight className="size-4 text-primary" aria-hidden />}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{balance.productTitle}</p><p className="text-xs text-muted-foreground">{balance.movementCount} stock movements</p>{balance.quantityOnHand < 0 ? <p className="text-xs text-destructive">Below zero. Check opening stock and recorded movements.</p> : null}</div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{quantityLabel(balance.quantityOnHand, balance.unit)}</p>
                  </div>)}
                </div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Recent stock history</CardTitle></CardHeader>
              <CardContent>{(stockQuery.data?.movements ?? []).slice(0, 8).length === 0 ? <p className="text-sm text-muted-foreground">Movements will appear here after you record them.</p> : <div className="divide-y">{(stockQuery.data?.movements ?? []).slice(0, 8).map((movement) => <div key={movement.id} className="flex items-start justify-between gap-3 py-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{movement.productTitle}</p><p className="text-xs text-muted-foreground">{movement.reason.toLowerCase().replace('_', ' ')} · {new Date(movement.occurredAt).toLocaleDateString('en-UG')}</p></div><p className={`shrink-0 text-sm font-semibold tabular-nums ${movement.quantityDelta < 0 ? 'text-destructive' : 'text-primary'}`}>{movement.quantityDelta > 0 ? '+' : ''}{quantityLabel(movement.quantityDelta, movement.unit)}</p></div>)}</div>}</CardContent>
            </Card>
          </div>
        </div>
      )}
    </section>
  )
}
