import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { listingFormStockFields } from '../src/lib/listing-form-fields'

const formSource = readFileSync(
  resolve(process.cwd(), 'src/components/commerce/publish-form.tsx'),
  'utf8',
)
const sharedHelperCalls = formSource.match(
  /listingFormStockFields\(form\.category, oldPriceRaw, form\.unit, quantityRaw\)/g,
) ?? []

assert.equal(
  sharedHelperCalls.length,
  2,
  'Both publish and edit flows must use the shared service stock-field normalizer',
)

assert.deepEqual(
  listingFormStockFields('services', '90000', 'piece', '12'),
  { compareAtPrice: null, unit: null, quantity: null },
  'Service saves must clear stale product-only values',
)

assert.deepEqual(
  listingFormStockFields('electronics', '90000', 'piece', '12'),
  { compareAtPrice: 90000, unit: 'piece', quantity: 12 },
  'Product listings must preserve valid stock and discount values',
)

assert.deepEqual(
  listingFormStockFields('electronics', '', 'none', ''),
  { compareAtPrice: null, unit: null, quantity: null },
  'Empty optional product fields must remain null',
)

console.log('Service listing form regression checks passed (publish + edit).')
