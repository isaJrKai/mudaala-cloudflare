/**
 * Opt-in MCI-01 → MCI-02 → Prisma retrieval → MCI-03 → MCI-08 adapter.
 *
 * The commerce plane remains the owner of inventory queries and public-visibility
 * predicates. The gateway receives only a bounded set of public candidate
 * features; seller IDs are replaced with request-local pseudonyms.
 *
 * Every failure returns null so the caller can preserve the existing search path.
 */
import { createGatewayClient, clientConfigFromEnv } from './gateway-client'
import { MCI01Result } from '../../../intelligence/contracts/modules/mci01'
import { MCI02Result } from '../../../intelligence/contracts/modules/mci02'
import { MCI03Result, type RankCandidate } from '../../../intelligence/contracts/modules/mci03'
import { MCI08Result } from '../../../intelligence/contracts/modules/mci08'

type Envelope<T> = { module_id: string; result: T }\n\nconst DISCOVERY_CANDIDATE_CAP = 40\nconst GATEWAY_SAFE_PAYLOAD_BYTES = 28 * 1024

export interface MciDiscoveryPlan {
  queryPlan: ReturnType<typeof MCI01Result.parse>
  retrievalPlan: ReturnType<typeof MCI02Result.parse>
  candidateCap: number
}

export interface MciDiscoveryCandidate extends RankCandidate {
  listing_id: string
}

export interface MciDiscoveryMetadata {
  seller_ref: string
  category_id: string
  published_at: string
}

let cachedClient: ReturnType<typeof createGatewayClient> | undefined

function getClient(fetchImpl?: typeof fetch) {
  if (fetchImpl) return createGatewayClient(clientConfigFromEnv(process.env), { fetchImpl })
  if (!cachedClient) cachedClient = createGatewayClient(clientConfigFromEnv(process.env))
  return cachedClient
}

async function callModule<T>(
  path: string,
  body: unknown,
  moduleId: string,
  parse: (value: unknown) => T,
  fetchImpl?: typeof fetch,
): Promise<T | null> {
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > GATEWAY_SAFE_PAYLOAD_BYTES) return null\n  const response = await getClient(fetchImpl).call<Envelope<unknown>>(path, body)
  if (!response.ok || response.envelope.module_id !== moduleId) return null
  try {
    return parse(response.envelope.result)
  } catch {
    return null
  }
}

/** Prepare the query and a bounded retrieval plan before the commerce DB scan. */
export async function prepareMciDiscovery(
  query: string,
  constraints: { category_id?: string | null; counties?: string[]; offer_request?: 'OFFER' | 'REQUEST' | null },
  now = new Date(),
  fetchImpl?: typeof fetch,
): Promise<MciDiscoveryPlan | null> {
  if (!query.trim() || query.length > 256) return null
  const queryPlan = await callModule(
    '/v1/search/understand',
    { query, locale: 'en-UG', channel: 'WEB', surface: 'SEARCH', now: now.toISOString() },
    'MCI-01',
    (value) => MCI01Result.parse(value),
    fetchImpl,
  )
  if (!queryPlan) return null

  const retrievalPlan = await callModule(
    '/v1/search/plan',
    { query_plan: queryPlan, constraints, bounds: { max_candidates: DISCOVERY_CANDIDATE_CAP } },
    'MCI-02',
    (value) => MCI02Result.parse(value),
    fetchImpl,
  )
  if (!retrievalPlan) return null

  // The public commerce query remains authoritative. Refuse a plan that
  // relaxes visibility or asks for an unbounded/invalid candidate scan.
  if (
    retrievalPlan.filters.statuses.length !== 1 ||
    retrievalPlan.filters.statuses[0] !== 'ACTIVE' ||
    retrievalPlan.limits.candidate_cap < 1 ||
    retrievalPlan.limits.candidate_cap > DISCOVERY_CANDIDATE_CAP
  ) return null

  return { queryPlan, retrievalPlan, candidateCap: retrievalPlan.limits.candidate_cap }
}

/** Rank real commerce candidates and diversify the final result slate. */
export async function rankAndDiversifyMciDiscovery(input: {
  queryPlan: MciDiscoveryPlan['queryPlan']
  candidates: MciDiscoveryCandidate[]
  metadata: Record<string, MciDiscoveryMetadata>
  context: { county?: string | null; area?: string | null; now: string }
  rotationBucket: number
}, fetchImpl?: typeof fetch): Promise<string[] | null> {
  if (input.candidates.length === 0 || input.candidates.length > DISCOVERY_CANDIDATE_CAP) return null
  const candidateIds = new Set(input.candidates.map((candidate) => candidate.listing_id))
  if (candidateIds.size !== input.candidates.length) return null

  const ranked = await callModule(
    '/v1/search/rank',
    { query_plan: input.queryPlan, candidates: input.candidates, context: input.context },
    'MCI-03',
    (value) => MCI03Result.parse(value),
    fetchImpl,
  )
  if (!ranked || ranked.ranked.length !== input.candidates.length) return null

  const diversified = await callModule(
    '/v1/search/diversify',
    {
      ranked: ranked.ranked,
      metadata: input.metadata,
      settings: { max_per_seller: 2, rotation_bucket: input.rotationBucket % 10, exploration_slots: 1 },
    },
    'MCI-08',
    (value) => MCI08Result.parse(value),
    fetchImpl,
  )
  if (!diversified) return null

  const slateIds = diversified.slate
  // The controller may reorder and demote; it must never invent, duplicate,
  // or silently drop eligible inventory.
  if (
    slateIds.length !== candidateIds.size ||
    new Set(slateIds).size !== slateIds.length ||
    slateIds.some((id) => !candidateIds.has(id))
  ) return null

  return slateIds
}
