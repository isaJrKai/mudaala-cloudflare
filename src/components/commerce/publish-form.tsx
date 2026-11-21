'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { apiPost, apiPatch, apiGet, apiPut } from '@/lib/client'
import type { Listing, SessionUser } from '@/lib/client'
import { listingCreateSchema, fieldErrors } from '@/lib/validation'
import { listingFormCategoryFields } from '@/lib/listing-form-fields'
import { CATEGORIES, UNITS, CURRENCIES, countryDef, currencyDef } from '@/lib/constants'
import { findTaxonomyNode, taxonomyAncestors, taxonomyChildren } from '@/lib/product-taxonomy'
import { useAppStore } from '@/lib/store'
import { useSession } from '@/hooks/use-session'
import { ErrorState } from './listings-browse'
import { ListingListSkeleton } from './skeletons'
import { PhotoPicker } from './photo-picker'
import { cn } from '@/lib/utils'
import { copy } from '@/lib/copy'

type VariantEditorRow = {
  variantId?: string
  businessProductId: string
  label: string
  optionsText: string
  sku: string
  price: string
  stockQuantity: string
  trackInventory: boolean
  availabilityStatus: 'UNKNOWN' | 'IN_STOCK' | 'AVAILABLE_ON_ORDER' | 'OUT_OF_STOCK'
  photos: string[]
}

interface FormState {
  type: 'OFFER' | 'REQUEST'
  title: string
  description: string
  category: string
  taxonomyId: string
  brand: string
  model: string
  attributes: Record<string, string | number | boolean>
  price: string
  compareAtPrice: string
  currency: string
  priceNegotiable: boolean
  unit: string
  quantity: string
  county: string
  area: string
  contactPhone: string
  contactWhatsapp: string
  photos: string[]
}

const EMPTY_FORM: FormState = {
  type: 'OFFER',
  title: '',
  description: '',
  category: 'none',
  taxonomyId: 'none',
  brand: '',
  model: '',
  attributes: {},
  price: '',
  compareAtPrice: '',
  currency: 'UGX',
  priceNegotiable: false,
  unit: 'none',
  quantity: '',
  county: 'none',
  area: '',
  contactPhone: '',
  contactWhatsapp: '',
  photos: [],
}

// Publish (and edit) a listing. Required fields are validated with the SAME
// shared schema the API uses; failed submissions preserve everything typed.
export function PublishForm() {
  const { navigate, setAuthOpen } = useAppStore()
  const { user, isLoading: sessionLoading } = useSession()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const selectedTaxonomyPath = form.taxonomyId !== 'none' ? taxonomyAncestors(form.taxonomyId) : []
  const selectedTaxonomyGroup = selectedTaxonomyPath[1]?.id ?? 'none'
  const selectedTaxonomyType = selectedTaxonomyPath[2]?.id ?? 'none'
  const taxonomyGroupOptions = form.category !== 'none' ? taxonomyChildren(form.category) : []
  const taxonomyTypeOptions = selectedTaxonomyGroup !== 'none' ? taxonomyChildren(selectedTaxonomyGroup) : []
  const selectedTaxonomyAttributes = (() => { const definitions = form.taxonomyId !== 'none' ? [...(findTaxonomyNode(form.taxonomyId)?.attributes ?? [])] : []; return definitions.some((attribute) => attribute.key === 'brand') ? definitions : [{ key: 'brand', label: 'Brand', type: 'text' as const }, ...definitions] })()

  useEffect(() => {
    if (!user) return
    // Defer defaults until after the effect phase; preserve values already typed.
    const timer = window.setTimeout(() => {
      setForm((f) => ({
        ...f,
        contactPhone: f.contactPhone === '' ? user.phone : f.contactPhone,
        currency: f.currency === 'UGX' ? countryDef(user.country ?? 'UG').currency : f.currency,
      }))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [user])

  if (sessionLoading) {
    return <ListingListSkeleton count={3} />
  }

  if (!user) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">{copy.publish.signInTitle}</h1>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{copy.publish.signInSub}</p>
        <div className="mt-4 flex w-full flex-col justify-center gap-2 min-[400px]:flex-row">
          <Button className="w-full min-[400px]:w-auto" onClick={() => setAuthOpen(true)}>{copy.publish.signInCta}</Button>
          <Button className="w-full min-[400px]:w-auto" variant="outline" onClick={() => navigate({ name: 'browse' })}>
            {copy.publish.keepBrowsing}
          </Button>
        </div>
      </div>
    )
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => {
      if (!e[key]) return e
      const next = { ...e }
      delete next[key]
      return next
    })
  }

  function buildPayload() {
    const priceRaw = form.price.trim()
    const oldPriceRaw = form.compareAtPrice.trim()
    const quantityRaw = form.quantity.trim()
    const stockFields = listingFormCategoryFields(form.category, oldPriceRaw, form.unit, quantityRaw, priceRaw, form.priceNegotiable)
    return {
      type: form.type,
      title: form.title,
      description: form.description,
      category: form.category === 'none' ? undefined : form.category,
      taxonomyId: form.taxonomyId === 'none' ? null : form.taxonomyId,
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      attributes: Object.keys(form.attributes).length > 0 ? form.attributes : undefined,
      price: priceRaw === '' ? null : Number(priceRaw),
      ...stockFields,
      currency: form.currency,
      country: user?.country ?? 'UG',
      county: form.county === 'none' ? undefined : form.county,
      area: form.area.trim() === '' ? null : form.area.trim(),
      contactPhone: form.contactPhone,
      contactWhatsapp: form.contactWhatsapp.trim() === '' ? null : form.contactWhatsapp.trim(),
      photos: form.photos,
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    const payload = buildPayload()

    const parsed = listingCreateSchema.safeParse(payload)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }

    setBusy(true)
    try {
      const { listing } = await apiPost<{ listing: Listing }>('/api/listings', parsed.data)
      await queryClient.invalidateQueries({ queryKey: ['listings'] })
      await queryClient.invalidateQueries({ queryKey: ['my-listings'] })
      toast({ title: copy.publish.publishedToast, description: copy.publish.publishedToastSub })
      navigate({ name: 'listing', id: listing.id })
    } catch (err) {
      const withFields = err as Error & { fields?: Record<string, string> }
      if (withFields.fields) setErrors(withFields.fields)
      else
        toast({
          title: copy.publish.failedToast,
          description: withFields.message,
          variant: 'destructive',
        })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5" autoComplete="on">
      <Button type="button" variant="ghost" size="sm" className="-ml-2 gap-1 press" onClick={() => navigate({ name: 'browse' })}>
        <ArrowLeft className="size-4" aria-hidden /> Cancel
      </Button>

      <div>
        <h1 className="text-xl font-semibold tracking-tight">{copy.publish.title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{copy.publish.sub}</p>
      </div>

      <div className="space-y-1.5" role="group" aria-label="Listing type">
        <Label>{copy.publish.iWantTo}</Label>
        <div className="grid grid-cols-2 gap-2">
          {(['OFFER', 'REQUEST'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={form.type === t}
              onClick={() => {
                set('type', t)
                // Discounts belong to offers; clear the disabled field so a
                // stale old price never rides along with a REQUEST.
                if (t === 'REQUEST') set('compareAtPrice', '')
              }}
              className={cn(
                'press rounded-md border px-3 py-2.5 text-sm font-medium transition-colors',
                form.type === t ? 'border-primary bg-accent text-accent-foreground' : 'bg-card text-muted-foreground hover:bg-secondary',
              )}
            >
              {t === 'OFFER' ? copy.publish.sell : copy.publish.buy}
            </button>
          ))}
        </div>
      </div>

      <Field
        label={form.category === 'other' ? 'What are you selling?' : 'What exactly?'}
        htmlFor="p-title"
        error={errors.title}
        hint={`${form.title.length}/120`}
      >
        <Input
          id="p-title"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder={
            form.category === 'services'
              ? "e.g. Women's haircut, wedding photography, plumbing repair"
              : form.category === 'other'
              ? form.type === 'OFFER'
                ? 'e.g. perfume, spare parts, firewood'
                : 'e.g. Need a specific item or material'
              : form.type === 'OFFER'
                ? copy.publish.titlePlaceholderOffer
                : copy.publish.titlePlaceholderRequest
          }
          maxLength={120}
          required
        />
      </Field>

      <Field label="Category" htmlFor="p-category" error={errors.category}>
        <Select value={form.category} onValueChange={(v) => {
          set('category', v)
          set('taxonomyId', 'none')
          set('attributes', {})
          set('brand', '')
          set('model', '')
        }}>
          <SelectTrigger id="p-category" aria-invalid={Boolean(errors.category)}>
            <SelectValue placeholder="Choose a category" />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {CATEGORIES.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.label}
                <span className="ml-1.5 text-xs text-muted-foreground">({c.examples})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {taxonomyGroupOptions.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Product group" htmlFor="p-taxonomy-group">
            <Select value={selectedTaxonomyGroup} onValueChange={(v) => {
              set('taxonomyId', v)
              set('attributes', {})
              set('brand', '')
              set('model', '')
            }}>
              <SelectTrigger id="p-taxonomy-group"><SelectValue placeholder="Choose a product group" /></SelectTrigger>
              <SelectContent>
                {taxonomyGroupOptions.map((node) => <SelectItem key={node.id} value={node.id}>{node.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {taxonomyTypeOptions.length > 0 ? (
            <Field label="Product type" htmlFor="p-taxonomy-type">
              <Select value={selectedTaxonomyType} onValueChange={(v) => {
                set('taxonomyId', v)
                set('attributes', {})
                set('brand', '')
                set('model', '')
              }}>
                <SelectTrigger id="p-taxonomy-type"><SelectValue placeholder="Choose a product type" /></SelectTrigger>
                <SelectContent>
                  {taxonomyTypeOptions.map((node) => <SelectItem key={node.id} value={node.id}>{node.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </div>
      ) : null}

      {selectedTaxonomyAttributes.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {selectedTaxonomyAttributes.map((attribute) => {
            if (attribute.key === 'brand' || attribute.key === 'model') {
              const value = form[attribute.key]
              return (
                <Field key={attribute.key} label={attribute.label} htmlFor={`p-${attribute.key}`}>
                  <Input id={`p-${attribute.key}`} value={value} onChange={(e) => set(attribute.key as 'brand' | 'model', e.target.value)} maxLength={attribute.key === 'brand' ? 80 : 100} />
                </Field>
              )
            }
            const value = form.attributes[attribute.key]
            if (attribute.type === 'enum' && attribute.options) {
              return (
                <Field key={attribute.key} label={attribute.label} htmlFor={`p-attr-${attribute.key}`}>
                  <Select value={typeof value === 'string' ? value : 'none'} onValueChange={(v) => set('attributes', { ...form.attributes, [attribute.key]: v })}>
                    <SelectTrigger id={`p-attr-${attribute.key}`}><SelectValue placeholder={`Choose ${attribute.label.toLowerCase()}`} /></SelectTrigger>
                    <SelectContent>
                      {attribute.options.map((option) => <SelectItem key={option} value={option}>{option.replaceAll('_', ' ')}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )
            }
            if (attribute.type === 'boolean') {
              return (
                <label key={attribute.key} className="flex items-center gap-2 self-end rounded-md border px-3 py-2.5 text-sm">
                  <Checkbox checked={value === true} onCheckedChange={(checked) => set('attributes', { ...form.attributes, [attribute.key]: checked === true })} />
                  {attribute.label}
                </label>
              )
            }
            return (
              <Field key={attribute.key} label={attribute.label} htmlFor={`p-attr-${attribute.key}`}>
                <Input
                  id={`p-attr-${attribute.key}`}
                  type={attribute.type === 'number' ? 'number' : 'text'}
                  value={value === undefined ? '' : String(value)}
                  maxLength={attribute.type === 'text' ? 120 : undefined}
                  onChange={(e) => {
                    const nextAttributes = { ...form.attributes }
                    if (e.target.value.trim() === '') delete nextAttributes[attribute.key]
                    else nextAttributes[attribute.key] = attribute.type === 'number' ? Number(e.target.value) : e.target.value
                    set('attributes', nextAttributes)
                  }}
                />
              </Field>
            )
          })}
        </div>
      ) : null}

      {form.category === 'services' ? (
        <p className="rounded-md border border-primary/20 bg-accent/40 px-3 py-2.5 text-sm text-muted-foreground">Describe the service, the area you cover and what customers should expect. Leave the price empty if customers need to request a quote.</p>
      ) : null}

      <Field label="Description" htmlFor="p-desc" error={errors.description} hint={`${form.description.length}/2000`}>
        <Textarea
          id="p-desc"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder={
            form.type === 'OFFER'
              ? (form.category === 'services' ? 'Describe your service, experience, what is included and where you work.' : copy.publish.descPlaceholderOffer)
              : copy.publish.descPlaceholderRequest
          }
          required
        />
      </Field>

      <Field label={copy.publish.photos} htmlFor="p-photos" hint={copy.publish.photosHint}>
        <PhotoPicker value={form.photos} onChange={(photos) => set('photos', photos)} max={4} />
      </Field>

      <div className="rounded-lg border bg-secondary/30 p-3.5">
        <div className={cn('grid grid-cols-1 gap-4', form.category === 'services' ? 'sm:grid-cols-1' : 'sm:grid-cols-3')}>
          <Field label={form.category === 'services' ? (form.type === 'OFFER' ? 'Price / starting price' : 'Budget / maximum budget') : form.type === 'OFFER' ? copy.common.price : copy.common.budget} htmlFor="p-price" error={errors.price}>
            <div className="flex gap-2">
              <Input
                id="p-price"
                type="number"
                inputMode="decimal"
                min={0}
                step={currencyDef(form.currency).zeroDecimal ? '1' : '0.01'}
                value={form.price}
                onChange={(e) => set('price', e.target.value)}
                placeholder={form.category === 'services' ? 'Leave empty to request a quote' : 'Leave empty if negotiable'}
                className="flex-1"
              />
              {/* Native select: opens the phone's own picker, easiest for everyone. */}
              <select
                aria-label="Currency"
                value={form.currency}
                onChange={(e) => set('currency', e.target.value)}
                className="h-9 shrink-0 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.symbol}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          {form.category !== 'services' ? (
          <Field
            label={copy.publish.oldPrice}
            htmlFor="p-compare"
            error={errors.compareAtPrice}
            hint={form.type === 'OFFER' ? copy.publish.oldPriceHint : undefined}
          >
            <Input
              id="p-compare"
              type="number"
              inputMode="decimal"
              min={0}
              step={currencyDef(form.currency).zeroDecimal ? '1' : '0.01'}
              value={form.compareAtPrice}
              onChange={(e) => set('compareAtPrice', e.target.value)}
              placeholder="e.g. 30000"
              disabled={form.type === 'REQUEST'}
            />
          </Field>
          ) : null}
          {form.category !== 'services' ? (
          <Field label={copy.publish.per} htmlFor="p-unit" error={errors.unit}>
            <Select value={form.unit} onValueChange={(v) => set('unit', v)}>
              <SelectTrigger id="p-unit" aria-invalid={Boolean(errors.unit)}>
                <SelectValue placeholder={copy.publish.unitPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => (
                  <SelectItem key={u.key} value={u.key}>
                    per {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          ) : null}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <Checkbox checked={form.priceNegotiable || (form.category === 'services' && form.price.trim() === '')} onCheckedChange={(v) => set('priceNegotiable', v === true)} />
          {form.category === 'services' ? (form.type === 'OFFER' ? 'Price is negotiable or quote required' : 'Budget is flexible') : copy.publish.priceNegotiable}
        </label>
      </div>

      <div className={cn('grid grid-cols-1 gap-4', form.category === 'services' ? 'sm:grid-cols-1' : 'sm:grid-cols-2')}>
        {form.category !== 'services' ? (
        <Field label={copy.publish.quantity} htmlFor="p-qty" error={errors.quantity}>
          <Input
            id="p-qty"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={form.quantity}
            onChange={(e) => set('quantity', e.target.value)}
            placeholder="e.g. 500"
          />
        </Field>
        ) : null}
        <Field label={copy.browse.district} htmlFor="p-county" error={errors.county}>
          <Select value={form.county} onValueChange={(v) => set('county', v)}>
            <SelectTrigger id="p-county" aria-invalid={Boolean(errors.county)}>
              <SelectValue placeholder="Choose district" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {countryDef(user.country ?? 'UG').locations.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label={copy.publish.area} htmlFor="p-area" error={errors.area}>
        <Input id="p-area" value={form.area} onChange={(e) => set('area', e.target.value)} maxLength={80} placeholder="e.g. Kisenyi" />
      </Field>

      <div className="rounded-lg border bg-secondary/30 p-3.5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={copy.publish.contactPhone} htmlFor="p-phone" error={errors.contactPhone}>
            <Input
              id="p-phone"
              type="tel"
              inputMode="tel"
              value={form.contactPhone}
              onChange={(e) => set('contactPhone', e.target.value)}
              placeholder="0712 345 678"
              required
            />
          </Field>
          <Field label={copy.publish.whatsapp} htmlFor="p-wa" error={errors.contactWhatsapp} hint={copy.publish.whatsappHint}>
            <Input
              id="p-wa"
              type="tel"
              inputMode="tel"
              value={form.contactWhatsapp}
              onChange={(e) => set('contactWhatsapp', e.target.value)}
              placeholder="0712 345 678"
            />
          </Field>
        </div>
      </div>

      {errors._ ? (
        <p role="alert" className="text-sm text-destructive">
          {errors._}
        </p>
      ) : null}

      <div className="flex gap-2 pb-2">
        <Button type="submit" disabled={busy} className="mudaala-money-cta press flex-1 sm:flex-none sm:px-8">
          {busy ? copy.publish.submitting : copy.publish.submit}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate({ name: 'browse' })} disabled={busy} className="press">
          {copy.common.cancel}
        </Button>
      </div>
    </form>
  )
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

// Edit an existing ACTIVE listing (owner only).
export function EditListingForm({ id }: { id: string }) {
  const { navigate } = useAppStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [loaded, setLoaded] = useState<Listing | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [variantRows, setVariantRows] = useState<VariantEditorRow[]>([])
  const [inventoryProducts, setInventoryProducts] = useState<Array<{ id: string; name: string; sku: string | null; stockOnHand: number; listingId: string | null; listingVariantId: string | null }>>([])
  const selectedTaxonomyPath = form.taxonomyId !== 'none' ? taxonomyAncestors(form.taxonomyId) : []
  const selectedTaxonomyGroup = selectedTaxonomyPath[1]?.id ?? 'none'
  const selectedTaxonomyType = selectedTaxonomyPath[2]?.id ?? 'none'
  const taxonomyGroupOptions = form.category !== 'none' ? taxonomyChildren(form.category) : []
  const taxonomyTypeOptions = selectedTaxonomyGroup !== 'none' ? taxonomyChildren(selectedTaxonomyGroup) : []
  const selectedTaxonomyAttributes = (() => { const definitions = form.taxonomyId !== 'none' ? [...(findTaxonomyNode(form.taxonomyId)?.attributes ?? [])] : []; return definitions.some((attribute) => attribute.key === 'brand') ? definitions : [{ key: 'brand', label: 'Brand', type: 'text' as const }, ...definitions] })()

  useEffect(() => {
    apiGet<{ listing: Listing }>(`/api/listings/${id}`)
      .then(({ listing }) => {
        setLoaded(listing)
        apiGet<{ variants: Array<{ id: string; businessProduct: { id: string } | null }>; inventoryProducts: Array<{ id: string; name: string; sku: string | null; stockOnHand: number; listingId: string | null; listingVariantId: string | null }> }>(`/api/listings/${id}/variants`)
          .then(({ variants, inventoryProducts: products }) => {
            setInventoryProducts(products)
            const linked = new Map(variants.map((variant) => [variant.id, variant.businessProduct?.id ?? '']))
            setVariantRows((rows) => rows.map((row) => ({ ...row, businessProductId: row.variantId ? linked.get(row.variantId) ?? '' : '' })))
          })
          .catch(() => setInventoryProducts([]))
        setVariantRows((listing.variants ?? []).map((variant) => ({
          variantId: variant.id,
          businessProductId: '',
          label: variant.label,
          optionsText: Object.entries(variant.options).map(([key, value]) => `${key}=${value}`).join(', '),
          sku: variant.sku ?? '',
          price: variant.price === null ? '' : String(variant.price),
          stockQuantity: variant.stockQuantity === null ? '' : String(variant.stockQuantity),
          trackInventory: variant.trackInventory,
          availabilityStatus: variant.availabilityStatus,
          photos: variant.photos ?? [],
        })))
        setForm({
          type: listing.type,
          title: listing.title,
          description: listing.description,
          category: listing.category,
          taxonomyId: listing.taxonomyId ?? 'none',
          brand: listing.brand ?? '',
          model: listing.model ?? '',
          attributes: listing.attributes ?? {},
          price: listing.price === null ? '' : String(listing.price),
          compareAtPrice: listing.type === 'OFFER' && listing.compareAtPrice !== null && listing.compareAtPrice !== undefined ? String(listing.compareAtPrice) : '',
          currency: listing.currency ?? 'UGX',
          priceNegotiable: listing.priceNegotiable,
          unit: listing.unit ?? 'none',
          quantity: listing.quantity === null ? '' : String(listing.quantity),
          county: listing.county,
          area: listing.area ?? '',
          contactPhone: listing.contactPhone,
          contactWhatsapp: listing.contactWhatsapp ?? '',
          photos: listing.photos ?? [],
        })
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not load listing'))
  }, [id])

  const unitOptions = useMemo(() => UNITS, [])

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => window.location.reload()} />
  }
  if (!loaded) {
    return <ListingListSkeleton count={3} />
  }
  if (loaded.status !== 'ACTIVE') {
    return (
      <div className="rounded-lg border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">This listing is {loaded.status.toLowerCase()}</h1>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Reactivate it from My Listings before editing its details.</p>
        <Button className="mt-4" onClick={() => navigate({ name: 'my-listings' })}>
          Go to My Listings
        </Button>
      </div>
    )
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => {
      if (!e[key]) return e
      const next = { ...e }
      delete next[key]
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    const current = loaded
    if (!current) return

    const priceRaw = form.price.trim()
    const oldPriceRaw = form.compareAtPrice.trim()
    const quantityRaw = form.quantity.trim()
    const stockFields = listingFormCategoryFields(form.category, oldPriceRaw, form.unit, quantityRaw, priceRaw, form.priceNegotiable)
    const payload = {
      title: form.title,
      description: form.description,
      category: form.category === 'none' ? undefined : form.category,
      taxonomyId: form.taxonomyId === 'none' ? null : form.taxonomyId,
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      attributes: form.attributes,
      price: priceRaw === '' ? null : Number(priceRaw),
      ...stockFields,
      currency: form.currency,
      county: form.county === 'none' ? undefined : form.county,
      area: form.area.trim() === '' ? null : form.area.trim(),
      contactPhone: form.contactPhone,
      contactWhatsapp: form.contactWhatsapp.trim() === '' ? null : form.contactWhatsapp.trim(),
      photos: form.photos,
    }

    const parsed = listingCreateSchema.safeParse({ ...payload, type: current.type })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }

    setBusy(true)
    try {
      await apiPatch(`/api/listings/${id}`, payload)
      await apiPut(`/api/listings/${id}/variants`, {
        variants: variantRows.map((row) => ({
          label: row.label.trim(),
          options: Object.fromEntries(row.optionsText.split(',').map((part) => {
            const [key, ...value] = part.split('=')
            return [key.trim(), value.join('=').trim()] as [string, string]
          }).filter(([key, value]) => key && value)),
          sku: row.sku.trim() || null,
          price: row.price.trim() ? Number(row.price) : null,
          stockQuantity: row.stockQuantity.trim() ? Number(row.stockQuantity) : null,
          trackInventory: row.trackInventory,
          availabilityStatus: row.availabilityStatus,
          photos: row.photos,
          businessProductId: row.businessProductId || null,
        })),
      })
      await queryClient.invalidateQueries({ queryKey: ['listings'] })
      await queryClient.invalidateQueries({ queryKey: ['listing', id] })
      await queryClient.invalidateQueries({ queryKey: ['my-listings'] })
      toast({ title: 'Listing updated' })
      navigate({ name: 'listing', id })
    } catch (err) {
      const withFields = err as Error & { fields?: Record<string, string> }
      if (withFields.fields) setErrors(withFields.fields)
      else toast({ title: 'Could not save changes', description: withFields.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <Button type="button" variant="ghost" size="sm" className="-ml-2 gap-1" onClick={() => navigate({ name: 'listing', id })}>
        <ArrowLeft className="size-4" aria-hidden /> Back to listing
      </Button>
      <h1 className="text-xl font-semibold tracking-tight">{copy.publish.editTitle}</h1>

      <Field label="Title" htmlFor="e-title" error={errors.title} hint={`${form.title.length}/120`}>
        <Input id="e-title" value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={120} required />
      </Field>

      <Field label="Category" htmlFor="e-category" error={errors.category}>
        <Select value={form.category} onValueChange={(v) => {
          set('category', v)
          set('taxonomyId', 'none')
          set('attributes', {})
          set('brand', '')
          set('model', '')
        }}>
          <SelectTrigger id="e-category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {CATEGORIES.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {taxonomyGroupOptions.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Product group" htmlFor="e-taxonomy-group">
            <Select value={selectedTaxonomyGroup} onValueChange={(v) => {
              set('taxonomyId', v)
              set('attributes', {})
              set('brand', '')
              set('model', '')
            }}>
              <SelectTrigger id="e-taxonomy-group"><SelectValue placeholder="Choose a product group" /></SelectTrigger>
              <SelectContent>
                {taxonomyGroupOptions.map((node) => <SelectItem key={node.id} value={node.id}>{node.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {taxonomyTypeOptions.length > 0 ? (
            <Field label="Product type" htmlFor="e-taxonomy-type">
              <Select value={selectedTaxonomyType} onValueChange={(v) => {
                set('taxonomyId', v)
                set('attributes', {})
                set('brand', '')
                set('model', '')
              }}>
                <SelectTrigger id="e-taxonomy-type"><SelectValue placeholder="Choose a product type" /></SelectTrigger>
                <SelectContent>
                  {taxonomyTypeOptions.map((node) => <SelectItem key={node.id} value={node.id}>{node.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </div>
      ) : null}

      {selectedTaxonomyAttributes.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {selectedTaxonomyAttributes.map((attribute) => {
            if (attribute.key === 'brand' || attribute.key === 'model') {
              return (
                <Field key={attribute.key} label={attribute.label} htmlFor={`e-${attribute.key}`}>
                  <Input id={`e-${attribute.key}`} value={form[attribute.key]} onChange={(event) => set(attribute.key as 'brand' | 'model', event.target.value)} maxLength={attribute.key === 'brand' ? 80 : 100} />
                </Field>
              )
            }
            const value = form.attributes[attribute.key]
            if (attribute.type === 'enum' && attribute.options) {
              return (
                <Field key={attribute.key} label={attribute.label} htmlFor={`e-attr-${attribute.key}`}>
                  <Select value={typeof value === 'string' ? value : 'none'} onValueChange={(v) => set('attributes', { ...form.attributes, [attribute.key]: v })}>
                    <SelectTrigger id={`e-attr-${attribute.key}`}><SelectValue placeholder={`Choose ${attribute.label.toLowerCase()}`} /></SelectTrigger>
                    <SelectContent>
                      {attribute.options.map((option) => <SelectItem key={option} value={option}>{option.replaceAll('_', ' ')}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )
            }
            if (attribute.type === 'boolean') {
              return (
                <label key={attribute.key} className="flex items-center gap-2 self-end rounded-md border px-3 py-2.5 text-sm">
                  <Checkbox checked={value === true} onCheckedChange={(checked) => set('attributes', { ...form.attributes, [attribute.key]: checked === true })} />
                  {attribute.label}
                </label>
              )
            }
            return (
              <Field key={attribute.key} label={attribute.label} htmlFor={`e-attr-${attribute.key}`}>
                <Input
                  id={`e-attr-${attribute.key}`}
                  type={attribute.type === 'number' ? 'number' : 'text'}
                  value={value === undefined ? '' : String(value)}
                  maxLength={attribute.type === 'text' ? 120 : undefined}
                  onChange={(event) => {
                    const nextAttributes = { ...form.attributes }
                    if (event.target.value.trim() === '') delete nextAttributes[attribute.key]
                    else nextAttributes[attribute.key] = attribute.type === 'number' ? Number(event.target.value) : event.target.value
                    set('attributes', nextAttributes)
                  }}
                />
              </Field>
            )
          })}
        </div>
      ) : null}

      {form.category === 'services' ? (
        <p className="rounded-md border border-primary/20 bg-accent/40 px-3 py-2.5 text-sm text-muted-foreground">Describe the service, the area you cover and what customers should expect. Leave the price empty if customers need to request a quote.</p>
      ) : null}

      <Field label="Description" htmlFor="e-desc" error={errors.description} hint={`${form.description.length}/2000`}>
        <Textarea id="e-desc" value={form.description} onChange={(e) => set('description', e.target.value)} rows={5} maxLength={2000} required />
      </Field>

      {loaded.type === 'OFFER' ? (
        <section className="space-y-3 rounded-lg border bg-secondary/25 p-3.5" aria-label="Product options">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Product options</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Add sizes, colours, storage, materials or any combination. Leave this empty for a product with one standard option.</p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => setVariantRows((rows) => [...rows, {
              variantId: undefined, businessProductId: '', label: '', optionsText: '', sku: '', price: '', stockQuantity: '', trackInventory: false,
              availabilityStatus: 'UNKNOWN', photos: [],
            }])}>Add option</Button>
          </div>
          {variantRows.map((row, index) => (
            <div key={index} className="space-y-2 rounded-md border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">OPTION {index + 1}</p>
                <button type="button" className="text-xs text-destructive" onClick={() => setVariantRows((rows) => rows.filter((_, i) => i !== index))}>Remove</button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Display label" htmlFor={`variant-label-${index}`}>
                  <Input id={`variant-label-${index}`} value={row.label} placeholder="e.g. Black · 256 GB" onChange={(e) => setVariantRows((rows) => rows.map((item, i) => i === index ? { ...item, label: e.target.value } : item))} maxLength={120} />
                </Field>
                <Field label="Options (Name=Value)" htmlFor={`variant-options-${index}`} hint="Separate multiple with commas">
                  <Input id={`variant-options-${index}`} value={row.optionsText} placeholder="Colour=Black, Storage=256 GB" onChange={(e) => setVariantRows((rows) => rows.map((item, i) => i === index ? { ...item, optionsText: e.target.value } : item))} />
                </Field>
                <Field label="SKU (optional)" htmlFor={`variant-sku-${index}`}>
                  <Input id={`variant-sku-${index}`} value={row.sku} onChange={(e) => setVariantRows((rows) => rows.map((item, i) => i === index ? { ...item, sku: e.target.value } : item))} maxLength={64} />
                </Field>
                <Field label={`Price (${form.currency}) · blank uses product price`} htmlFor={`variant-price-${index}`}>
                  <Input id={`variant-price-${index}`} type="number" min="0" step="any" value={row.price} onChange={(e) => setVariantRows((rows) => rows.map((item, i) => i === index ? { ...item, price: e.target.value } : item))} />
                </Field>
              </div>
              <Field label="Connect to stock ledger" htmlFor={`variant-inventory-${index}`} hint="Choose the merchant inventory record used for automatic reservations and deductions.">
                <Select value={row.businessProductId || 'none'} onValueChange={(value) => setVariantRows((rows) => rows.map((item, i) => i === index ? { ...item, businessProductId: value === 'none' ? '' : value } : item))}>
                  <SelectTrigger id={`variant-inventory-${index}`}><SelectValue placeholder="Not connected" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not connected</SelectItem>
                    {inventoryProducts.filter((product) => !product.listingVariantId || product.listingVariantId === row.variantId).map((product) => (
                      <SelectItem key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''} · ${product.stockOnHand} available</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={row.trackInventory} onCheckedChange={(checked) => setVariantRows((rows) => rows.map((item, i) => i === index ? { ...item, trackInventory: checked === true } : item))} />
                Track stock for this option
              </label>
              {row.trackInventory && !row.businessProductId ? (
                <p className="text-xs text-amber-700">Connect a stock ledger product above to enable automatic reservations and stock deductions at order confirmation.</p>
              ) : null}
              {row.trackInventory ? (
                <Field label={row.businessProductId ? "Stock quantity · managed by inventory ledger" : "Units in stock"} htmlFor={`variant-stock-${index}`}>
                  <Input id={`variant-stock-${index}`} type="number" min="0" step="any" value={row.stockQuantity} disabled={Boolean(row.businessProductId)} onChange={(e) => setVariantRows((rows) => rows.map((item, i) => i === index ? { ...item, stockQuantity: e.target.value } : item))} />
                </Field>
              ) : (
                <Field label="Availability (seller reported)" htmlFor={`variant-status-${index}`}>
                  <select id={`variant-status-${index}`} value={row.availabilityStatus} onChange={(e) => setVariantRows((rows) => rows.map((item, i) => i === index ? { ...item, availabilityStatus: e.target.value as VariantEditorRow['availabilityStatus'] } : item))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="UNKNOWN">Not confirmed</option>
                    <option value="IN_STOCK">In stock</option>
                    <option value="AVAILABLE_ON_ORDER">Available on order</option>
                    <option value="OUT_OF_STOCK">Out of stock</option>
                  </select>
                </Field>
              )}
              <Field label="Option photos" htmlFor={`variant-photos-${index}`} hint="Optional · up to 4">
                <PhotoPicker value={row.photos} onChange={(photos) => setVariantRows((rows) => rows.map((item, i) => i === index ? { ...item, photos } : item))} max={4} />
              </Field>
            </div>
          ))}
        </section>
      ) : null}

      <Field label="Photos" htmlFor="e-photos" hint="Real photos get more calls">
        <PhotoPicker value={form.photos} onChange={(photos) => set('photos', photos)} max={4} />
      </Field>

      <div className={cn('grid grid-cols-1 gap-4', form.category === 'services' ? 'sm:grid-cols-1' : 'sm:grid-cols-3')}>
        <Field label={form.category === 'services' ? (loaded.type === 'OFFER' ? 'Price / starting price' : 'Budget / maximum budget') : 'Price'} htmlFor="e-price" error={errors.price}>
          <div className="flex gap-2">
            <Input
              id="e-price"
              type="number"
              inputMode="decimal"
              min={0}
              step={currencyDef(form.currency).zeroDecimal ? '1' : '0.01'}
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
              className="flex-1"
            />
            <select
              aria-label="Currency"
              value={form.currency}
              onChange={(e) => set('currency', e.target.value)}
              className="h-9 shrink-0 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {CURRENCIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.symbol}
                </option>
              ))}
            </select>
          </div>
        </Field>
        {loaded.type === 'OFFER' && form.category !== 'services' ? (
        <Field label="Old price (optional)" htmlFor="e-compare" error={errors.compareAtPrice} hint="shows as a discount">
          <Input
            id="e-compare"
            type="number"
            inputMode="decimal"
            min={0}
            step={currencyDef(form.currency).zeroDecimal ? '1' : '0.01'}
            value={form.compareAtPrice}
            onChange={(e) => set('compareAtPrice', e.target.value)}
            placeholder="e.g. 30000"
          />
        </Field>
        ) : null}
        {form.category !== 'services' ? (
        <Field label="Per" htmlFor="e-unit" error={errors.unit}>
          <Select value={form.unit} onValueChange={(v) => set('unit', v)}>
            <SelectTrigger id="e-unit">
              <SelectValue placeholder="Unit" />
            </SelectTrigger>
            <SelectContent>
              {unitOptions.map((u) => (
                <SelectItem key={u.key} value={u.key}>
                  per {u.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={form.priceNegotiable || (form.category === 'services' && form.price.trim() === '')} onCheckedChange={(v) => set('priceNegotiable', v === true)} />
        {form.category === 'services' ? (loaded.type === 'OFFER' ? 'Price is negotiable or quote required' : 'Budget is flexible') : 'Price is negotiable'}
      </label>

      <div className={cn('grid grid-cols-1 gap-4', form.category === 'services' ? 'sm:grid-cols-1' : 'sm:grid-cols-2')}>
        {form.category !== 'services' ? (
        <Field label="Quantity available" htmlFor="e-qty" error={errors.quantity}>
          <Input
            id="e-qty"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={form.quantity}
            onChange={(e) => set('quantity', e.target.value)}
          />
        </Field>
        ) : null}
        <Field label="District / Region" htmlFor="e-county" error={errors.county}>
          <Select value={form.county} onValueChange={(v) => set('county', v)}>
            <SelectTrigger id="e-county">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {countryDef(loaded.country ?? 'UG').locations.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Area / town (optional)" htmlFor="e-area" error={errors.area}>
        <Input id="e-area" value={form.area} onChange={(e) => set('area', e.target.value)} maxLength={80} />
      </Field>

      {errors._ ? (
        <p role="alert" className="text-sm text-destructive">
          {errors._}
        </p>
      ) : null}

      <div className="flex gap-2 pb-2">
        <Button type="submit" disabled={busy} className="press">
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate({ name: 'listing', id })} disabled={busy} className="press">
          Cancel
        </Button>
      </div>
    </form>
  )
}
