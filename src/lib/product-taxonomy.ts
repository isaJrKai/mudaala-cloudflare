/**
 * Mudaala's initial hierarchical product taxonomy.
 *
 * This is deliberately data-shaped: category nodes have stable IDs, parent
 * relationships and optional attribute definitions. Keep legacy category
 * keys as top-level IDs so existing listings and saved searches remain valid.
 * This file is a bootstrap catalogue; merchant-managed taxonomy storage and
 * admin editing are a separate persistence/API integration.
 */
export type TaxonomyAttributeType = 'text' | 'number' | 'boolean' | 'enum'

export interface TaxonomyAttribute {
  key: string
  label: string
  type: TaxonomyAttributeType
  required?: boolean
  options?: readonly string[]
}

export interface TaxonomyNode {
  id: string
  label: string
  parentId: string | null
  attributes?: readonly TaxonomyAttribute[]
}

export const PRODUCT_TAXONOMY: readonly TaxonomyNode[] = [
  { id: 'textiles-clothing', label: 'Clothes & Apparel', parentId: null },
  { id: 'fashion-clothing', label: 'Clothing', parentId: 'textiles-clothing' },
  { id: 'fashion-hoodies', label: 'Hoodies', parentId: 'fashion-clothing', attributes: [{ key: 'size', label: 'Size', type: 'text' }, { key: 'material', label: 'Material', type: 'text' }, { key: 'colour', label: 'Colour', type: 'text' }, { key: 'fit', label: 'Fit', type: 'text' }] },
  { id: 'fashion-dresses', label: 'Dresses', parentId: 'fashion-clothing', attributes: [{ key: 'size', label: 'Size', type: 'text' }, { key: 'material', label: 'Material', type: 'text' }, { key: 'colour', label: 'Colour', type: 'text' }, { key: 'fit', label: 'Fit', type: 'text' }] },
  { id: 'fashion-shirts', label: 'Shirts', parentId: 'fashion-clothing', attributes: [{ key: 'size', label: 'Size', type: 'text' }, { key: 'material', label: 'Material', type: 'text' }, { key: 'colour', label: 'Colour', type: 'text' }] },
  { id: 'fashion-tops', label: 'Other Tops', parentId: 'fashion-clothing', attributes: [{ key: 'size', label: 'Size', type: 'text' }, { key: 'material', label: 'Material', type: 'text' }, { key: 'colour', label: 'Colour', type: 'text' }] },
  { id: 'fashion-trousers', label: 'Trousers & Jeans', parentId: 'fashion-clothing', attributes: [{ key: 'size', label: 'Size', type: 'text' }, { key: 'waist', label: 'Waist', type: 'text' }, { key: 'material', label: 'Material', type: 'text' }] },
  { id: 'fashion-skirts', label: 'Skirts', parentId: 'fashion-clothing' },
  { id: 'fashion-shoes', label: 'Shoes', parentId: 'textiles-clothing', attributes: [{ key: 'shoeSize', label: 'Shoe size', type: 'text' }, { key: 'brand', label: 'Brand', type: 'text' }, { key: 'condition', label: 'Condition', type: 'enum', options: ['NEW', 'LIKE_NEW', 'USED'] }] },
  { id: 'fashion-bags', label: 'Bags', parentId: 'textiles-clothing' },
  { id: 'electronics', label: 'Phones & Electronics', parentId: null },
  { id: 'electronics-phones', label: 'Phones', parentId: 'electronics' },
  { id: 'electronics-smartphones', label: 'Smartphones', parentId: 'electronics-phones', attributes: [{ key: 'brand', label: 'Brand', type: 'text' }, { key: 'model', label: 'Model', type: 'text' }, { key: 'storage', label: 'Storage', type: 'enum', options: ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'] }, { key: 'ram', label: 'RAM', type: 'text' }, { key: 'condition', label: 'Condition', type: 'enum', options: ['NEW', 'LIKE_NEW', 'USED', 'REFURBISHED'] }, { key: 'network', label: 'Network', type: 'text' }] },
  { id: 'electronics-feature-phones', label: 'Feature Phones', parentId: 'electronics-phones', attributes: [{ key: 'brand', label: 'Brand', type: 'text' }, { key: 'model', label: 'Model', type: 'text' }, { key: 'dualSim', label: 'Dual SIM', type: 'boolean' }] },
  { id: 'electronics-computers', label: 'Computers & Laptops', parentId: 'electronics', attributes: [{ key: 'brand', label: 'Brand', type: 'text' }, { key: 'model', label: 'Model', type: 'text' }, { key: 'ram', label: 'RAM', type: 'text' }, { key: 'storage', label: 'Storage', type: 'text' }, { key: 'condition', label: 'Condition', type: 'text' }] },
  { id: 'electronics-accessories', label: 'Accessories & Parts', parentId: 'electronics' },
  { id: 'beauty-personal-care', label: 'Beauty & Personal Care', parentId: null },
  { id: 'beauty-skincare', label: 'Skincare', parentId: 'beauty-personal-care' },
  { id: 'beauty-haircare', label: 'Haircare', parentId: 'beauty-personal-care' },
  { id: 'beauty-fragrance', label: 'Perfume & Fragrance', parentId: 'beauty-personal-care' },
  { id: 'food-groceries', label: 'Food & Groceries', parentId: null },
  { id: 'food-staples', label: 'Staples & Dry Goods', parentId: 'food-groceries' },
  { id: 'food-fresh', label: 'Fresh Food', parentId: 'food-groceries' },
  { id: 'home-kitchen', label: 'Home & Kitchen', parentId: null },
  { id: 'home-appliances', label: 'Home Appliances', parentId: 'home-kitchen' },
  { id: 'home-cookware', label: 'Cookware & Utensils', parentId: 'home-kitchen' },
  { id: 'hardware-building', label: 'Hardware & Building', parentId: null },
  { id: 'hardware-materials', label: 'Building Materials', parentId: 'hardware-building' },
  { id: 'hardware-tools', label: 'Tools & Equipment', parentId: 'hardware-building' },
  { id: 'farm-produce', label: 'Farm Produce', parentId: null },
  { id: 'farm-crops', label: 'Crops & Grains', parentId: 'farm-produce' },
  { id: 'farm-livestock', label: 'Livestock', parentId: 'farm-produce' },
  { id: 'services', label: 'Services', parentId: null },
  { id: 'services-home', label: 'Home & Repair Services', parentId: 'services' },
  { id: 'services-professional', label: 'Professional Services', parentId: 'services' },
] as const

export function taxonomyChildren(parentId: string | null): TaxonomyNode[] {
  return PRODUCT_TAXONOMY.filter((node) => node.parentId === parentId)
}

export function findTaxonomyNode(id: string): TaxonomyNode | undefined {
  return PRODUCT_TAXONOMY.find((node) => node.id === id)
}

export function isValidTaxonomyPath(parentId: string | null, childId: string): boolean {
  return findTaxonomyNode(childId)?.parentId === parentId
}

export function taxonomyAncestors(id: string): TaxonomyNode[] {
  const result: TaxonomyNode[] = []
  let node = findTaxonomyNode(id)
  while (node) {
    result.unshift(node)
    node = node.parentId ? findTaxonomyNode(node.parentId) : undefined
  }
  return result
}


/** Validate only attributes defined by the selected leaf taxonomy node. */
export function isValidTaxonomyAttributes(id: string, value: unknown): boolean {
  const node = findTaxonomyNode(id)
  if (!node) return false
  if (value === null || value === undefined) {
    return !(node.attributes ?? []).some((attribute) => attribute.required)
  }
  if (typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value as Record<string, unknown>)
  const definitions = new Map((node.attributes ?? []).map((attribute) => [attribute.key, attribute]))
  for (const [key, item] of entries) {
    const definition = definitions.get(key)
    if (!definition) return false
    if (definition.type === 'text' && typeof item !== 'string') return false
    if (definition.type === 'number' && (typeof item !== 'number' || !Number.isFinite(item))) return false
    if (definition.type === 'boolean' && typeof item !== 'boolean') return false
    if (definition.type === 'enum' && (typeof item !== 'string' || !definition.options?.includes(item))) return false
  }
  return (node.attributes ?? []).every((attribute) =>
    !attribute.required || (value as Record<string, unknown>)[attribute.key] !== undefined,
  )
}
