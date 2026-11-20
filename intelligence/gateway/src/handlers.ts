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

/**
 * Thrown when an idempotency key is reused with a DIFFERENT payload. The
 * gateway maps this to 409 IDEMPOTENCY_CONFLICT. Key + identical payload
 * returns the original job instead.
 */
export class IdempotencyConflictError extends Error {
  constructor() {
    super('IDEMPOTENCY_CONFLICT')
    this.name = 'IDEMPOTENCY_CONFLICT'
  }
}

/**
 * Deterministic JSON canonicalisation (sorted object keys, fixed scalar
 * formatting). Two payloads that are equal by content — regardless of key
 * order — produce the same canonical string, which is what idempotency
 * compares. Values are JSON-representable only (the submission contract is
 * parsed JSON).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    return `{${entries.join(',')}}`
  }
  return 'null'
}

interface JobStoreEntry extends JobRecord {
  payloadBytes: number
  /** Canonical payload string — the idempotency comparison basis. */
  payloadCanonical: string
}

/**
 * v0 job store: in-isolate memory, staging-only (ADR-0004). Durability
 * requires the approved Postgres/queue store; the interface is the seam.
 *
 * Idempotency semantics (remediation of the increment-1 behaviour, which
 * returned the original job for ANY reuse of a key):
 *   same caller + kind + key + content-equal payload → original job (replay)
 *   same caller + kind + key + different payload     → IDEMPOTENCY_CONFLICT
 * Submission is synchronous, so concurrent submissions within an isolate
 * cannot create duplicates; the durable store enforces the same guarantee
 * across isolates with a UNIQUE constraint (intelligence.jobs schema).
 *
 * Retention: finished records older than `retentionMs` are swept on submit;
 * when the store exceeds `maxEntries`, oldest finished records are evicted
 * first (then oldest overall — staging semantics, documented). A durable
 * store uses the 180-day retention policy in the SQL schema instead.
 */
export class MemoryJobStore implements JobStore {
  private jobs = new Map<string, JobStoreEntry>()
  private idemIndex = new Map<string, string>()
  private replays = new Set<string>()
  private readonly retentionMs: number
  private readonly maxEntries: number

  constructor(
    private idFactory: () => string,
    private nowIso: () => string,
    options?: { retentionMs?: number; maxEntries?: number },
  ) {
    this.retentionMs = options?.retentionMs ?? 24 * 60 * 60 * 1000
    this.maxEntries = options?.maxEntries ?? 1_000
  }

  submit(submission: JobSubmission, callerId: string): JobRecord {
    const payloadCanonical = canonicalJson(submission.payload ?? null)
    const payloadBytes = new TextEncoder().encode(payloadCanonical).length
    if (payloadBytes > JOB_BUDGET_CAPS.payloadBytes) {
      throw new Error('PAYLOAD_TOO_LARGE')
    }
    // Sweep BEFORE the idempotency lookup: a key whose record was retained
    // past its TTL (or evicted) must be reusable, not replayed from a stale
    // index entry.
    this.sweep()
    const idemKey = `${callerId}:${submission.kind}:${submission.idempotency_key}`
    const existing = this.idemIndex.get(idemKey)
    if (existing) {
      const record = this.jobs.get(existing)
      if (!record) throw new Error('JOB_STORE_UNAVAILABLE')
      if (record.payloadCanonical !== payloadCanonical) {
        throw new IdempotencyConflictError()
      }
      this.replays.add(existing)
      if (this.replays.size > 500) this.replays = new Set([...this.replays].slice(-250))
      return { ...record }
    }
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
      payloadBytes,
      payloadCanonical,
    }
    this.jobs.set(jobId, record)
    this.idemIndex.set(idemKey, jobId)
    // Enforce the size bound with the new record included.
    this.sweep()
    return { ...record }
  }

  read(jobId: string): JobRecord | undefined {
    const record = this.jobs.get(jobId)
    return record ? { ...record } : undefined
  }

  wasReplay(jobId: string): boolean {
    return this.replays.has(jobId)
  }

  /** Mark a job succeeded (worker path); enables retention sweep tests. */
  finish(jobId: string, resultRef?: string): JobRecord | undefined {
    const record = this.jobs.get(jobId)
    if (!record) return undefined
    record.status = 'SUCCEEDED'
    record.finished_at = this.nowIso()
    if (resultRef) record.result_ref = resultRef
    return { ...record }
  }

  private sweep(): void {
    const nowMs = Date.parse(this.nowIso())
    if (!Number.isFinite(nowMs)) return
    const victims = new Set<string>()
    // 1. Retention: finished records past their TTL are removed.
    for (const [id, record] of this.jobs) {
      if (record.finished_at !== null) {
        const finishedMs = Date.parse(record.finished_at)
        if (Number.isFinite(finishedMs) && nowMs - finishedMs > this.retentionMs) {
          victims.add(id)
        }
      }
    }
    // 2. Size bound: evict oldest finished first, then oldest overall.
    while (this.jobs.size - victims.size > this.maxEntries) {
      let oldestFinished: string | null = null
      let oldestAny: string | null = null
      for (const [id, record] of this.jobs) {
        if (victims.has(id)) continue
        if (record.finished_at !== null && (oldestFinished === null || id < oldestFinished)) oldestFinished = id
        if (oldestAny === null || id < oldestAny) oldestAny = id
      }
      const victim = oldestFinished ?? oldestAny
      if (victim === null) break
      victims.add(victim)
    }
    if (victims.size === 0) return
    for (const id of victims) {
      this.jobs.delete(id)
      this.replays.delete(id)
    }
    for (const [key, jobId] of [...this.idemIndex]) {
      if (victims.has(jobId)) this.idemIndex.delete(key)
    }
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
