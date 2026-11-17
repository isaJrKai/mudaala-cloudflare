import type { Surface, Vertical } from './types'

// Mudaala category key -> showroom vertical. Keys are the stable keys from
// src/lib/constants.ts CATEGORIES; unknown or future keys fall back to 'general'
// so a new category can never break rendering.
const CATEGORY_VERTICAL: Record<string, Vertical> = {
  'textiles-clothing': 'fashion',
  electronics: 'electronics',
  'beauty-personal-care': 'beauty',
  'home-decor': 'furniture',
  'home-kitchen': 'furniture',
  'food-groceries': 'food',
  'farm-produce': 'food',
  'arts-crafts': 'craft',
  'hardware-building': 'hardware',
}

export function verticalOfCategory(category: string | null | undefined): Vertical {
  if (!category) return 'general'
  return CATEGORY_VERTICAL[category] ?? 'general'
}

/** Neutral, light showroom surfaces. Brand colours stay on actions and accents. */
export const VERTICAL_SURFACE: Record<Vertical, Surface> = {
  fashion: 'warm',
  electronics: 'white',
  furniture: 'sand',
  beauty: 'blush',
  food: 'warm',
  craft: 'sand',
  hardware: 'white',
  general: 'warm',
}

/** Which attribute keys read first for each vertical (others follow in definition order). */
export const VERTICAL_FACT_PRIORITY: Record<Vertical, string[]> = {
  fashion: ['size', 'shoeSize', 'colour', 'material', 'fit', 'condition'],
  electronics: ['storage', 'ram', 'network', 'power', 'capacity', 'condition'],
  furniture: ['material', 'size', 'dimensions', 'colour', 'capacity', 'pieceCount', 'condition'],
  beauty: ['volume', 'skinType', 'hairType', 'fragranceType', 'condition'],
  food: ['weight', 'origin', 'grade', 'variety', 'packaging'],
  craft: ['material', 'size', 'colour'],
  hardware: ['size', 'material', 'grade', 'power', 'unit', 'condition'],
  general: ['condition', 'size', 'material', 'colour'],
}

export const VERTICAL_NOUN: Record<Vertical, { one: string; many: string }> = {
  fashion: { one: 'piece', many: 'pieces' },
  electronics: { one: 'device', many: 'devices' },
  furniture: { one: 'piece', many: 'pieces' },
  beauty: { one: 'product', many: 'products' },
  food: { one: 'product', many: 'products' },
  craft: { one: 'piece', many: 'pieces' },
  hardware: { one: 'product', many: 'products' },
  general: { one: 'product', many: 'products' },
}
