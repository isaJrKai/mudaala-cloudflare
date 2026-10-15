/**
 * Normalize product-only stock fields for listing publish and edit payloads.
 * Services are quote-oriented: they must never retain discount, unit, or stock
 * quantity values from an earlier product listing.
 */
export function listingFormStockFields(
  category: string,
  oldPriceRaw: string,
  unit: string,
  quantityRaw: string,
) {
  const isService = category === 'services'
  const oldPrice = oldPriceRaw.trim()
  const quantity = quantityRaw.trim()

  return {
    compareAtPrice: isService || oldPrice === '' ? null : Number(oldPrice),
    unit: isService || unit === 'none' ? null : unit,
    quantity: isService || quantity === '' ? null : Number(quantity),
  }
}
