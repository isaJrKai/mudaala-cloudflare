/**
 * MCI-01 Query understanding — deterministic engine v0.
 *
 * Pure function, no I/O, no model. Parses a query into a typed plan:
 * normalisation, tokens, UGX price grammar, sort preference, category hints
 * (concept pack), offer/request intent, language hints and explicit ambiguity.
 *
 * Design rules from the registry guardrail:
 * - The original query is preserved byte-for-byte in the result.
 * - Ambiguity is surfaced (LOW/MEDIUM/HIGH + notes), never hidden.
 * - The concept pack is data (concepts.ts); grammar and weights live here.
 */
import { MCI01Result, MCI01Request } from '../../contracts/modules/mci01'
import {
  CONCEPT_PACK_VERSION,
  ENGLISH_HINT_TOKENS,
  LUGANDA_HINT_TOKENS,
  lookupConcept,
} from './concepts'

export const MCI01_ENGINE_VERSION = 'mci01-query-understanding-v0.3.0'
export const MCI01_WEIGHTS_REF = CONCEPT_PACK_VERSION

/** Words that never carry category meaning (mirrors commerce conventions). */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'from', 'this', 'that', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'i', 'you', 'we', 'they', 'it',
  'at', 'in', 'on', 'of', 'to', 'by', 'my', 'your', 'our', 'their',
  'sell', 'selling', 'sold', 'sale', 'buy', 'buying', 'wanted', 'need', 'needed',
  'please', 'help', 'anyone', 'any', 'some', 'very', 'more', 'most', 'good', 'best',
  'price', 'cost', 'costs', 'how', 'much', 'where', 'what', 'which', 'who', 'when',
  'get', 'got', 'have', 'has', 'had', 'can', 'will', 'would', 'should', 'do', 'does',
  'there', 'here', 'still', 'now', 'just', 'about', 'around', 'per', 'each', 'one',
  'ugx', 'shs', 'sh', 'usd', 'kes', 'tzs',
])

export function normalizeText(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function tokenize(normalized: string): string[] {
  return normalized
    .split(' ')
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
    .slice(0, 32)
}

/** Parse "20k", "20,000", "2m", "1.5 million" → integer UGX, or null. */
export function parseUgxAmount(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim().toLowerCase()
  const match = /^(\d+(?:\.\d+)?)\s*(k|m|million|thousand)?$/.exec(cleaned)
  if (!match) return null
  const base = Number.parseFloat(match[1])
  if (!Number.isFinite(base)) return null
  const suffix = match[2]
  let value = base
  if (suffix === 'k' || suffix === 'thousand') value = base * 1_000
  else if (suffix === 'm' || suffix === 'million') value = base * 1_000_000
  const rounded = Math.round(value)
  if (rounded <= 0 || rounded > 1_000_000_000) return null
  return rounded
}

const AMOUNT = String.raw`(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|thousand)?`

interface PriceGrammar {
  min: number | null
  max: number | null
  rawExpression: string | null
  notes: string[]
}

/**
 * UGX price grammar. Assumption (documented in the module README): unmarked
 * amounts are UGX — Mudaala listings are priced in UGX by default and the
 * contract rejects non-UGX filters rather than guessing.
 */
/**
 * Grammar normalisation keeps commas (thousand separators) and only strips
 * other punctuation. `normalizeText` (for tokens) strips commas because they
 * carry no token meaning — here they are part of the number grammar.
 */
function normalizeForGrammar(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s,]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function parsePriceGrammar(originalQuery: string): PriceGrammar {
  const q = normalizeForGrammar(originalQuery)
  const notes: string[] = []
  let min: number | null = null
  let max: number | null = null
  let rawExpression: string | null = null

  if (/(usd|dollars?\b|kes\b|tzs\b|ksh\b|€|£|\$)/.test(originalQuery.toLowerCase())) {
    notes.push('non-UGX currency mentioned; price filter skipped (unsupported in v0)')
    return { min: null, max: null, rawExpression: null, notes }
  }

  // between X and Y / from X to Y
  const range =
    /(?:between|from)\s+(?:ugx\s+|shs?\s+)?(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|thousand)?\s+(?:and|to|-)\s+(?:ugx\s+|shs?\s+)?(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|thousand)?/.exec(
      q,
    )
  if (range) {
    const lo = parseUgxAmount(`${range[1]}${range[2] ?? ''}`)
    const hi = parseUgxAmount(`${range[3]}${range[4] ?? ''}`)
    if (lo !== null && hi !== null && lo <= hi) {
      min = lo
      max = hi
      rawExpression = range[0]
    } else if (lo !== null && hi !== null) {
      notes.push('price range bounds inverted; ignored')
    }
  }

  if (min === null && max === null) {
    const under = new RegExp(String.raw`(?:under|below|less than|max|not more than|cheaper than)\s+(?:ugx\s+|shs?\s+)?${AMOUNT}`).exec(q)
    if (under) {
      max = parseUgxAmount(`${under[1]}${under[2] ?? ''}`)
      rawExpression = under[0]
    }
  }

  if (min === null && max === null) {
    const over = new RegExp(String.raw`(?:over|above|more than|from|min|starting)\s+(?:ugx\s+|shs?\s+)?${AMOUNT}`).exec(q)
    if (over) {
      min = parseUgxAmount(`${over[1]}${over[2] ?? ''}`)
      rawExpression = over[0]
    }
  }

  if (min === null && max === null) {
    // Bare amount (e.g. "iphone 20k") → treated as an upper bound, with a note.
    const bare = new RegExp(String.raw`(?:^|\s)(?:ugx\s+|shs?\s+)?${AMOUNT}(?=\s|$)`).exec(q)
    if (bare) {
      const value = parseUgxAmount(`${bare[1]}${bare[2] ?? ''}`)
      if (value !== null) {
        max = value
        rawExpression = bare[0].trim()
        notes.push('bare amount treated as upper bound')
      }
    }
  }

  return { min, max, rawExpression, notes }
}

const REQUEST_MARKERS: readonly string[] = [
  'looking for', 'need', 'where can i get', 'where do i get', 'anyone selling',
  'in search of', 'help me find', 'am searching', 'wanted', 'who sells',
]
const OFFER_MARKERS: readonly string[] = ['for sale', 'selling', 'available', 'on sale', 'we sell']

const SORT_ASC: ReadonlySet<string> = new Set(['cheap', 'cheapest', 'affordable', 'low price', 'lowest'])
const SORT_DESC: ReadonlySet<string> = new Set(['expensive', 'costliest', 'premium', 'high end'])
const SORT_FRESH: ReadonlySet<string> = new Set(['newest', 'latest', 'new arrivals', 'brand new'])

function detectSort(normalized: string): MCI01Result['sort_preference'] {
  if (/(cheapest|lowest price|price asc)/.test(normalized)) return 'PRICE_ASC'
  for (const w of SORT_ASC) if (new RegExp(`\\b${w}\\b`).test(normalized)) return 'PRICE_ASC'
  for (const w of SORT_DESC) if (new RegExp(`\\b${w}\\b`).test(normalized)) return 'PRICE_DESC'
  for (const w of SORT_FRESH) if (normalized.includes(w)) return 'FRESHNESS'
  return null
}

function detectOfferRequest(normalized: string, original: string): { value: 'OFFER' | 'REQUEST' | null; note: string | null } {
  void original
  /**
   * Buyer phrases that contain a sale word ('anyone selling', 'who sells')
   * are explicit REQUEST signals and take precedence over the bare OFFER
   * marker they contain.
   */
  const specificRequestPhrases = ['anyone selling', 'who sells']
  for (const phrase of specificRequestPhrases) {
    if (normalized.includes(phrase)) return { value: 'REQUEST', note: null }
  }
  const hasRequest = REQUEST_MARKERS.some((m) => normalized.includes(m))
  const hasOffer = OFFER_MARKERS.some((m) => normalized.includes(m))
  if (hasRequest && hasOffer) return { value: null, note: 'both offer and request markers present; type intent left unset' }
  if (hasRequest) return { value: 'REQUEST', note: null }
  if (hasOffer) return { value: 'OFFER', note: null }
  return { value: null, note: null }
}

function languageHints(tokens: string[]): MCI01Result['language_hints'] {
  let local = 0
  let english = 0
  for (const t of tokens) {
    if (LUGANDA_HINT_TOKENS.has(t)) local++
    if (ENGLISH_HINT_TOKENS.has(t)) english++
  }
  if (local > 0 && english > 0) return ['mixed']
  if (local > 0) return ['lg']
  if (english > 0) return ['en']
  return ['unknown']
}

/**
 * Run MCI-01. Pure and deterministic: same input + same concept pack version
 * ⇒ same output. `now` is unused in v0 but part of the signature so callers
 * are already time-explicit (freshness interpretations come later).
 */
export function understandQuery(request: MCI01Request, now: Date = new Date()): MCI01Result {
  void now
  // Runtime validation — direct callers cannot bypass the contract.
  const validated = MCI01Request.parse(request)
  const original = validated.query
  const normalized = normalizeText(original)
  const priceGrammar = parsePriceGrammar(original)
  // Price expressions are filters, not product keywords. Remove the parsed
  // expression before tokenisation so terms like 'under' and '1m' do not
  // become mandatory retrieval keywords in MCI-02 or relevance tokens in MCI-03.
  const priceExpression = priceGrammar.min !== null || priceGrammar.max !== null
    ? normalizeText(priceGrammar.rawExpression ?? '')
    : ''
  const tokenText = priceExpression ? normalized.replace(priceExpression, ' ').replace(/\s+/gu, ' ').trim() : normalized
  const tokens = tokenize(tokenText)
  const notes: string[] = []

  // Category hints from the concept pack.
  const byCategory = new Map<string, number>()
  for (const token of tokens) {
    const category = lookupConcept(token)
    if (category) byCategory.set(category, (byCategory.get(category) ?? 0) + 1)
  }
  const categoryHints = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([categoryId, hits]) => ({
      category_id: categoryId,
      source: 'CONCEPT' as const,
      score: Math.min(1, hits / Math.max(1, tokens.length)),
    }))

  notes.push(...priceGrammar.notes)

  const sort = detectSort(normalized)
  const offer = detectOfferRequest(normalized, original)
  if (offer.note) notes.push(offer.note)

  // Ambiguity assessment.
  let level: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW'
  if (tokens.length === 0) {
    level = 'HIGH'
    notes.push('no informative tokens after normalisation')
  } else if (categoryHints.length > 1 && categoryHints[0].score === categoryHints[1].score) {
    level = 'MEDIUM'
    notes.push('multiple equally strong category hints')
  }
  if (offer.value === null && categoryHints.length === 0 && tokens.length > 0) {
    level = level === 'HIGH' ? 'HIGH' : 'MEDIUM'
    notes.push('no category or type intent detected')
  }

  return {
    original_query: original,
    normalized_text: normalized,
    tokens,
    language_hints: languageHints(tokens),
    intent: tokens.length > 0 ? 'SEARCH' : 'UNKNOWN',
    price_filter:
      priceGrammar.min !== null || priceGrammar.max !== null
        ? { currency: 'UGX', min: priceGrammar.min, max: priceGrammar.max, raw_expression: (priceGrammar.rawExpression ?? '').slice(0, 64) }
        : null,
    sort_preference: sort,
    category_hints: categoryHints,
    offer_request: offer.value,
    ambiguity: { level, notes: notes.slice(0, 4) },
  }
}
