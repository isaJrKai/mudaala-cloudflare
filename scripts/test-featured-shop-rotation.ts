import assert from 'node:assert/strict'
import {
  chooseFeaturedShopId,
  eligibleFeaturedShopIds,
  FEATURED_SHOP_ROTATION_INTERVAL_MS,
} from '../src/lib/featured-shop-rotation'

const candidates = eligibleFeaturedShopIds([
  { user: { id: 'shop-b', profile: { businessName: 'Beta Shop' } } },
  { user: { id: 'shop-a', profile: { businessName: 'Alpha Shop' } } },
  { user: { id: 'shop-b', profile: { businessName: 'Beta Shop' } } },
  { user: { id: 'unnamed-shop', profile: { businessName: '  ' } } },
  { user: { id: 'no-profile', profile: null } },
  { user: null },
])

assert.deepEqual(candidates, ['shop-a', 'shop-b'], 'only distinct named shops from results are eligible')
assert.equal(chooseFeaturedShopId(candidates, 0), 'shop-a')
assert.equal(chooseFeaturedShopId(candidates, 1), 'shop-b', 'next time bucket rotates to the next eligible shop')
assert.equal(chooseFeaturedShopId(candidates, 2), 'shop-a', 'rotation is deterministic and round-robin')
assert.equal(chooseFeaturedShopId([], 20), null, 'empty results do not invent a shop')
assert.equal(chooseFeaturedShopId(candidates, -4), 'shop-a', 'negative buckets fail safely')
assert.equal(chooseFeaturedShopId(candidates, Number.NaN), 'shop-a', 'invalid buckets fail safely')
assert.equal(FEATURED_SHOP_ROTATION_INTERVAL_MS, 30 * 60 * 1000)

console.log('Featured-shop rotation checks passed.')
