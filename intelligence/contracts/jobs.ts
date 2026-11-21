/**
 * Mudaala Intelligence — asynchronous job contract.
 *
 * State machine, budgets and idempotency semantics shared by the gateway
 * (`/v1/jobs`), the job store adapter and Hermes. See ADR-0004: the durable
 * store choice is deferred; this contract is the stable part.
 */
import { z } from 'zod'

export const JOB_SCHEMA_VERSION = '1.0'

/** v0 allowlist — a job kind must have an owner and a purpose before joining. */
export const JOB_KINDS = [
  'EVAL_BENCHMARK_RUN',
  'MERCHANT_ANALYTICS_SNAPSHOT',
  'EVENT_BACKFILL',
  'MODULE_WARMUP',
] as const
export type JobKind = (typeof JOB_KINDS)[number]

export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/** Legal transitions; anything else is a contract violation. */
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  QUEUED: ['RUNNING', 'CANCELLED', 'DEAD'],
  RUNNING: ['SUCCEEDED', 'FAILED', 'CANCELLED'],
  FAILED: ['QUEUED', 'DEAD', 'CANCELLED'],
  SUCCEEDED: [],
  CANCELLED: [],
  DEAD: [],
}

export const COMPUTE_BUDGET_PROFILES = ['CPU_XS', 'CPU_S', 'CPU_M', 'GPU_BATCH'] as const
export type ComputeBudgetProfile = (typeof COMPUTE_BUDGET_PROFILES)[number]

/** Hard contract caps; stores may enforce stricter limits. */
export const JOB_BUDGET_CAPS = {
  maxAttempts: 5,
  deadlineSeconds: 3600,
  payloadBytes: 32 * 1024,
} as const

export const JobBudget = z.object({
  max_attempts: z.number().int().min(1).max(JOB_BUDGET_CAPS.maxAttempts),
  deadline_seconds: z.number().int().min(1).max(JOB_BUDGET_CAPS.deadlineSeconds),
  compute_profile: z.enum(COMPUTE_BUDGET_PROFILES),
})
export type JobBudget = z.infer<typeof JobBudget>

export const JobSubmission = z.object({
  schema_version: z.literal(JOB_SCHEMA_VERSION),
  kind: z.enum(JOB_KINDS),
  /** Caller-generated; same key + same payload hash = same job. */
  idempotency_key: z.string().min(8).max(128),
  payload: z.unknown(),
  budget: JobBudget,
  /** Set by the gateway from the authenticated caller; not client-supplied. */
  submitter: z.string().min(1).max(64).optional(),
})
export type JobSubmission = z.infer<typeof JobSubmission>

export const JobError = z.object({
  code: z.string().min(1).max(64),
  message: z.string().max(256),
  retryable: z.boolean(),
})
export type JobError = z.infer<typeof JobError>

export const JobRecord = z.object({
  job_id: z.string().min(8).max(128),
  schema_version: z.literal(JOB_SCHEMA_VERSION),
  kind: z.enum(JOB_KINDS),
  status: z.enum(JOB_STATUSES),
  submitter: z.string().min(1).max(64),
  idempotency_key: z.string().min(8).max(128),
  payload: z.unknown(),
  budget: JobBudget,
  attempts: z.number().int().min(0).max(JOB_BUDGET_CAPS.maxAttempts),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  /** Reference to a stored artefact (never inline large results). */
  result_ref: z.string().max(256).nullable(),
  error: JobError.nullable(),
})
export type JobRecord = z.infer<typeof JobRecord>

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal job transition ${from} -> ${to}`)
  }
}

/** Bounded exponential backoff with jitter, seconds. */
export function retryDelaySeconds(attempt: number): number {
  const base = Math.min(2 ** attempt, 60)
  const jitter = Math.random() * 0.25 * base
  return Math.round(base + jitter)
}

/**
 * GPU jobs are a budget-controlled resource (master plan principle 12):
 * submissions may request the profile, but activation requires an explicit
 * approval flag at the store level — enforced by callers, tested in contract.
 */
export function requiresGpuApproval(budget: JobBudget): boolean {
  return budget.compute_profile === 'GPU_BATCH'
}
