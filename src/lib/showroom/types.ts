// Showroom Engine - shared domain types.
//
// Strict separation of concerns (see docs/SHOWROOM_ENGINE.md):
//   product data  -> ShowroomProduct      (mapped from existing Listings, never copied)
//   selection     -> select.ts            (pure scoring, deterministic)
//   configuration -> compositions.ts      (data only: registry of layout plans)
//   planning      -> plan.ts              (composition + products -> sections)
//   rendering     -> components/showroom  (no data fetching, no selection logic)
//   presentation  -> ShowroomPresentation (DB row: slug, copy, purpose, override, publish)

export const SHOWROOM_VERTICALS = ['fashion', 'electronics', 'furniture', 'beauty', 'food', 'craft', 'hardware', 'general'] as const
export type Vertical = (typeof SHOWROOM_VERTICALS)[number]

export const SHOWROOM_PURPOSES = ['COLLECTION', 'FEATURED', 'NEW_ARRIVALS', 'BRAND', 'CATEGORY'] as const
export type ShowroomPurpose = (typeof SHOWROOM_PURPOSES)[number]

export const PURPOSE_LABELS: Record<ShowroomPurpose, string> = {
  COLLECTION: 'Collection',
  FEATURED: 'Featured picks',
  NEW_ARRIVALS: 'New arrivals',
  BRAND: 'Brand showcase',
  CATEGORY: 'Category edit',
}

export type Availability = 'UNKNOWN' | 'IN_STOCK' | 'AVAILABLE_ON_ORDER' | 'OUT_OF_STOCK'

/**
 * A product as the showroom sees it. Every field is derived from an existing
 * Mudaala Listing; `id` is the Listing id and is the link back to /l/{id}.
 * Nothing here is invented: unknown values are null / empty / 'UNKNOWN'.
 */
export interface ShowroomProduct {
  id: string
  title: string
  description: string
  category: string
  taxonomyId: string | null
  brand: string | null
  model: string | null
  attributes: Record<string, string | number | boolean>
  price: number | null
  compareAtPrice: number | null
  currency: string
  unit: string | null
  priceNegotiable: boolean
  /** Real photo URLs only (seed fixtures are filtered out), at most 4. */
  photos: string[]
  availability: Availability
  publishedAt: string
}

export interface ProductFact {
  key: string
  label: string
  value: string
}

/** What the selector knows about a showroom's content. */
export interface ShowroomSignals {
  count: number
  vertical: Vertical
  /** share of products (0..1) belonging to the chosen vertical */
  verticalPurity: number
  /** share of products with at least one photo */
  imageCoverage: number
  /** share of products with two or more photos */
  multiPhotoShare: number
  /** share of products that carry at least two verified facts (brand/model/attributes) */
  factsShare: number
  brandCount: number
  topBrandShare: number
  /** most common brand among products with one, else null */
  topBrand: string | null
  /** distinct category groups (taxonomy leaf when known, else category key) */
  groupCount: number
  pricedShare: number
}

export interface SelectionInput {
  products: ShowroomProduct[]
  /** BusinessProfile.category (a Mudaala category key) - used only as a tie-breaker signal */
  merchantCategory: string | null
  purpose: ShowroomPurpose
  /** Stable per-showroom seed (the slug). Never Math.random, never a timestamp. */
  seed: string
  /** Merchant override; honoured when it names a registered composition. */
  styleKey?: string | null
}

// ---------------------------------------------------------------- planning

export type Aspect = 'portrait' | 'square' | 'landscape' | 'wide'

/** One block of a composition. `take` bounds how many products it consumes. */
export type BlockPlan =
  | { kind: 'hero'; layout: 'full' | 'split' }
  | { kind: 'pair' }
  | { kind: 'grid'; take: number | 'rest'; cols: 2 | 3 | 4; aspect: Aspect }
  | { kind: 'rows'; style: 'lookbook' | 'spec' | 'room'; take: number | 'rest' }
  | { kind: 'scroller'; take: number | 'rest'; aspect: Aspect }
  | { kind: 'masonry'; take: number | 'rest' }
  | { kind: 'mosaic'; take: number | 'rest' }
  | { kind: 'groups'; by: 'brand' | 'category'; aspect: Aspect; cols: 2 | 3 | 4 }

export type Surface = 'warm' | 'white' | 'sand' | 'blush'
export type Density = 'minimal' | 'standard' | 'detailed'

export interface CompositionTokens {
  density: Density
  /** how many verified facts a tile may show */
  factsMax: number
  fit: 'cover' | 'contain'
}

export interface CompositionDef {
  key: string
  label: string
  /** merchant-facing, one line */
  summary: string
  eligibility: {
    minProducts: number
    maxProducts: number
    minImageCoverage: number
    minFactsShare?: number
    minTopBrandShare?: number
    minGroupCount?: number
  }
  /** product count where this layout looks best (inclusive) */
  sweetSpot: [number, number]
  /** how much this composition leans on photography (0..1.5) */
  imageWeight: number
  /** extra score per signal (share 0..1, or group count) - data, not code */
  signalWeights?: Partial<{ factsShare: number; topBrandShare: number; groupCount: number }>
  affinity: {
    verticals: Partial<Record<Vertical, number>>
    purposes: Partial<Record<ShowroomPurpose, number>>
  }
  tokens: CompositionTokens
  plan: BlockPlan[]
}

export interface CompositionVariant {
  /** alternate which side rows start on */
  flip: boolean
  accent: 'green' | 'mango'
}

export interface Selection {
  composition: CompositionDef
  variant: CompositionVariant
  surface: Surface
  vertical: Vertical
  signals: ShowroomSignals
  score: number
  /** short, honest, merchant-facing reasons derived from the signals */
  reasons: string[]
  /** ranked alternatives (eligible only) for the style picker */
  alternatives: Array<{ key: string; label: string; score: number }>
  overridden: boolean
}

export interface PlannedSection {
  id: string
  block: BlockPlan
  heading?: string
  products: ShowroomProduct[]
}
