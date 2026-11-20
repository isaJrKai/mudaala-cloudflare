/**
 * Gateway route table and module dispatch.
 *
 * Every /v1 route declares its required scope; handlers invoke the
 * intelligence-plane module engines and wrap results in the common envelope.
 * Handlers are pure with respect to the request: no logging of payloads, no
 * state, deterministic engines.
 */
import { MCI01Request, MCI01Result } from '../../contracts/modules/mci01'
import { MCI02Result, validateMCI02Request } from '../../contracts/modules/mci02'
import { MCI03Request } from '../../contracts/modules/mci03'
import { MCI08Request } from '../../contracts/modules/mci08'
import { MerchantAnalyticsSnapshot } from '../../contracts/modules/mci27'
import { JobRecord, JobSubmission, JOB_BUDGET_CAPS } from '../../contracts/jobs'
import { makeEnvelope } from '../../contracts/envelope'
import { understandQuery, MCI01_ENGINE_VERSION } from '../../modules/mci01-query-understanding/engine'
import { planRetrieval, MCI02_ENGINE_VERSION } from '../../modules/mci02-retrieval-planner/engine'
import { rankCandidates, MCI03_ENGINE_VERSION } from '../../modules/mci03-relevance-ranker/engine'
import { diversifySlate, MCI08_ENGINE_VERSION } from '../../modules/mci08-diversity-controller/engine'
import { analyzeMerchantPerformance, MCI27_ENGINE_VERSION } from '../../modules/mci27-merchant-performance-analyst/engine'
import { InMemoryNonceCache, type NonceCache, type RateLimiter } from './limiter'

export interface GatewayEnv {
  callers: Map<string, import('./auth').CallerConfig>
  limiter: RateLimiter
  nonces: NonceCache
  jobStore: JobStore
  nowSeconds: () => number
  nowMs: () => number
  nowIso: () => string
  version: string
}

export const ENVELOPE_CONTRACT_VERSION = '1.0'
export const UPSTREAM_DEADLINE_MS = 5_000
export const MAX_PAYLOAD_BYTES = 32 * 1024

export interface RouteDefinition {
  method: 'POST' | 'GET'
  scope: string | null
  handler: (body: unknown, context: HandlerContext) => Promise<unknown>
}

export interface HandlerContext {
  traceId: string
  callerId: string
  env: GatewayEnv
}

export interface JobStore {
  submit(submission: JobSubmission, callerId: string): JobRecord
  read(jobId: string): JobRecord | undefined
  /** True when the last submit() for this id returned an existing record. */
  wasReplay(jobId: string): boolean
}

interface JobStoreEntry extends JobRecord {
  payloadBytes: number
}

/**
 * v0 job store: in-isolate memory, staging-only (ADR-0004). Durability
 * requires the approved Postgres/queue store; the interface is the seam.
 */
export class MemoryJobStore implements JobStore {
  private jobs = new Map<string, JobStoreEntry>()
  private idemIndex = new Map<string, string>()
  private replays = new Set<string>()

  constructor(private idFactory: () => string, private nowIso: () => string) {}

  submit(submission: JobSubmission, callerId: string): JobRecord {
    const payloadSize = JSON.stringify(submission.payload ?? null).length
    if (payloadSize > JOB_BUDGET_CAPS.payloadBytes) {
      throw new Error('PAYLOAD_TOO_LARGE')
    }
    const idemKey = `${callerId}:${submission.kind}:${submission.idempotency_key}`
    const existing = this.idemIndex.get(idemKey)
    if (existing) {
      this.replays.add(existing)
      return this.jobs.get(existing)!
    }
    this.replays.delete('')
    const jobId = this.idFactory()
    const record: JobStoreEntry = {
      job_id: jobId,
      schema_version: '1.0',
      kind: submission.kind,
      status: 'QUEUED',
      submitter: callerId,
      idempotency_key: submission.idempotency_key,
      payload: submission.payload,
      budget: submission.budget,
      attempts: 0,
      created_at: this.nowIso(),
      started_at: null,
      finished_at: null,
      result_ref: null,
      error: null,
      payloadBytes: payloadSize,
    }
    this.jobs.set(jobId, record)
    this.idemIndex.set(idemKey, jobId)
    return { ...record }
  }

  read(jobId: string): JobRecord | undefined {
    const record = this.jobs.get(jobId)
    return record ? { ...record } : undefined
  }

  wasReplay(jobId: string): boolean {
    return this.replays.has(jobId)
  }
}

/** Handlers receive the parsed body and produce the envelope result. */
export const ROUTES: Record<string, RouteDefinition> = {
  '/v1/search/understand': {
    method: 'POST',
    scope: 'search:understand',
    handler: async (body, context) => {
      const request = MCI01Request.parse(body)
      const result: MCI01Result = understandQuery(request)
      const envelope = makeEnvelope({
        moduleId: 'MCI-01',
        contractVersion: ENVELOPE_CONTRACT_VERSION,
        engineVersion: MCI01_ENGINE_VERSION,
        traceId: context.traceId,
        result,
      })
      return envelope
    },
  },
  '/v1/search/plan': {
    method: 'POST',
    scope: 'search:plan',
    handler: async (body, context) => {
      const { queryPlan } = validateMCI02Request(body)
      const parsed = body as { query_plan: MCI01Result; constraints?: Parameters<typeof planRetrieval>[1]; bounds?: Parameters<typeof planRetrieval>[2] }
      const result = planRetrieval(queryPlan, parsed.constraints, parsed.bounds)
      return makeEnvelope({
        moduleId: 'MCI-02',
        contractVersion: ENVELOPE_CONTRACT_VERSION,
        engineVersion: MCI02_ENGINE_VERSION,
        traceId: context.traceId,
        result,
      })
    },
  },
  '/v1/search/rank': {
    method: 'POST',
    scope: 'search:rank',
    handler: async (body, context) => {
      const request = MCI03Request.parse(body)
      const queryPlan = request.query_plan as MCI01Result
      const result = rankCandidates(queryPlan, request.candidates, {
        county: request.context.county ?? null,
        area: request.context.area ?? null,
        now: request.context.now,
      })
      return makeEnvelope({
        moduleId: 'MCI-03',
        contractVersion: ENVELOPE_CONTRACT_VERSION,
        engineVersion: MCI03_ENGINE_VERSION,
        traceId: context.traceId,
        result,
        provenance: [{ kind: 'RULE', ref: result.weights_ref }],
      })
    },
  },
  '/v1/search/diversify': {
    method: 'POST',
    scope: 'search:diversify',
    handler: async (body, context) => {
      const request = MCI08Request.parse(body)
      const settings = request.settings ?? {}
      const result = diversifySlate(
        request.ranked as Array<{ listing_id: string; score: number; reasons: string[]; contributions: Record<string, number> }>,
        request.metadata,
        {
          maxPerSeller: settings.max_per_seller,
          rotationBucket: settings.rotation_bucket,
          explorationSlots: settings.exploration_slots,
        },
      )
      return makeEnvelope({
        moduleId: 'MCI-08',
        contractVersion: ENVELOPE_CONTRACT_VERSION,
        engineVersion: MCI08_ENGINE_VERSION,
        traceId: context.traceId,
        result,
      })
    },
  },
  '/v1/merchant/insights': {
    method: 'POST',
    scope: 'merchant:insights',
    handler: async (body, context) => {
      const snapshot = MerchantAnalyticsSnapshot.parse(body)
      const result = analyzeMerchantPerformance(snapshot)
      return makeEnvelope({
        moduleId: 'MCI-27',
        contractVersion: ENVELOPE_CONTRACT_VERSION,
        engineVersion: MCI27_ENGINE_VERSION,
        traceId: context.traceId,
        result,
      })
    },
  },
  '/v1/jobs': {
    method: 'POST',
    scope: 'jobs:submit',
    handler: async (body, context) => {
      const submission = JobSubmission.parse({ ...(body as Record<string, unknown>), submitter: context.callerId })
      const record = context.env.jobStore.submit(submission, context.callerId)
      return makeEnvelope({
        moduleId: 'MCI-27',
        contractVersion: ENVELOPE_CONTRACT_VERSION,
        engineVersion: 'gateway-jobs-v0',
        traceId: context.traceId,
        result: {
          job_id: record.job_id,
          status: record.status,
          kind: record.kind,
          idempotent_replay: context.env.jobStore.wasReplay(record.job_id),
          created_at: record.created_at,
        },
        warnings: record.budget.compute_profile === 'GPU_BATCH' ? ['GPU_BATCH requires explicit owner approval before execution'] : [],
      })
    },
  },
}

export function routeFor(path: string, method: string): RouteDefinition | undefined {
  const route = ROUTES[path]
  if (!route) return undefined
  if (route.method !== method) return undefined
  return route
}

export function createDefaultEnv(options?: { limiter?: RateLimiter; nonces?: NonceCache }): GatewayEnv {
  return {
    callers: new Map(),
    limiter: options?.limiter ?? { check: async () => true },
    nonces: options?.nonces ?? new InMemoryNonceCache(),
    jobStore: new MemoryJobStore(
      () => `job-${Math.random().toString(36).slice(2, 12)}`,
      () => new Date().toISOString(),
    ),
    nowSeconds: () => Math.floor(Date.now() / 1000),
    nowMs: () => Date.now(),
    nowIso: () => new Date().toISOString(),
    version: '0.1.0',
  }
}
