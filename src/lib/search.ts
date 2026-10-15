// Customer-friendly product search helpers.
// Keep matching deterministic, inexpensive, and shared by browse + saved searches.

export interface SearchTermGroup {
  /** Equivalent words/phrases that can satisfy one part of the customer's query. */
  terms: string[]
  /** Category keys that represent the product intent, even when the listing title omits it. */
  categories: string[]
}

interface SearchConcept {
  terms: string[]
  categories: string[]
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

// Start with everyday language customers actually use. These are search-time
// synonyms only: they do not rewrite seller listings or their chosen categories.
const CONCEPTS: SearchConcept[] = [
  { terms: ['perfume', 'perfum', 'perfumes', 'fragrance', 'fragrances', 'cologne', 'colone', 'colognes', 'body spray', 'body sprays', 'aftershave', 'aftershaves', 'scent', 'scents'], categories: ['beauty-personal-care'] },
  { terms: ['beauty', 'beauty personal care', 'beauty essentials', 'personal care essentials', 'cosmetic', 'cosmetics', 'makeup', 'make up', 'lipstick', 'skincare', 'skin care', 'lotion', 'deodorant', 'shampoo', 'conditioner', 'hair oil', 'wig', 'wigs'], categories: ['beauty-personal-care'] },
  { terms: ['phone', 'phones', 'mobile', 'mobiles', 'smartphone', 'smartphones', 'iphone', 'iphones', 'samsung', 'tecno', 'itel', 'infinix', 'android'], categories: ['electronics'] },
  { terms: ['charger', 'chargers', 'earphone', 'earphones', 'headphone', 'headphones', 'laptop', 'laptops', 'television', 'tv', 'radio', 'solar panel', 'solar panels'], categories: ['electronics'] },
  { terms: ['shoe', 'shoes', 'sneaker', 'sneakers', 'trainer', 'trainers', 'sandal', 'sandals', 'slipper', 'slippers', 'boot', 'boots', 'heel', 'heels'], categories: ['textiles-clothing'] },
  { terms: ['clothes', 'clothing', 'shirt', 'shirts', 'trousers', 'jeans', 'dress', 'dresses', 'skirt', 'skirts', 'jacket', 'jackets', 'tshirt', 't shirts', 'second hand', 'used clothes'], categories: ['textiles-clothing'] },
  { terms: ['household essentials', 'home essentials', 'blanket', 'blankets', 'duvet', 'duvets', 'bedsheet', 'bedsheets', 'bed sheet', 'bed sheets', 'pillow', 'pillows', 'mattress', 'mattresses', 'sofa', 'sofas', 'furniture'], categories: ['home-kitchen', 'home-decor'] },
  { terms: ['home decor', 'home décor', 'decor', 'decoration', 'decorations', 'interior decor', 'interior decoration', 'curtain', 'curtains', 'rug', 'rugs', 'carpet', 'carpets', 'cushion', 'cushions', 'vase', 'vases', 'wall art', 'decorative pieces', 'ornament', 'ornaments', 'centerpiece', 'centerpieces', 'boho decor', 'macrame', 'macramé'], categories: ['home-decor'] },
  { terms: ['art', 'arts', 'craft', 'crafts', 'handmade', 'handmade gifts', 'handcrafted', 'beadwork', 'beaded', 'crochet', 'knitting', 'woven crafts', 'woven basket', 'woven baskets', 'pottery', 'ceramics', 'sculpture', 'sculptures', 'painting', 'paintings', 'craft supplies', 'artwork', 'artworks'], categories: ['arts-crafts'] },
  { terms: ['cooker', 'cookers', 'saucepan', 'saucepans', 'pot', 'pots', 'pan', 'pans', 'plate', 'plates', 'cup', 'cups', 'kettle', 'kettles', 'gas cylinder', 'gas cylinders'], categories: ['home-kitchen'] },
  { terms: ['matooke', 'matoke', 'banana', 'bananas', 'cassava', 'sweet potato', 'sweet potatoes', 'tomato', 'tomatoes', 'onion', 'onions', 'vegetable', 'vegetables', 'maize', 'beans', 'eggs'], categories: ['farm-produce'] },
  { terms: ['food essentials', 'grocery essentials', 'rice', 'flour', 'sugar', 'cooking oil', 'salt', 'bread', 'milk', 'posho', 'wheat flour', 'tea', 'coffee', 'spice', 'spices', 'groceries', 'food'], categories: ['food-groceries'] },
  { terms: ['cement', 'timber', 'steel', 'iron sheets', 'roofing', 'nail', 'nails', 'paint', 'tiles', 'brick', 'bricks', 'plumbing'], categories: ['hardware-building'] },
  { terms: ['copper', 'brass', 'aluminium', 'aluminum', 'scrap metal', 'plastic bottles', 'cartons', 'recyclables'], categories: ['scrap-recyclables'] },
  { terms: ['charcoal', 'firewood', 'briquettes', 'cooking fuel'], categories: ['other'] },
]

const GENDER_TERMS: Record<string, string[]> = {
  men: ['men', 'mens', 'male', 'gents', 'gentlemen'],
  mens: ['men', 'mens', 'male', 'gents', 'gentlemen'],
  male: ['men', 'mens', 'male', 'gents', 'gentlemen'],
  gents: ['men', 'mens', 'male', 'gents', 'gentlemen'],
  women: ['women', 'womens', 'female', 'ladies', 'lady'],
  womens: ['women', 'womens', 'female', 'ladies', 'lady'],
  female: ['women', 'womens', 'female', 'ladies', 'lady'],
  ladies: ['women', 'womens', 'female', 'ladies', 'lady'],
}

function includesPhrase(haystack: string, phrase: string): boolean {
  return (' ' + haystack + ' ').includes(' ' + normalizeSearchText(phrase) + ' ')
}

export interface ParsedSearchIntent {
  text: string
  minPrice?: number
  maxPrice?: number
  sort?: 'price_asc' | 'price_desc'
}

/**
 * Extract simple price constraints from natural-language searches without
 * guessing at bare numbers. "perfume under UGX 50k" becomes product intent
 * "perfume" plus maxPrice=50000; "between 20k and 40k" becomes a range.
 */
export function parseSearchIntent(query: string): ParsedSearchIntent {
  let text = query
  let minPrice: number | undefined
  let maxPrice: number | undefined
  let sort: 'price_asc' | 'price_desc' | undefined
  const amount = '(?:(?:UGX|USh|Shs?)\\s*)?([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(k|m)?(?:\\s*(?:UGX|USh|Shs?))?'
  const parseAmount = (raw: string, unit?: string) => {
    const value = Number(raw.replace(/,/g, ''))
    if (!Number.isFinite(value) || value < 0) return undefined
    return Math.round(value * (unit?.toLowerCase() === 'm' ? 1_000_000 : unit?.toLowerCase() === 'k' ? 1_000 : 1))
  }

  const range = new RegExp('\\bbetween\\s+' + amount + '\\s+and\\s+' + amount + '\\b', 'i').exec(text)
  if (range) {
    const first = parseAmount(range[1]!, range[2])
    const second = parseAmount(range[3]!, range[4])
    if (first !== undefined && second !== undefined) {
      minPrice = Math.min(first, second)
      maxPrice = Math.max(first, second)
      text = text.replace(range[0], ' ')
    }
  }

  if (minPrice === undefined && maxPrice === undefined) {
    const upper = new RegExp('\\b(?:under|below|less than|up to|at most|max(?:imum)?)\\s*' + amount, 'i').exec(text)
    if (upper) {
      const value = parseAmount(upper[1]!, upper[2])
      if (value !== undefined) {
        maxPrice = value
        text = text.replace(upper[0], ' ')
      }
    }
    const lower = new RegExp('\\b(?:over|above|more than|at least|min(?:imum)?)\\s*' + amount, 'i').exec(text)
    if (lower) {
      const value = parseAmount(lower[1]!, lower[2])
      if (value !== undefined) {
        minPrice = value
        text = text.replace(lower[0], ' ')
      }
    }
  }

  if (/\b(?:cheap|cheaper|cheapest|affordable|inexpensive|budget(?:[- ]friendly)?|lowest price|low price)\b/i.test(text)) sort = 'price_asc'
  else if (/\b(?:expensive|premium|high[- ]end|highest price|top price)\b/i.test(text)) sort = 'price_desc'

  text = text
    .replace(/\b(?:cheap|cheaper|cheapest|affordable|inexpensive|budget(?:[- ]friendly)?|lowest price|low price|expensive|premium|high[- ]end|highest price|top price)\b/gi, ' ')
    .replace(/\b(?:price|prices|cost|costs|ugx|ush|shs?|shillings?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    text,
    ...(minPrice !== undefined ? { minPrice } : {}),
    ...(maxPrice !== undefined ? { maxPrice } : {}),
    ...(sort ? { sort } : {}),
  }
}

export function getSearchTermGroups(query: string): SearchTermGroup[] {
  const intent = parseSearchIntent(query)
  const normalized = normalizeSearchText(intent.text)
  if (!normalized) {
    if (intent.minPrice !== undefined || intent.maxPrice !== undefined || intent.sort) return []
    return [{ terms: [query.trim()], categories: [] }]
  }

  // "Essentials" on its own is deliberately broad. Let buyers discover a few
  // everyday aisles instead of guessing one category for them.
  if (['essential', 'essentials', 'essential items', 'daily essentials', 'everyday essentials'].includes(normalized)) {
    return [{
      terms: ['essential', 'essentials', 'essential items', 'daily essentials', 'everyday essentials'],
      categories: ['home-kitchen', 'beauty-personal-care', 'food-groceries', 'textiles-clothing'],
    }]
  }

  const tokens = normalized.split(' ').filter((token) => ![
    'a', 'an', 'and', 'around', 'best', 'buy', 'find', 'for', 'get', 'good', 'great',
    'i', 'in', 'item', 'items', 'look', 'looking', 'me', 'my', 'need', 'of',
    'nice', 'on', 'please', 'product', 'products', 'search', 'searching', 'show', 'the',
    'to', 'want', 'with', 'near',
  ].includes(token))
  if (!tokens.length) {
    if (intent.minPrice !== undefined || intent.maxPrice !== undefined || intent.sort) return []
    return [{ terms: [normalized], categories: [] }]
  }

  const matchedConcepts = CONCEPTS.filter((concept) => concept.terms.some((term) => includesPhrase(normalized, term)))
  // Category fallback is helpful for one clear intent ("perfume" → beauty),
  // but must not make a multi-product query like "phone charger" match every
  // item in Electronics merely because both words share that category.
  const allowCategoryFallback = matchedConcepts.length === 1
  return tokens.map((token) => {
    const terms = new Set<string>([token])
    // Cheap plural/singular tolerance for ordinary English terms.
    if (token.length > 4 && token.endsWith('ies')) terms.add(token.slice(0, -3) + 'y')
    else if (token.length > 4 && token.endsWith('s')) terms.add(token.slice(0, -1))
    else if (token.length > 3) terms.add(token + 's')
    for (const synonym of GENDER_TERMS[token] ?? []) terms.add(synonym)

    const categories = new Set<string>()
    for (const concept of matchedConcepts) {
      const matchedTerms = concept.terms.filter((term) => includesPhrase(normalized, term))
      const matchedTokens = new Set(matchedTerms.flatMap((term) => normalizeSearchText(term).split(' ')))
      if (!matchedTokens.has(token)) continue
      concept.terms.forEach((term) => terms.add(normalizeSearchText(term)))
      if (allowCategoryFallback) concept.categories.forEach((category) => categories.add(category))
    }
    return { terms: [...terms], categories: [...categories] }
  })
}

export function searchTextMatchesGroup(group: SearchTermGroup, values: Array<string | null | undefined>, category?: string | null): boolean {
  if (group.categories.some((key) => key === category)) return true
  const normalizedValues = values.filter((value): value is string => Boolean(value)).map(normalizeSearchText)
  return group.terms.some((term) => {
    const normalizedTerm = normalizeSearchText(term)
    return normalizedTerm.length > 0 && normalizedValues.some((value) => value.includes(normalizedTerm))
  })
}

export function scoreListingSearch(input: {
  title: string
  description?: string | null
  category?: string | null
  area?: string | null
  county?: string | null
}, query: string): number {
  const parsed = parseSearchIntent(query)
  const normalizedQuery = normalizeSearchText(parsed.text)
  const title = normalizeSearchText(input.title)
  const description = normalizeSearchText(input.description ?? '')
  const category = normalizeSearchText(input.category ?? '')
  const location = normalizeSearchText([input.area, input.county].filter(Boolean).join(' '))
  let score = !normalizedQuery ? 0 : title === normalizedQuery ? 1000 : title.startsWith(normalizedQuery) ? 600 : title.includes(normalizedQuery) ? 400 : 0
  for (const group of getSearchTermGroups(query)) {
    if (group.terms.some((term) => title.includes(normalizeSearchText(term)))) score += 40
    else if (group.categories.some((key) => key === input.category) || group.terms.some((term) => category.includes(normalizeSearchText(term)))) score += 24
    else if (group.terms.some((term) => description.includes(normalizeSearchText(term)))) score += 18
    else if (group.terms.some((term) => location.includes(normalizeSearchText(term)))) score += 3
  }
  return score
}
