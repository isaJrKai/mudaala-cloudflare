// SAMPLE SCENARIOS - test and documentation fixtures ONLY.
// These are not merchant inventory and must never be written to a database or
// shown to customers. Photo paths use /uploads/sample/ (not /uploads/seed/) so
// they pass the same filters as real photos in tests.

import type { ShowroomProduct, ShowroomPurpose } from './types'

let counter = 0
export function sampleProduct(over: Partial<ShowroomProduct> & Pick<ShowroomProduct, 'title' | 'category'>): ShowroomProduct {
  counter += 1
  return {
    id: over.id ?? `sample-${counter}`,
    title: over.title,
    description: over.description ?? `${over.title}. Sample listing used to demonstrate the showroom layout.`,
    category: over.category,
    taxonomyId: over.taxonomyId ?? null,
    brand: over.brand ?? null,
    model: over.model ?? null,
    attributes: over.attributes ?? {},
    price: over.price === undefined ? 50000 : over.price,
    compareAtPrice: over.compareAtPrice ?? null,
    currency: over.currency ?? 'UGX',
    unit: over.unit ?? null,
    priceNegotiable: over.priceNegotiable ?? false,
    photos: over.photos ?? [`/uploads/sample/${counter}-a.jpg`],
    availability: over.availability ?? 'UNKNOWN',
    publishedAt: over.publishedAt ?? new Date(Date.UTC(2026, 10, 1, 0, 0, 0) - counter * 3_600_000).toISOString(),
  }
}

export interface SampleScenario {
  key: string
  label: string
  shopName: string
  merchantCategory: string | null
  purpose: ShowroomPurpose
  seed: string
  title: string
  introduction: string
  products: ShowroomProduct[]
}

export function sampleScenarios(): SampleScenario[] {
  const fashion = ['Linen shirt', 'Wrap dress', 'Denim jacket', 'Pleated skirt', 'Canvas tote', 'Leather sandals', 'Knit cardigan', 'Straw hat', 'Silk scarf', 'Cotton trousers'].map((title, i) =>
    sampleProduct({
      id: `fashion-${i + 1}`, title, category: 'textiles-clothing',
      taxonomyId: i === 4 ? 'fashion-bags' : i === 5 ? 'fashion-shoes' : 'fashion-clothing',
      attributes: i < 4 ? { size: ['S', 'M', 'L', 'M'][i], colour: ['Sand', 'Olive', 'Indigo', 'Cream'][i] } : {},
      price: 45_000 + i * 12_500, photos: [`/uploads/sample/fashion-${i + 1}-a.jpg`, `/uploads/sample/fashion-${i + 1}-b.jpg`],
    }))

  const phones = [['iPhone 13', '128GB'], ['iPhone 13 Pro', '256GB'], ['iPhone 14', '128GB'], ['iPhone 14 Pro', '256GB'], ['iPhone 15', '128GB'], ['iPhone 12', '64GB']].map(([model, storage], i) =>
    sampleProduct({
      id: `phone-${i + 1}`, title: model, category: 'electronics', taxonomyId: 'electronics-smartphones',
      brand: 'Apple', model, attributes: { storage, condition: i % 2 === 0 ? 'NEW' : 'USED' },
      price: 1_900_000 + i * 350_000, availability: i === 5 ? 'OUT_OF_STOCK' : i < 3 ? 'IN_STOCK' : 'UNKNOWN',
    }))

  const mixedElectronics = [
    ['Galaxy A54', 'Samsung', '128GB'], ['Redmi Note 12', 'Xiaomi', '128GB'], ['Hot 30', 'Infinix', '128GB'], ['Spark 10', 'Tecno', '64GB'],
  ].map(([model, brand, storage], i) =>
    sampleProduct({ id: `mix-${i + 1}`, title: `${brand} ${model}`, category: 'electronics', taxonomyId: 'electronics-smartphones', brand, model, attributes: { storage, condition: 'NEW' }, price: 650_000 + i * 90_000 }))

  const furniture = ['Rattan armchair', 'Oak coffee table', 'Linen sofa', 'Floor lamp', 'Woven rug', 'Teak bookshelf'].map((title, i) =>
    sampleProduct({
      id: `furn-${i + 1}`, title, category: 'home-decor',
      attributes: i < 3 ? {} : {},
      price: 380_000 + i * 220_000, photos: [`/uploads/sample/furn-${i + 1}-a.jpg`, `/uploads/sample/furn-${i + 1}-b.jpg`],
    }))

  const beauty = [['Hydrating cleanser', 'Nivea'], ['Vitamin C serum', 'Nivea'], ['Night cream', 'Garnier'], ['Sunscreen SPF 50', 'Garnier'], ['Lip balm', 'Vaseline'], ['Body lotion', 'Vaseline']].map(([title, brand], i) =>
    sampleProduct({ id: `beauty-${i + 1}`, title, category: 'beauty-personal-care', taxonomyId: 'beauty-skincare', brand, attributes: { volume: `${50 + i * 25}ml` }, price: 18_000 + i * 6_000 }))

  const general = [
    ['Basmati rice 5kg', 'food-groceries'], ['Cooking oil 3L', 'food-groceries'], ['Sugar 2kg', 'food-groceries'], ['Plastic basin', 'home-kitchen'],
    ['Saucepan set', 'home-kitchen'], ['Washing powder 1kg', 'household-essentials'], ['Bar soap pack', 'household-essentials'], ['Phone charger', 'electronics'],
    ['Extension cable', 'electronics'], ['Notebook pack', 'other'],
  ].map(([title, category], i) => sampleProduct({ id: `gen-${i + 1}`, title, category, price: 6_000 + i * 4_500 }))

  return [
    { key: 'fashion', label: 'Fashion - Summer collection', shopName: 'Sample Atelier', merchantCategory: 'textiles-clothing', purpose: 'COLLECTION', seed: 'summer-fashion', title: 'Summer collection', introduction: '10 pieces from Sample Atelier.', products: fashion },
    { key: 'electronics', label: 'Electronics - iPhone showroom', shopName: 'Sample Phones', merchantCategory: 'electronics', purpose: 'BRAND', seed: 'iphone-showroom', title: 'iPhone collection', introduction: '6 devices from Sample Phones. Brand: Apple.', products: phones },
    { key: 'electronics-mixed', label: 'Electronics - mixed brands', shopName: 'Sample Phones', merchantCategory: 'electronics', purpose: 'COLLECTION', seed: 'android-picks', title: 'Android picks', introduction: '4 devices from Sample Phones.', products: mixedElectronics },
    { key: 'furniture', label: 'Furniture - Living room', shopName: 'Sample Interiors', merchantCategory: 'home-decor', purpose: 'COLLECTION', seed: 'living-room', title: 'Living room', introduction: '6 pieces from Sample Interiors.', products: furniture },
    { key: 'beauty', label: 'Beauty - Skincare', shopName: 'Sample Beauty Bar', merchantCategory: 'beauty-personal-care', purpose: 'CATEGORY', seed: 'skincare', title: 'Skincare', introduction: '6 products from Sample Beauty Bar.', products: beauty },
    { key: 'general', label: 'General retail - New arrivals', shopName: 'Sample General Store', merchantCategory: null, purpose: 'NEW_ARRIVALS', seed: 'new-arrivals', title: 'New arrivals', introduction: '10 products from Sample General Store.', products: general },
  ]
}
