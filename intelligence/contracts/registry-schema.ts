/**
 * Machine-readable 40-module registry — schema, loader and validation.
 *
 * Satisfies resource matrix §11 ("machine-readable resource register").
 * The registry is a governance artefact: CI validates its schema and
 * completeness; only the repository owner changes statuses, and every status
 * change needs an evidence link. Statuses use the master plan §15 vocabulary.
 */
import { z } from 'zod'
import registryJson from './registry.json'

export const MODULE_FAMILIES = [
  'DISCOVERY_RANKING',
  'TRUST_SAFETY_COMPLIANCE',
  'BUYER_EXPERIENCE',
  'MERCHANT_SUPPLIER_OPS',
  'TRADE_FULFILMENT',
  'GROWTH_ADVERTISING_NETWORK',
] as const

export const MODULE_STATUS = [
  'PROPOSED',
  'RESEARCHED',
  'IN_DEVELOPMENT',
  'SHADOW',
  'CANARY',
  'PRODUCTION',
  'PAUSED',
  'REJECTED',
] as const

export const MODULE_DECISION = [
  'REUSE',
  'ADOPT',
  'ADAPT',
  'BUILD',
  'TRAIN',
  'DEFER',
  'REJECT',
] as const

export const COMPUTE_PROFILE = ['CPU_XS', 'CPU_S', 'CPU_M', 'GPU_BATCH', 'EXTERNAL_API', 'NONE_YET'] as const

export const RegistryEntry = z.object({
  module_id: z.string().regex(/^MCI-(0[1-9]|[1-3][0-9]|40)$/),
  name: z.string().min(3).max(80),
  family: z.enum(MODULE_FAMILIES),
  /** Registry vocabulary per master plan §15. */
  status: z.enum(MODULE_STATUS),
  /** Resource-matrix decision vocabulary. */
  decision: z.enum(MODULE_DECISION),
  /** Owner is a person; 'unassigned' is honest until the owner names one. */
  owner: z.string().max(64),
  product_outcome: z.string().max(300),
  /** Existing Mudaala files/capabilities this module builds on. */
  existing_assets: z.array(z.string().max(160)).max(8),
  depends_on: z.array(z.string().regex(/^MCI-\d{2}$/)).max(6),
  /** Gateway route when the module is exposed; null until exposed. */
  gateway_route: z.string().max(64).nullable(),
  /** Engineering target for design/testing, not an achieved SLO. */
  latency_budget_ms: z.number().int().min(0).max(10_000),
  compute_profile: z.enum(COMPUTE_PROFILE),
  /** Coarse data classes only — never field-level private data here. */
  data_inputs: z.array(z.string().max(80)).max(6),
  requires_consent: z.boolean(),
  /** True when a human decision is required before consequential output. */
  human_gate: z.boolean(),
  /** Evidence links (commit, benchmark report, PR). Empty is honest. */
  evidence_links: z.array(z.string().max(200)).max(6),
  notes: z.string().max(400),
})
export type RegistryEntry = z.infer<typeof RegistryEntry>

export const Registry = z.object({
  version: z.string().min(1).max(16),
  updated: z.string().min(20).max(40),
  /** Canonical source of the 40-module list. */
  canonical_source: z.string().min(1).max(200),
  modules: z.array(RegistryEntry).length(40),
})
export type Registry = z.infer<typeof Registry>

/** Parsed, validated registry. Importing this file validates the JSON. */
export const REGISTRY: Registry = Registry.parse(registryJson)

export function registryEntry(moduleId: string): RegistryEntry | undefined {
  return REGISTRY.modules.find((m) => m.module_id === moduleId)
}

/** Modules currently implemented in the intelligence plane. */
export const IMPLEMENTED_MODULE_IDS = REGISTRY.modules
  .filter((m) => m.status === 'IN_DEVELOPMENT' || m.status === 'SHADOW' || m.status === 'CANARY' || m.status === 'PRODUCTION')
  .map((m) => m.module_id)
