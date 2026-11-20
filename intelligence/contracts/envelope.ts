/**
 * Mudaala Intelligence — common response envelope.
 *
 * Implements the master plan §9 common response envelope as a typed, validated
 * contract. Every intelligence module and every gateway response wraps its
 * result in this envelope.
 *
 * Invariants enforced here (not by convention):
 * - `module_id` matches the MCI-xx registry identifier space.
 * - `confidence` is null unless a caller explicitly passes a calibrated value;
 *   there is no default confidence anywhere in the plane.
 * - reason codes and provenance entries are bounded so payloads cannot grow
 *   unbounded with input size.
 */
import { z } from 'zod'

export const CONTRACT_ENVELOPE_VERSION = '1.0'

/** Registry identifier space: MCI-01 … MCI-40 (see registry.json). */
export const MODULE_ID = z.string().regex(/^MCI-(0[1-9]|[1-3][0-9]|40)$/, 'expected MCI-01..MCI-40')
export type ModuleId = z.infer<typeof MODULE_ID>

/** Where a piece of evidence in the envelope came from. */
export const ProvenanceEntry = z.object({
  kind: z.enum(['RULE', 'FEATURE', 'DATA', 'MODEL', 'POLICY', 'HUMAN']),
  /** Stable ref into versioned artefacts, e.g. `mci03.weights.v0`. */
  ref: z.string().min(1).max(128),
  note: z.string().max(256).optional(),
})
export type ProvenanceEntry = z.infer<typeof ProvenanceEntry>

export const ResponseEnvelope = z.object({
  module_id: MODULE_ID,
  contract_version: z.string().min(1).max(16),
  /** Version of the engine/implementation that produced the result. */
  engine_version: z.string().min(1).max(64),
  /** Opaque trace id propagated from the gateway; never contains PII. */
  trace_id: z.string().min(8).max(128),
  result: z.unknown(),
  reason_codes: z.array(z.string().min(1).max(64)).max(32),
  provenance: z.array(ProvenanceEntry).max(64),
  /** Null unless calibrated and meaningful (master plan §9). */
  confidence: z.number().min(0).max(1).nullable(),
  warnings: z.array(z.string().max(256)).max(16),
  /** ISO-8601 timestamp of result creation. */
  created_at: z.string().min(20).max(40),
})
export type ResponseEnvelope = z.infer<typeof ResponseEnvelope>

export interface EnvelopeInput<T> {
  moduleId: ModuleId
  contractVersion: string
  engineVersion: string
  traceId: string
  result: T
  reasonCodes?: string[]
  provenance?: ProvenanceEntry[]
  warnings?: string[]
  /** Only pass a value that is genuinely calibrated; defaults to null. */
  confidence?: number
  now?: Date
}

/**
 * Build a validated envelope. Throws on invariant violation so a malformed
 * result can never silently cross a plane boundary.
 */
export function makeEnvelope<T>(input: EnvelopeInput<T>): ResponseEnvelope {
  const envelope: ResponseEnvelope = {
    module_id: input.moduleId,
    contract_version: input.contractVersion,
    engine_version: input.engineVersion,
    trace_id: input.traceId,
    result: input.result as unknown,
    reason_codes: input.reasonCodes ?? [],
    provenance: input.provenance ?? [],
    confidence: input.confidence ?? null,
    warnings: input.warnings ?? [],
    created_at: (input.now ?? new Date()).toISOString(),
  }
  return ResponseEnvelope.parse(envelope)
}

/** Stable gateway error codes (fail-closed, machine-readable). */
export const GATEWAY_ERROR_CODES = [
  'AUTH_MISSING',
  'AUTH_BAD_SIGNATURE',
  'AUTH_REPLAY',
  'AUTH_CLOCK_SKEW',
  'SCOPE_DENIED',
  'PAYLOAD_TOO_LARGE',
  'PAYLOAD_INVALID',
  'RATE_LIMITED',
  'MODULE_DISABLED',
  'MODULE_TIMEOUT',
  'MODULE_INTERNAL',
  'IDEMPOTENCY_CONFLICT',
  'JOB_STORE_UNAVAILABLE',
] as const
export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number]

export const GatewayErrorBody = z.object({
  error: z.object({
    code: z.enum(GATEWAY_ERROR_CODES),
    message: z.string().max(256),
    trace_id: z.string().min(8).max(128),
    retryable: z.boolean(),
  }),
})
export type GatewayErrorBody = z.infer<typeof GatewayErrorBody>
