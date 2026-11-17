/**
 * The twenty seller-selectable showroom art directions.
 *
 * This is a stable catalogue, not a set of colour themes. Each entry describes
 * a distinct information architecture and visual language. Rendering is kept
 * separate so templates can evolve without changing merchant content.
 */
export type ShowroomVertical =
  | 'fashion' | 'beauty' | 'electronics' | 'furniture' | 'jewellery'
  | 'footwear' | 'home' | 'food' | 'craft' | 'general'

export type ShowroomTemplate = {
  id: string
  version: 1
  name: string
  vertical: ShowroomVertical
  promise: string
  artDirection: string
  hero: 'cover-story' | 'full-bleed' | 'split-editorial' | 'product-stage' | 'type-led' | 'lookbook' | 'catalogue' | 'brand-film' | 'campaign' | 'manifesto'
  productLayout: 'editorial-grid' | 'masonry' | 'lookbook' | 'spec-list' | 'collection-rail' | 'category-index' | 'story-cards' | 'feature-and-grid' | 'room-scenes' | 'market-table'
  navigation: 'editorial' | 'category' | 'collection' | 'minimal' | 'utility'
  imageTreatment: 'cinematic' | 'documentary' | 'cutout' | 'detail' | 'lifestyle' | 'architectural' | 'texture' | 'clean'
  surface: 'paper' | 'chalk' | 'sand' | 'ink' | 'clay' | 'stone'
  accent: 'leaf' | 'mango' | 'copper' | 'cobalt' | 'terracotta' | 'mono'
  bestFor: string
}

export const SHOWROOM_TEMPLATES: readonly ShowroomTemplate[] = [
  { id: 'atelier-edit', version: 1, name: 'The Atelier Edit', vertical: 'fashion', promise: 'A considered fashion journal, not a product grid.', artDirection: 'Oversized editorial typography, asymmetric image-led cover story, generous paper margins and quiet product captions.', hero: 'cover-story', productLayout: 'editorial-grid', navigation: 'editorial', imageTreatment: 'cinematic', surface: 'paper', accent: 'mono', bestFor: 'Independent fashion labels and curated clothing' },
  { id: 'the-collection', version: 1, name: 'The Collection', vertical: 'fashion', promise: 'A seasonal collection told in chapters.', artDirection: 'Magazine contents navigation, chapter openers, alternating portrait and landscape photography, paced collection sections.', hero: 'lookbook', productLayout: 'lookbook', navigation: 'collection', imageTreatment: 'documentary', surface: 'chalk', accent: 'leaf', bestFor: 'Sellers with several collections or drops' },
  { id: 'object-study', version: 1, name: 'Object Study', vertical: 'general', promise: 'One exceptional product gets the room.', artDirection: 'A single product takes centre stage with oversized detail photography, restrained facts and a focused supporting selection.', hero: 'product-stage', productLayout: 'feature-and-grid', navigation: 'minimal', imageTreatment: 'detail', surface: 'stone', accent: 'mono', bestFor: 'A signature item or special product launch' },
  { id: 'daily-goods', version: 1, name: 'Daily Goods', vertical: 'general', promise: 'A useful, effortless shop catalogue.', artDirection: 'Clear category index, compact product information, practical filters and a fast, legible shopping rhythm.', hero: 'catalogue', productLayout: 'category-index', navigation: 'category', imageTreatment: 'clean', surface: 'chalk', accent: 'leaf', bestFor: 'Everyday multi-category shops' },
  { id: 'maison-noir', version: 1, name: 'Maison Noir', vertical: 'general', promise: 'A quiet luxury boutique with confident restraint.', artDirection: 'Deep ink surfaces, precise serif hierarchy, low-density layouts and large, tactile photography.', hero: 'split-editorial', productLayout: 'feature-and-grid', navigation: 'minimal', imageTreatment: 'cinematic', surface: 'ink', accent: 'copper', bestFor: 'Premium and luxury boutiques' },
  { id: 'new-wave', version: 1, name: 'New Wave', vertical: 'fashion', promise: 'A bold launch page for what is new now.', artDirection: 'High-energy campaign typography, sharp image crops, oversized new-arrival callouts and fast-scanning product rails.', hero: 'campaign', productLayout: 'collection-rail', navigation: 'utility', imageTreatment: 'cutout', surface: 'chalk', accent: 'cobalt', bestFor: 'New arrivals, drops and limited releases' },
  { id: 'the-brand-story', version: 1, name: 'The Brand Story', vertical: 'general', promise: 'Put the maker and their point of view first.', artDirection: 'A narrative-led opening, founder and process copy, documentary photography and products introduced as part of the story.', hero: 'manifesto', productLayout: 'story-cards', navigation: 'editorial', imageTreatment: 'documentary', surface: 'paper', accent: 'terracotta', bestFor: 'Founder-led shops and emerging brands' },
  { id: 'market-day', version: 1, name: 'Market Day', vertical: 'general', promise: 'A lively edit of offers and good finds.', artDirection: 'Warm market-board energy, bold price and availability hierarchy, colourful image groupings and clear enquiry actions.', hero: 'campaign', productLayout: 'masonry', navigation: 'utility', imageTreatment: 'clean', surface: 'clay', accent: 'mango', bestFor: 'Promotions, deals and rotating stock' },
  { id: 'skin-notes', version: 1, name: 'Skin Notes', vertical: 'beauty', promise: 'A calm, ingredient-aware beauty counter.', artDirection: 'Soft tonal surfaces, close-up product texture, routine-led groupings and concise product facts without medical claims.', hero: 'split-editorial', productLayout: 'story-cards', navigation: 'category', imageTreatment: 'texture', surface: 'clay', accent: 'terracotta', bestFor: 'Skincare, cosmetics and personal care' },
  { id: 'street-uniform', version: 1, name: 'Street Uniform', vertical: 'fashion', promise: 'A streetwear drop with attitude and pace.', artDirection: 'Poster-like type, tight crops, asymmetric tiles, strong black-on-paper contrast and drop-led navigation.', hero: 'full-bleed', productLayout: 'masonry', navigation: 'utility', imageTreatment: 'documentary', surface: 'ink', accent: 'mango', bestFor: 'Streetwear, sneakers and youth culture' },
  { id: 'tech-index', version: 1, name: 'Tech Index', vertical: 'electronics', promise: 'A precise, spec-first electronics destination.', artDirection: 'Structured comparison-ready rows, clean product cutouts, clear model and specification hierarchy, no decorative clutter.', hero: 'type-led', productLayout: 'spec-list', navigation: 'category', imageTreatment: 'clean', surface: 'stone', accent: 'cobalt', bestFor: 'Phones, computers and electronics' },
  { id: 'living-spaces', version: 1, name: 'Living Spaces', vertical: 'furniture', promise: 'Furniture presented in real-life context.', artDirection: 'Architectural photography, room-scale compositions, warm neutral surfaces and products grouped by how spaces are used.', hero: 'full-bleed', productLayout: 'room-scenes', navigation: 'collection', imageTreatment: 'architectural', surface: 'sand', accent: 'terracotta', bestFor: 'Furniture, interiors and home design' },
  { id: 'small-treasures', version: 1, name: 'Small Treasures', vertical: 'jewellery', promise: 'A close, tactile view of the details.', artDirection: 'Intimate macro imagery, delicate typography, measured whitespace and small collections treated like keepsakes.', hero: 'product-stage', productLayout: 'editorial-grid', navigation: 'minimal', imageTreatment: 'detail', surface: 'paper', accent: 'copper', bestFor: 'Jewellery, watches and accessories' },
  { id: 'form-and-function', version: 1, name: 'Form & Function', vertical: 'footwear', promise: 'A product-led footwear showroom.', artDirection: 'Sculptural shoe photography, silhouette-led product groupings, clear size and condition details and bold editorial spacing.', hero: 'split-editorial', productLayout: 'feature-and-grid', navigation: 'category', imageTreatment: 'cutout', surface: 'chalk', accent: 'mono', bestFor: 'Shoes, bags and wearable accessories' },
  { id: 'home-rituals', version: 1, name: 'Home Rituals', vertical: 'home', promise: 'Everyday objects with warmth and intention.', artDirection: 'Domestic lifestyle imagery, tactile surfaces, calm section transitions and useful groupings by room or ritual.', hero: 'cover-story', productLayout: 'room-scenes', navigation: 'collection', imageTreatment: 'lifestyle', surface: 'sand', accent: 'leaf', bestFor: 'Homeware, decor and household goods' },
  { id: 'the-pantry', version: 1, name: 'The Pantry', vertical: 'food', promise: 'A deliciously clear specialty food shop.', artDirection: 'Ingredient-led photography, warm market typography, menu-like categories and clear pack, size and availability details.', hero: 'cover-story', productLayout: 'market-table', navigation: 'category', imageTreatment: 'texture', surface: 'clay', accent: 'mango', bestFor: 'Packaged food, specialty groceries and treats' },
  { id: 'made-by-hand', version: 1, name: 'Made by Hand', vertical: 'craft', promise: 'Let the craft, material and maker speak.', artDirection: 'Process and material photography, imperfect paper textures, maker notes and gallery-like product presentation.', hero: 'manifesto', productLayout: 'masonry', navigation: 'editorial', imageTreatment: 'texture', surface: 'paper', accent: 'terracotta', bestFor: 'Artisans, makers and handmade goods' },
  { id: 'the-footnote', version: 1, name: 'The Footnote', vertical: 'general', promise: 'A sharp, modern edit for accessories.', artDirection: 'Narrow editorial columns, detail-led product cards, offset image sequences and discreet typography-led labels.', hero: 'type-led', productLayout: 'editorial-grid', navigation: 'editorial', imageTreatment: 'detail', surface: 'stone', accent: 'copper', bestFor: 'Bags, eyewear and curated accessories' },
  { id: 'the-studio-shop', version: 1, name: 'The Studio Shop', vertical: 'general', promise: 'A flexible, art-directed home for a growing shop.', artDirection: 'Modular asymmetric bento, flexible feature panels, strong shop identity and a balanced mix of story and product.', hero: 'split-editorial', productLayout: 'feature-and-grid', navigation: 'collection', imageTreatment: 'lifestyle', surface: 'paper', accent: 'leaf', bestFor: 'Growing shops with varied inventory' },
  { id: 'open-shelf', version: 1, name: 'Open Shelf', vertical: 'general', promise: 'A welcoming, easy-to-browse shopfront.', artDirection: 'Open shelf-like groupings, generous product photography, friendly hierarchy and simple paths to contact the seller.', hero: 'catalogue', productLayout: 'category-index', navigation: 'category', imageTreatment: 'clean', surface: 'chalk', accent: 'mango', bestFor: 'General retail and first-time showroom owners' },
] as const

export const SHOWROOM_TEMPLATE_VERSION = 1
export const SHOWROOM_TEMPLATE_IDS = SHOWROOM_TEMPLATES.map((template) => template.id)

export function getShowroomTemplate(id: string, version = SHOWROOM_TEMPLATE_VERSION): ShowroomTemplate | undefined {
  return SHOWROOM_TEMPLATES.find((template) => template.id === id && template.version === version)
}
