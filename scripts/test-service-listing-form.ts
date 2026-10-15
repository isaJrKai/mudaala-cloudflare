import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { listingFormCategoryFields } from '../src/lib/listing-form-fields'

const formSource = readFileSync(
  resolve(process.cwd(), 'src/components/commerce/publish-form.tsx'),
  'utf8',
)
const sharedHelperCalls = formSource.match(
  /listingFormCategoryFields\(form\.category, oldPriceRaw, form\.unit, quantityRaw, priceRaw, form\.priceNegotiable\)/g,
) ?? []

assert.equal(
  sharedHelperCalls.length,
  2,
  'Both publish and edit flows must use the shared category-field normalizer',
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

console.log('Service listing regression checks passed (publish + edit + quote pricing).')
