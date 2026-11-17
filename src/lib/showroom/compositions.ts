// Composition registry - CONFIGURATION ONLY.
//
// Each entry is a reusable layout plan (a list of blocks) plus the data the
// selector scores against. There is deliberately no rendering and no selection
// logic here: adding a composition means adding an object to this array.
// Category variety comes from combining 14 plans x 8 verticals x 5 purposes x
// per-showroom variants (flip/accent) x vertical surface/fit tokens - hundreds
// of looks, zero extra pages.

import type { CompositionDef } from './types'

const ANY_COUNT = { minProducts: 1, maxProducts: 60, minImageCoverage: 0 }

export const COMPOSITIONS: readonly CompositionDef[] = [
  {
    key: 'solo-feature',
    label: 'Solo feature',
    summary: 'One product, given the whole stage.',
    eligibility: { minProducts: 1, maxProducts: 2, minImageCoverage: 0 },
    sweetSpot: [1, 1],
    imageWeight: 1,
    affinity: { verticals: {}, purposes: { FEATURED: 1 } },
    tokens: { density: 'detailed', factsMax: 5, fit: 'cover' },
    plan: [{ kind: 'hero', layout: 'split' }, { kind: 'grid', take: 'rest', cols: 2, aspect: 'square' }],
  },
  {
    key: 'duo-pairing',
    label: 'Side by side',
    summary: 'Two or three products shown as a considered pair.',
    eligibility: { minProducts: 2, maxProducts: 4, minImageCoverage: 0.5 },
    sweetSpot: [2, 3],
    imageWeight: 1,
    affinity: { verticals: { fashion: 0.5, furniture: 0.5, beauty: 0.5 }, purposes: { FEATURED: 1 } },
    tokens: { density: 'standard', factsMax: 3, fit: 'cover' },
    plan: [{ kind: 'pair' }, { kind: 'grid', take: 'rest', cols: 2, aspect: 'portrait' }],
  },
  {
    key: 'hero-spotlight',
    label: 'Spotlight',
    summary: 'A lead product up top, the rest in a calm grid.',
    eligibility: { minProducts: 3, maxProducts: 12, minImageCoverage: 0.5 },
    sweetSpot: [3, 8],
    imageWeight: 0.9,
    affinity: { verticals: { general: 0.5, food: 0.5 }, purposes: { FEATURED: 2.5 } },
    tokens: { density: 'standard', factsMax: 2, fit: 'cover' },
    plan: [{ kind: 'hero', layout: 'full' }, { kind: 'grid', take: 'rest', cols: 3, aspect: 'portrait' }],
  },
  {
    key: 'split-feature',
    label: 'Feature + grid',
    summary: 'A featured product with its details beside it, then the range.',
    eligibility: { minProducts: 4, maxProducts: 16, minImageCoverage: 0.4 },
    sweetSpot: [4, 10],
    imageWeight: 0.7,
    affinity: { verticals: { electronics: 1.5, furniture: 1, general: 0.8, hardware: 0.8 }, purposes: { FEATURED: 1.5 } },
    signalWeights: { factsShare: 0.5 },
    tokens: { density: 'standard', factsMax: 3, fit: 'cover' },
    plan: [{ kind: 'hero', layout: 'split' }, { kind: 'grid', take: 'rest', cols: 3, aspect: 'square' }],
  },
  {
    key: 'editorial-lookbook',
    label: 'Lookbook',
    summary: 'Large, staggered photography like a fashion editorial.',
    eligibility: { minProducts: 4, maxProducts: 24, minImageCoverage: 0.8 },
    sweetSpot: [5, 12],
    imageWeight: 1.5,
    affinity: { verticals: { fashion: 5, beauty: 2, craft: 1 }, purposes: { COLLECTION: 0.5, NEW_ARRIVALS: 0.5 } },
    tokens: { density: 'minimal', factsMax: 2, fit: 'cover' },
    plan: [{ kind: 'hero', layout: 'full' }, { kind: 'rows', style: 'lookbook', take: 8 }, { kind: 'grid', take: 'rest', cols: 3, aspect: 'portrait' }],
  },
  {
    key: 'mosaic-grid',
    label: 'Mosaic',
    summary: 'A varied, photo-led wall with a few larger tiles.',
    eligibility: { minProducts: 6, maxProducts: 30, minImageCoverage: 0.7 },
    sweetSpot: [8, 16],
    imageWeight: 1.2,
    affinity: { verticals: { fashion: 2, craft: 2, general: 1.5, food: 1 }, purposes: { NEW_ARRIVALS: 1 } },
    tokens: { density: 'minimal', factsMax: 0, fit: 'cover' },
    plan: [{ kind: 'mosaic', take: 'rest' }],
  },
  {
    key: 'spec-sheet-rows',
    label: 'Spec sheet',
    summary: 'Clean rows: photo, key details and price, easy to compare.',
    eligibility: { minProducts: 2, maxProducts: 14, minImageCoverage: 0, minFactsShare: 0.5 },
    sweetSpot: [3, 8],
    imageWeight: 0.4,
    affinity: { verticals: { electronics: 5, hardware: 3, furniture: 0.5 }, purposes: { CATEGORY: 0.5 } },
    signalWeights: { factsShare: 1.5 },
    tokens: { density: 'detailed', factsMax: 5, fit: 'contain' },
    plan: [{ kind: 'rows', style: 'spec', take: 'rest' }],
  },
  {
    key: 'model-lineup',
    label: 'Model lineup',
    summary: 'One brand, shown as a lineup you can swipe through.',
    eligibility: { minProducts: 3, maxProducts: 14, minImageCoverage: 0.4, minFactsShare: 0.4, minTopBrandShare: 0.5 },
    sweetSpot: [4, 10],
    imageWeight: 0.5,
    affinity: { verticals: { electronics: 3.5, hardware: 1, beauty: 0.5 }, purposes: { BRAND: 3 } },
    signalWeights: { factsShare: 1.5, topBrandShare: 3 },
    tokens: { density: 'standard', factsMax: 3, fit: 'contain' },
    plan: [{ kind: 'hero', layout: 'split' }, { kind: 'scroller', take: 'rest', aspect: 'square' }],
  },
  {
    key: 'room-story',
    label: 'Room story',
    summary: 'Large, interior-style spreads with materials and sizes.',
    eligibility: { minProducts: 2, maxProducts: 12, minImageCoverage: 0.7 },
    sweetSpot: [3, 8],
    imageWeight: 1.2,
    affinity: { verticals: { furniture: 5, craft: 1.5, general: 0.3 }, purposes: { COLLECTION: 0.5 } },
    tokens: { density: 'detailed', factsMax: 3, fit: 'cover' },
    plan: [{ kind: 'rows', style: 'room', take: 'rest' }],
  },
  {
    key: 'gallery-wall',
    label: 'Gallery wall',
    summary: 'A quiet, image-first wall that lets the pieces speak.',
    eligibility: { minProducts: 5, maxProducts: 30, minImageCoverage: 0.8 },
    sweetSpot: [6, 18],
    imageWeight: 1.4,
    affinity: { verticals: { craft: 3.5, furniture: 2, fashion: 1.5, beauty: 0.5 }, purposes: { COLLECTION: 0.3 } },
    tokens: { density: 'minimal', factsMax: 1, fit: 'cover' },
    plan: [{ kind: 'masonry', take: 'rest' }],
  },
  {
    key: 'clean-shelf',
    label: 'Clean shelf',
    summary: 'Tidy shelves grouped by brand or type.',
    eligibility: { minProducts: 3, maxProducts: 40, minImageCoverage: 0 },
    sweetSpot: [4, 20],
    imageWeight: 0.6,
    affinity: { verticals: { beauty: 5, food: 3, general: 0.5 }, purposes: { BRAND: 1.5, CATEGORY: 1 } },
    signalWeights: { groupCount: 0.2 },
    tokens: { density: 'standard', factsMax: 2, fit: 'contain' },
    plan: [{ kind: 'groups', by: 'brand', aspect: 'square', cols: 3 }],
  },
  {
    key: 'ribbon-carousel',
    label: 'Swipe ribbon',
    summary: 'A swipeable ribbon of big cards - built for phones.',
    eligibility: { minProducts: 3, maxProducts: 14, minImageCoverage: 0.5 },
    sweetSpot: [4, 10],
    imageWeight: 0.9,
    affinity: { verticals: { fashion: 0.5, general: 0.5 }, purposes: { NEW_ARRIVALS: 4, FEATURED: 1 } },
    tokens: { density: 'standard', factsMax: 2, fit: 'cover' },
    plan: [{ kind: 'scroller', take: 'rest', aspect: 'portrait' }],
  },
  {
    key: 'category-sections',
    label: 'By category',
    summary: 'Easy browsing: products grouped under clear headings.',
    eligibility: { minProducts: 4, maxProducts: 60, minImageCoverage: 0, minGroupCount: 2 },
    sweetSpot: [8, 40],
    imageWeight: 0.5,
    affinity: { verticals: { general: 3.5, hardware: 3, food: 1.5, electronics: 0.5 }, purposes: { CATEGORY: 3, COLLECTION: 0.5 } },
    signalWeights: { groupCount: 0.3 },
    tokens: { density: 'standard', factsMax: 2, fit: 'cover' },
    plan: [{ kind: 'groups', by: 'category', aspect: 'square', cols: 3 }],
  },
  {
    key: 'essentials-grid',
    label: 'Clean grid',
    summary: 'A simple, even grid. Works for anything.',
    eligibility: ANY_COUNT,
    sweetSpot: [1, 60],
    imageWeight: 0.3,
    affinity: { verticals: { general: 1 }, purposes: {} },
    tokens: { density: 'standard', factsMax: 2, fit: 'cover' },
    plan: [{ kind: 'grid', take: 'rest', cols: 3, aspect: 'square' }],
  },
]

export const FALLBACK_COMPOSITION_KEY = 'essentials-grid'

export function findComposition(key: string | null | undefined): CompositionDef | undefined {
  if (!key) return undefined
  return COMPOSITIONS.find((c) => c.key === key)
}

export const COMPOSITION_KEYS: readonly string[] = COMPOSITIONS.map((c) => c.key)
