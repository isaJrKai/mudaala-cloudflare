/**
 * MCI-08 Discovery diversity controller — input/output contract (v0).
 *
 * Deterministic slate controller per the registry guardrail: measure exposure
 * fairness, preserve relevance and policy gates. Input is the MCI-03 ranking
 * plus the metadata needed for fairness maths only.
 */
import { z } from 'zod'
import { RankedItem } from './mci03'

export const MCI08_CONTRACT_VERSION = '1.0'

/** Metadata keys are bounded: fairness maths only needs entries for slate ids. */
export const MCI08_METADATA_MAX_KEYS = 1000

export const MCI08Request = z
  .object({
    /** MCI-03 ranked output, in order — items validated here, not trusted. */
    ranked: z.array(RankedItem).max(500),
    metadata: z
      .record(
        z.string(),
        z.object({
          seller_ref: z.string().min(1).max(128),
          category_id: z.string().max(64),
          published_at: z.string(),
        }),
      )
      .refine((meta) => Object.keys(meta).length <= MCI08_METADATA_MAX_KEYS, {
        message: `metadata is limited to ${MCI08_METADATA_MAX_KEYS} entries`,
      }),
    settings: z
      .object({
        max_per_seller: z.number().int().min(1).max(10).optional(),
        /** Deterministic rotation bucket for stable page-level fairness. */
        rotation_bucket: z.number().int().min(0).max(9).optional(),
        exploration_slots: z.number().int().min(0).max(3).optional(),
      })
      .optional(),
  })
export type MCI08Request = z.infer<typeof MCI08Request>

export const MCI08Result = z.object({
  /** Ordered listing ids after diversification. */
  slate: z.array(z.string().max(128)).max(500),
  /** Items pushed beyond the slate window by caps, with the rule that did it. */
  demoted: z.array(z.object({ listing_id: z.string().max(128), rule: z.string().max(64) })).max(100),
  fairness_report: z.object({
    distinct_sellers_top5: z.number().int().min(0).max(5),
    /** Share of the slate held by the single most-exposed seller (0–1). */
    top_seller_share: z.number().min(0).max(1),
    applied_caps: z.array(z.string().max(64)).max(8),
    new_shop_slots_used: z.number().int().min(0).max(3),
  }),
})
export type MCI08Result = z.infer<typeof MCI08Result>

export type RankedItemLike = RankedItem
