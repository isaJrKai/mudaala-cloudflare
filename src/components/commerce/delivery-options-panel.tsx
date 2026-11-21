'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/client'
import { useToast } from '@/hooks/use-toast'

type DeliveryOption = {
  id: string
  name: string
  method: 'PICKUP' | 'SELLER_DELIVERY' | 'COURIER'
  district: string | null
  area: string | null
  fee: number
  minDays: number
  maxDays: number
  isActive: boolean
}

const empty: { name: string; method: DeliveryOption['method']; district: string; area: string; fee: string; minDays: string; maxDays: string } = { name: '', method: 'SELLER_DELIVERY', district: '', area: '', fee: '0', minDays: '0', maxDays: '2' }

export function DeliveryOptionsPanel() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const query = useQuery({
    queryKey: ['delivery-options'],
    queryFn: () => apiGet<{ options: DeliveryOption[] }>('/api/my/delivery-options'),
  })

  async function createOption() {
    setSaving(true)
    try {
      await apiPost('/api/my/delivery-options', {
        name: form.name,
        method: form.method,
        district: form.district || null,
        area: form.area || null,
        fee: Number(form.fee),
        minDays: Number(form.minDays),
        maxDays: Number(form.maxDays),
      })
      setForm(empty)
      await queryClient.invalidateQueries({ queryKey: ['delivery-options'] })
      toast({ title: 'Delivery option saved' })
    } catch (error) {
      toast({ title: 'Could not save delivery option', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function toggle(option: DeliveryOption) {
    try {
      await apiPatch(`/api/my/delivery-options/${option.id}`, { isActive: !option.isActive })
      await queryClient.invalidateQueries({ queryKey: ['delivery-options'] })
    } catch (error) {
      toast({ title: 'Could not update delivery option', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
    }
  }

  async function remove(option: DeliveryOption) {
    try {
      await apiDelete(`/api/my/delivery-options/${option.id}`)
      await queryClient.invalidateQueries({ queryKey: ['delivery-options'] })
      toast({ title: 'Delivery option deactivated' })
    } catch (error) {
      toast({ title: 'Could not deactivate option', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
    }
  }

  return (
    <section className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2"><Truck className="size-4 text-primary" /><h2 className="text-sm font-semibold">Delivery and collection</h2></div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Set the areas you serve, fees and estimated delivery windows. Buyers see these as estimates until you confirm an order.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Input value={form.name} placeholder="Option name · e.g. Kampala delivery" onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} />
        <Select value={form.method} onValueChange={(value: DeliveryOption['method']) => setForm((v) => ({ ...v, method: value }))}>
          <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="PICKUP">Customer pickup</SelectItem>
            <SelectItem value="SELLER_DELIVERY">Seller delivery</SelectItem>
            <SelectItem value="COURIER">Courier</SelectItem>
          </SelectContent>
        </Select>
        <Input value={form.district} placeholder="District · optional" onChange={(e) => setForm((v) => ({ ...v, district: e.target.value }))} />
        <Input value={form.area} placeholder="Area or neighbourhood · optional" onChange={(e) => setForm((v) => ({ ...v, area: e.target.value }))} />
        <Input type="number" min="0" step="1" value={form.fee} placeholder="Delivery fee (UGX)" onChange={(e) => setForm((v) => ({ ...v, fee: e.target.value }))} />
        <div className="grid grid-cols-2 gap-2"><Input aria-label="Minimum days" type="number" min="0" max="60" value={form.minDays} onChange={(e) => setForm((v) => ({ ...v, minDays: e.target.value }))} /><Input aria-label="Maximum days" type="number" min="0" max="60" value={form.maxDays} onChange={(e) => setForm((v) => ({ ...v, maxDays: e.target.value }))} /></div>
      </div>
      <Button className="mt-3" size="sm" disabled={saving || !form.name.trim() || Number(form.maxDays) < Number(form.minDays)} onClick={() => void createOption()}><Plus className="mr-1 size-3.5" /> Add delivery option</Button>
      <div className="mt-4 space-y-2">
        {query.isLoading ? <p className="text-xs text-muted-foreground">Loading delivery options…</p> : null}
        {query.error ? <p className="text-xs text-destructive">Could not load delivery options.</p> : null}
        {(query.data?.options ?? []).map((option) => (
          <div key={option.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">{option.name}</p><p className="text-xs text-muted-foreground">{option.method.replace(/_/g, ' ').toLowerCase()} · {option.district ?? 'Any district'}{option.area ? ' · ' + option.area : ''} · UGX {option.fee.toLocaleString()} · {option.minDays}–{option.maxDays} days</p></div>
            <span className="text-xs text-muted-foreground">{option.isActive ? 'Active' : 'Inactive'}</span>
            <Button size="sm" variant="outline" onClick={() => void toggle(option)}>{option.isActive ? 'Pause' : 'Activate'}</Button>
            {option.isActive ? <Button size="sm" variant="ghost" onClick={() => void remove(option)} className="text-muted-foreground">Remove</Button> : null}
          </div>
        ))}
        {!query.isLoading && !query.error && (query.data?.options.length ?? 0) === 0 ? <p className="rounded-lg bg-secondary/35 px-3 py-3 text-xs text-muted-foreground">No delivery options yet. Add pickup or delivery terms for buyers to choose at checkout.</p> : null}
      </div>
    </section>
  )
}
