import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { listingFormCategoryFields } from '../src/lib/listing-form-fields'
import { listingCreateSchema, listingNeedsUnit } from '../src/lib/validation'

const formSource = readFileSync(
  resolve(process.cwd(), 'src/components/commerce/publish-form.tsx'),
  'utf8',
)
const sharedHelperCalls = formSource.match(
  /listingFormCategoryFields\(form\.category, oldPriceRaw, selectedUnit, quantityRaw, priceRaw, form\.priceNegotiable\)/g,
) ?? []

assert.equal(
  sharedHelperCalls.length,
  2,
  'Both publish and edit flows must use the shared category-field normalizer',
)

assert.equal(
  (formSource.match(/checked={form\.priceNegotiable \|\| \(form\.category === 'services' && form\.price\.trim\(\) === ''\)}/g) ?? []).length,
  2,
  'Both forms must visibly show quote-required state when an unpriced service is selected',
)

assert.deepEqual(
  listingFormCategoryFields('services', '90000', 'piece', '12', '', false),
  { compareAtPrice: null, unit: null, quantity: null, priceNegotiable: true },
  'Quote-only service saves must clear stale product fields and satisfy price validation',
)

assert.deepEqual(
  listingFormCategoryFields('services', '90000', 'piece', '12', '45000', false),
  { compareAtPrice: null, unit: null, quantity: null, priceNegotiable: false },
  'Priced services must preserve the seller’s negotiable-price choice',
)

assert.deepEqual(
  listingFormCategoryFields('electronics', '90000', 'piece', '12', '75000', false),
  { compareAtPrice: 90000, unit: 'piece', quantity: 12, priceNegotiable: false },
  'Product listings must preserve stock, discount, and price-choice values',
)

assert.deepEqual(
  listingFormCategoryFields('electronics', '', 'none', '', '75000', true),
  { compareAtPrice: null, unit: null, quantity: null, priceNegotiable: true },
  'Empty optional product fields must remain null',
)


const serviceBase = {
  type: 'OFFER' as const,
  title: 'Wedding photography',
  description: 'Professional wedding photography across Kampala and nearby areas.',
  category: 'services',
  compareAtPrice: null,
  currency: 'UGX',
  unit: null,
  quantity: null,
  country: 'UG',
  county: 'Central',
  area: null,
  contactPhone: '0772345678',
  contactWhatsapp: null,
  photos: [],
}

assert.equal(listingNeedsUnit('services', 45000), false)
assert.equal(listingNeedsUnit('electronics', 45000), true)
assert.equal(listingNeedsUnit('electronics', null), false)

assert.equal(
  listingCreateSchema.safeParse({ ...serviceBase, price: 45000, priceNegotiable: false }).success,
  true,
  'A fixed-price service must validate without product unit/quantity fields',
)
assert.equal(
  listingCreateSchema.safeParse({ ...serviceBase, price: null, priceNegotiable: true }).success,
  true,
  'A quote-only service must validate without product unit/quantity fields',
)
assert.equal(
  listingCreateSchema.safeParse({ ...serviceBase, category: 'electronics', price: 45000, priceNegotiable: false }).success,
  false,
  'Priced product listings must still require a unit',
)

console.log('Service listing regression checks passed (publish + edit + quote pricing).')
