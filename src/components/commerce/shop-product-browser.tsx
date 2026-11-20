'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

export type ShopBrowserProduct = {
  id: string
  title: string
  href: string
  photo?: string
  place: string
  priceLabel: string
  price: number | null
  currency: string
  group: string
  brand: string | null
  model: string | null
  attributes: Record<string, string | number | boolean>
}

type Props = { products: ShopBrowserProduct[] }

const ATTRIBUTE_LABELS: Record<string, string> = {
  condition: 'Condition',
  size: 'Size',
  shoeSize: 'Shoe size',
  colour: 'Colour',
  color: 'Colour',
  storage: 'Storage',
  ram: 'RAM',
  material: 'Material',
  fit: 'Fit',
  network: 'Network',
  skinType: 'Skin type',
  volume: 'Size / volume',
  weight: 'Weight',
  origin: 'Origin',
  screenSize: 'Screen size',
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-UG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
  } catch {
    return currency + ' ' + value.toLocaleString('en-UG')
  }
}

export function ShopProductBrowser({ products }: Props) {
  const priced = products.map((product) => product.price).filter((price): price is number => typeof price === 'number' && Number.isFinite(price))
  const floor = priced.length ? Math.min(...priced) : 0
  const ceiling = priced.length ? Math.max(...priced) : 0
  const [minPrice, setMinPrice] = useState(floor)
  const [maxPrice, setMaxPrice] = useState(ceiling)
  const [priceActive, setPriceActive] = useState(false)
  const [brand, setBrand] = useState('')
  const [group, setGroup] = useState('')
  const [attributes, setAttributes] = useState<Record<string, string>>({})

  const brands = useMemo(() => [...new Set(products.map((p) => p.brand?.trim()).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b)), [products])
  const attributeSource = products.filter((product) => (!group || product.group === group) && (!brand || product.brand === brand))
  const filterableAttributes = useMemo(() => {
    const keys = [...new Set(attributeSource.flatMap((p) => Object.keys(p.attributes ?? {})))]
    return keys.filter((key) => key !== 'brand' && key !== 'model').map((key) => ({
      key,
      label: ATTRIBUTE_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()),
      options: [...new Set(attributeSource.map((p) => p.attributes?.[key]).filter((v) => v !== undefined && v !== null && String(v).trim() !== '').map(String))].sort((a, b) => a.localeCompare(b)),
    })).filter((item) => item.options.length > 1)
  }, [attributeSource])
  const groups = useMemo(() => [...new Set(products.map((p) => p.group))].sort((a, b) => a.localeCompare(b)), [products])

  const filtered = products.filter((product) => {
    if (group && product.group !== group) return false
    if (brand && product.brand !== brand) return false
    if (priceActive && (product.price === null || product.price < minPrice || product.price > maxPrice)) return false
    return Object.entries(attributes).every(([key, value]) => !value || String(product.attributes?.[key] ?? '') === value)
  })
  const grouped = new Map<string, Map<string, ShopBrowserProduct[]>>()
  for (const product of filtered) {
    const groupMap = grouped.get(product.group) ?? new Map<string, ShopBrowserProduct[]>()
    const brandName = product.brand?.trim() || 'Other products'
    const items = groupMap.get(brandName) ?? []
    items.push(product)
    groupMap.set(brandName, items)
    grouped.set(product.group, groupMap)
  }
  const activeFilters = Number(Boolean(group)) + Number(Boolean(brand)) + Number(priceActive) + Object.values(attributes).filter(Boolean).length

  function clearFilters() {
    setGroup('')
    setBrand('')
    setMinPrice(floor)
    setMaxPrice(ceiling)
    setPriceActive(false)
    setAttributes({})
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Find something in this shop</p>
          <span className="text-xs text-muted-foreground">{filtered.length} of {products.length}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            Product type
            <select value={group} onChange={(event) => { setGroup(event.target.value); setAttributes({}) }} className="w-full rounded-md border bg-background px-2.5 py-2 text-sm text-foreground">
              <option value="">All types</option>
              {groups.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Brand
            <select value={brand} onChange={(event) => { setBrand(event.target.value); setAttributes({}) }} className="w-full rounded-md border bg-background px-2.5 py-2 text-sm text-foreground">
              <option value="">All brands</option>
              {brands.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        {filterableAttributes.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {filterableAttributes.map((item) => (
              <label key={item.key} className="space-y-1 text-xs text-muted-foreground">
                {item.label}
                <select value={attributes[item.key] ?? ''} onChange={(event) => setAttributes((current) => ({ ...current, [item.key]: event.target.value }))} className="w-full rounded-md border bg-background px-2.5 py-2 text-sm text-foreground">
                  <option value="">Any {item.label.toLowerCase()}</option>
                  {item.options.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            ))}
          </div>
        ) : null}
        {priced.length > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={priceActive} onChange={(event) => setPriceActive(event.target.checked)} className="size-4 accent-primary" />
                Filter by price
              </label>
              <span className="text-xs text-muted-foreground">{money(minPrice, products.find((p) => p.price !== null)?.currency ?? 'UGX')} - {money(maxPrice, products.find((p) => p.price !== null)?.currency ?? 'UGX')}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">Minimum price
                <input type="number" min={floor} max={maxPrice} value={minPrice} onChange={(event) => { setMinPrice(Math.min(maxPrice, Math.max(floor, Number(event.target.value) || 0))); setPriceActive(true) }} className="w-full rounded-md border bg-background px-2.5 py-2 text-sm text-foreground" />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">Maximum price
                <input type="number" min={minPrice} max={ceiling} value={maxPrice} onChange={(event) => { setMaxPrice(Math.max(minPrice, Math.min(ceiling, Number(event.target.value) || 0))); setPriceActive(true) }} className="w-full rounded-md border bg-background px-2.5 py-2 text-sm text-foreground" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs text-muted-foreground">Min
                <input aria-label="Minimum price slider" type="range" min={floor} max={ceiling} step="any" value={minPrice} onChange={(event) => { setMinPrice(Math.min(Number(event.target.value), maxPrice)); setPriceActive(true) }} className="w-full accent-primary" />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">Max
                <input aria-label="Maximum price slider" type="range" min={floor} max={ceiling} step="any" value={maxPrice} onChange={(event) => { setMaxPrice(Math.max(Number(event.target.value), minPrice)); setPriceActive(true) }} className="w-full accent-primary" />
              </label>
            </div>
          </div>
        ) : null}
        {activeFilters > 0 ? <button type="button" onClick={clearFilters} className="text-xs font-medium text-primary underline underline-offset-2">Clear filters</button> : null}
      </div>

      {filtered.length ? (
        [...grouped.entries()].map(([type, brandGroups]) => (
          <section key={type} className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold">{type}</h3>
              <span className="text-xs text-muted-foreground">{[...brandGroups.values()].reduce((count, items) => count + items.length, 0)} products</span>
            </div>
            {[...brandGroups.entries()].map(([brandName, items]) => (
              <div key={brandName} className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{brandName}{brandName !== 'Other products' && items.some((item) => item.model) ? ' · ' + [...new Set(items.map((item) => item.model).filter(Boolean))].join(', ') : ''}</h4>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  {items.map((product) => {
                    const highlights = Object.entries(product.attributes ?? {})
                      .filter(([key, value]) => key !== 'brand' && key !== 'model' && value !== '' && value !== null && value !== undefined)
                      .slice(0, 2)
                    return (
                      <Link key={product.id} href={product.href} className="group min-w-0 overflow-hidden border border-border/80 bg-card transition-colors hover:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <div className="p-2 sm:p-2.5">
                          <div className="relative aspect-[4/5] overflow-hidden border border-border/70 bg-secondary/60">
                            {product.photo ? (
                              <img src={product.photo} alt={product.title} className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.035]" loading="lazy" />
                            ) : (
                              <div className="flex size-full items-center justify-center px-3 text-center text-xs text-muted-foreground">{type} · photo not supplied</div>
                            )}
                          </div>
                        </div>
                        <div className="space-y-1.5 px-3 pb-3 pt-1">
                          <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug">{product.title}</p>
                          {product.model ? <p className="truncate text-[11px] text-muted-foreground">{product.model}</p> : null}
                          {highlights.length ? (
                            <p className="line-clamp-1 text-[10px] text-muted-foreground">
                              {highlights.map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1')}: ${String(value)}`).join(' · ')}
                            </p>
                          ) : null}
                          <p className="border-t border-border/70 pt-2 text-sm font-semibold tabular-nums text-foreground">{product.priceLabel}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{product.place}</p>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </section>
        ))
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No products match these filters. Try widening the price range or clearing a filter.</p>
      )}
    </div>
  )
}
