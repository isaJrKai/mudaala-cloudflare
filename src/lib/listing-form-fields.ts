/**
 * Normalize category-specific fields shared by listing publish and edit.
 * Services are quote-oriented: clear product-only stock fields and make an
 * empty service price an explicit quote request accepted by shared validation.
 */
export function listingFormCategoryFields(
  category: string,
  oldPriceRaw: string,
  unit: string,
  quantityRaw: string,
  priceRaw: string,
  priceNegotiable: boolean,
) {
  const isService = category === 'services'
  const oldPrice = oldPriceRaw.trim()
  const quantity = quantityRaw.trim()
  const price = priceRaw.trim()

  return {
    compareAtPrice: isService || oldPrice === '' ? null : Number(oldPrice),
    unit: isService || unit === 'none' ? null : unit,
    quantity: isService || quantity === '' ? null : Number(quantity),
    priceNegotiable: isService && price === '' ? true : priceNegotiable,
  }
}
