/**
 * MCI-01 concept pack (v0) — everyday words → taxonomy category hints.
 *
 * Deterministic, versioned, and deliberately small: this is a starter pack
 * aligned with `src/lib/product-taxonomy.ts` ids (plus legacy top-level keys
 * that remain valid: home-decor, arts-crafts, scrap-recyclables). Expanding it
 * is a data change with a version bump, not a code change.
 *
 * HONEST LIMITATION: no Luganda lexicon yet beyond well-known loanwords used
 * in Ugandan commerce. Language hints are best-effort; the registry records
 * the pending language benchmark (see engine tests for what is guaranteed).
 */

export const CONCEPT_PACK_VERSION = 'mci01.concepts.v0.1'

export interface ConceptEntry {
  /** Normalised token (already lowercase, diacritic-free). */
  token: string
  categoryId: string
}

export const CONCEPTS: readonly ConceptEntry[] = [
  // Phones & electronics
  { token: 'phone', categoryId: 'electronics' },
  { token: 'phones', categoryId: 'electronics' },
  { token: 'smartphone', categoryId: 'electronics' },
  { token: 'iphone', categoryId: 'electronics' },
  { token: 'samsung', categoryId: 'electronics' },
  { token: 'tecno', categoryId: 'electronics' },
  { token: 'infinix', categoryId: 'electronics' },
  { token: 'itel', categoryId: 'electronics' },
  { token: 'laptop', categoryId: 'electronics' },
  { token: 'charger', categoryId: 'electronics-accessories' },
  { token: 'earphones', categoryId: 'electronics-accessories' },
  { token: 'headphones', categoryId: 'electronics-accessories' },
  { token: 'powerbank', categoryId: 'electronics-accessories' },

  // Clothes & textiles
  { token: 'kitenge', categoryId: 'textiles-clothing' },
  { token: 'gomesi', categoryId: 'textiles-clothing' },
  { token: 'busuti', categoryId: 'textiles-clothing' },
  { token: 'dress', categoryId: 'fashion-dresses' },
  { token: 'dresses', categoryId: 'fashion-dresses' },
  { token: 'shirt', categoryId: 'fashion-shirts' },
  { token: 'hoodie', categoryId: 'fashion-hoodies' },
  { token: 'trousers', categoryId: 'fashion-trousers' },
  { token: 'jeans', categoryId: 'fashion-trousers' },
  { token: 'shoes', categoryId: 'fashion-shoes' },
  { token: 'bag', categoryId: 'fashion-bags' },
  { token: 'handbag', categoryId: 'fashion-bags' },

  // Beauty & personal care
  { token: 'perfume', categoryId: 'beauty-personal-care' },
  { token: 'fragrance', categoryId: 'beauty-personal-care' },
  { token: 'lotion', categoryId: 'beauty-skincare' },
  { token: 'cream', categoryId: 'beauty-skincare' },
  { token: 'shampoo', categoryId: 'beauty-haircare' },
  { token: 'petroleum', categoryId: 'beauty-personal-care' },
  { token: 'jelly', categoryId: 'beauty-personal-care' },

  // Food & farm
  { token: 'rice', categoryId: 'food-staples' },
  { token: 'sugar', categoryId: 'food-staples' },
  { token: 'flour', categoryId: 'food-staples' },
  { token: 'cooking', categoryId: 'food-groceries' },
  { token: 'oil', categoryId: 'food-groceries' },
  { token: 'matooke', categoryId: 'farm-produce' },
  { token: 'bananas', categoryId: 'farm-produce' },
  { token: 'tomatoes', categoryId: 'farm-produce' },
  { token: 'onions', categoryId: 'farm-produce' },
  { token: 'eggs', categoryId: 'farm-produce' },
  { token: 'chicken', categoryId: 'farm-livestock' },
  { token: 'goat', categoryId: 'farm-livestock' },
  { token: 'cow', categoryId: 'farm-livestock' },

  // Home & kitchen
  { token: 'sofa', categoryId: 'home-kitchen' },
  { token: 'bed', categoryId: 'home-kitchen' },
  { token: 'mattress', categoryId: 'home-kitchen' },
  { token: 'blender', categoryId: 'home-appliances' },
  { token: 'fridge', categoryId: 'home-appliances' },
  { token: 'stove', categoryId: 'home-appliances' },
  { token: 'saucepan', categoryId: 'home-cookware' },
  { token: 'pot', categoryId: 'home-cookware' },
  { token: 'curtains', categoryId: 'home-decor' },
  { token: 'basket', categoryId: 'arts-crafts' },

  // Hardware & building
  { token: 'cement', categoryId: 'hardware-building' },
  { token: 'nails', categoryId: 'hardware-building' },
  { token: 'iron', categoryId: 'hardware-building' },
  { token: 'hammer', categoryId: 'hardware-tools' },
  { token: 'drill', categoryId: 'hardware-tools' },

  // Services
  { token: 'plumber', categoryId: 'services-home' },
  { token: 'electrician', categoryId: 'services-home' },
  { token: 'tailor', categoryId: 'services-home' },
  { token: 'accountant', categoryId: 'services-professional' },
]

const CONCEPT_INDEX = new Map(CONCEPTS.map((c) => [c.token, c.categoryId]))

export function lookupConcept(token: string): string | undefined {
  return CONCEPT_INDEX.get(token)
}

/**
 * Small curated Luganda/local-commerce token set for language hints.
 * This is NOT a lexicon — only enough to distinguish the most common
 * loanwords and everyday Luganda commerce words. Expansion follows the
 * pending local-language benchmark (registry note, MCI-01).
 */
export const LUGANDA_HINT_TOKENS: ReadonlySet<string> = new Set([
  'matooke',
  'gomesi',
  'kitenge',
  'busuti',
  'boda',
  'santuri',
  'kikapu',
  'enviiri', // hair
  'ssabo', // shop
])

export const ENGLISH_HINT_TOKENS: ReadonlySet<string> = new Set([
  'the',
  'for',
  'sell',
  'selling',
  'buy',
  'price',
  'new',
  'used',
  'available',
  'looking',
  'need',
  'cheap',
  'quality',
])
