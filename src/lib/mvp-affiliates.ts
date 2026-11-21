import { z } from 'zod'

const money = z.number().finite().positive().max(100_000_000)
  .refine((value) => Math.round(value * 100) === value * 100, 'Use no more than two decimal places')
const quantity = z.number().finite().positive().max(1_000_000)
  .refine((value) => Math.round(value * 1000) === value * 1000, 'Use no more than three decimal places')

export const mvpOfferCreateSchema = z.object({
  listingId: z.string().trim().min(1).max(128),
  commissionType: z.enum(['PERCENT', 'FIXED_PER_UNIT']),
  commissionValue: money,
  applicationMode: z.enum(['OPEN', 'APPROVAL']).default('APPROVAL'),
  attributionWindowDays: z.number().int().min(1).max(30).default(14),
  termsText: z.string().trim().max(1200).default(''),
}).superRefine((value, ctx) => {
  if (value.commissionType === 'PERCENT' && value.commissionValue > 50) {
    ctx.addIssue({ code: 'custom', path: ['commissionValue'], message: 'Percentage commission cannot exceed 50%' })
  }
})

export const mvpOfferUpdateSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']).optional(),
  commissionValue: money.optional(),
  termsText: z.string().trim().max(1200).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Choose what to update')

export const mvpConversionCreateSchema = z.object({
  referralCode: z.string().trim().min(16).max(128),
  quantity,
  productSubtotal: money,
  enquiryId: z.string().trim().min(1).max(128).optional().nullable(),
  merchantOrderReference: z.string().trim().max(100).optional().nullable(),
  idempotencyKey: z.string().uuid(),
  confirmGenuineSale: z.literal(true),
})

export const mvpConversionUpdateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('CLEAR'), reason: z.string().trim().max(300).optional() }),
  z.object({
    action: z.literal('RECORD_PAYMENT'),
    paymentChannel: z.enum(['MOBILE_MONEY', 'CASH', 'BANK', 'OTHER']),
    paymentReference: z.string().trim().min(3).max(120),
  }),
  z.object({ action: z.literal('REVERSE'), reason: z.string().trim().min(3).max(300) }),
])

export const mvpDisputeSchema = z.object({
  reason: z.string().trim().min(10).max(600),
})

export function offerIsAvailable(offer: { status: string; startsAt: Date | null; endsAt: Date | null }, now = new Date()): boolean {
  return offer.status === 'ACTIVE' &&
    (!offer.startsAt || offer.startsAt <= now) &&
    (!offer.endsAt || offer.endsAt > now)
}
