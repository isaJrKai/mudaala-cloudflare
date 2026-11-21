/**
 * MCI-02 Retrieval planner — deterministic engine v0.
 *
 * Turns an MCI-01 query plan into a bounded, plane-neutral retrieval plan.
 * The commerce plane maps `filters` onto its Prisma queries; nothing here
 * executes SQL or touches a database.
 *
 * Registry guardrails made executable:
 * - public/live inventory only (statuses + exclusion rules in-band),
 * - bounded candidate cost (cap, validated against contract max),
 * - no private or draft data paths exist to be selected.
 */
import { MCI01Result } from '../../contracts/modules/mci01'
import { MCI02Result, type RetrievalPath } from '../../contracts/modules/mci02'

export const MCI02_ENGINE_VERSION = 'mci02-retrieval-planner-v0.2.0'

const DEFAULT_CANDIDATE_CAP = 200
const MAX_CANDIDATE_CAP = 500

function isSpecificCategory(categoryId: string): boolean {
  // Subcategories carry a hyphen (e.g. electronics-phones); top-level ids do not.
  return categoryId.includes('-')
}

function selectivityForPath(kind: RetrievalPath['kind'], uses: { keywords: number; categories: string[] }): RetrievalPath['expected_selectivity'] {
  if (kind === 'CATEGORY') {
    const specific = uses.categories.some(isSpecificCategory)
    return specific ? 'NARROW' : 'MEDIUM'
  }
  if (kind === 'KEYWORD') return uses.keywords <= 2 ? 'MEDIUM' : 'NARROW'
  if (kind === 'PRICE') return 'MEDIUM'
  return 'BROAD' // AREA
}

export function planRetrieval(
  queryPlan: MCI01Result,
  constraints?: {
    category_id?: string | null
    counties?: string[]
    offer_request?: 'OFFER' | 'REQUEST' | null
  },
  bounds?: { max_candidates?: number },
): MCI02Result {
  // Runtime validation: the plan is re-validated here so direct engine
  // callers (eval harness, Hermes handlers) get the same boundary as the
  // gateway. TypeScript types are not runtime validation.
  const validatedPlan = MCI01Result.parse(queryPlan)
  queryPlan = validatedPlan
  // Categories: explicit constraint wins, then query hints (max 4).
  const categories: string[] = []
  if (constraints?.category_id) categories.push(constraints.category_id)
  for (const hint of queryPlan.category_hints) {
    if (!categories.includes(hint.category_id) && categories.length < 4) categories.push(hint.category_id)
  }

  // Types: explicit constraints narrow; query language does NOT. Buyer
  // phrasing like "looking for a fridge" is a search for OFFER listings, not
  // a request to see REQUEST posts — MCI-01's offer_request is a language
  // signal for other consumers, not a retrieval-intent signal.
  const types: Array<'OFFER' | 'REQUEST'> = constraints?.offer_request
    ? [constraints.offer_request]
    : ['OFFER', 'REQUEST']

  const keywords = queryPlan.tokens.slice(0, 16)
  const counties = (constraints?.counties ?? []).slice(0, 8)

  const paths: RetrievalPath[] = []
  if (keywords.length > 0) {
    paths.push({ kind: 'KEYWORD', uses: ['keywords'], expected_selectivity: selectivityForPath('KEYWORD', { keywords: keywords.length, categories }) })
  }
  if (categories.length > 0) {
    paths.push({ kind: 'CATEGORY', uses: ['categories'], expected_selectivity: selectivityForPath('CATEGORY', { keywords: keywords.length, categories }) })
  }
  if (queryPlan.price_filter) {
    paths.push({ kind: 'PRICE', uses: ['price'], expected_selectivity: 'MEDIUM' })
  }
  if (counties.length > 0) {
    paths.push({ kind: 'AREA', uses: ['counties'], expected_selectivity: 'BROAD' })
  }
  if (paths.length === 0) {
    // Pure browse: everything public, ordered by relevance/freshness ranking.
    paths.push({ kind: 'CATEGORY', uses: ['categories'], expected_selectivity: 'BROAD' })
  }

  const requestedCap = bounds?.max_candidates ?? DEFAULT_CANDIDATE_CAP
  const candidateCap = Math.max(1, Math.min(requestedCap, MAX_CANDIDATE_CAP))

  const ordering: MCI02Result['ordering'] =
    queryPlan.sort_preference === null ? 'RELEVANCE' : queryPlan.sort_preference

  return {
    filters: {
      statuses: ['ACTIVE'],
      types,
      categories,
      price: queryPlan.price_filter
        ? { currency: 'UGX', min: queryPlan.price_filter.min, max: queryPlan.price_filter.max }
        : null,
      counties,
      keywords,
    },
    paths,
    ordering,
    limits: { candidate_cap: candidateCap },
    exclusion_rules: ['NO_PRIVATE_OR_DRAFT', 'NO_EXPIRED', 'NO_HIDDEN', 'NO_SEED_LISTINGS'],
    semantic_path_available: false,
  }
}
