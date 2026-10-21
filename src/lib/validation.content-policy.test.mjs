import { describe, expect, test } from 'bun:test'
import { businessProfileSchema, containsMarketplaceEmoji, feedbackCreateSchema, reportActionSchema, reportCreateSchema } from './validation'
import { REPORT_REASONS } from './constants'
import { shouldSendFormalPolicyWarning } from './policy-violations'

describe('Mudaala marketplace content policy', () => {
  test('detects common emoji, including cake, flags and keycaps', () => {
    expect(containsMarketplaceEmoji('Annet cakes 🎂')).toBe(true)
    expect(containsMarketplaceEmoji('Fresh fruit 🇺🇬')).toBe(true)
    expect(containsMarketplaceEmoji('Special 1️⃣ offer')).toBe(true)
  })

  test('preserves ordinary business-name punctuation and local wording', () => {
    expect(containsMarketplaceEmoji("Annet Cakes & Bakery")).toBe(false)
    expect(containsMarketplaceEmoji("O'Neil Cakes - Kampala")).toBe(false)
    expect(containsMarketplaceEmoji('Kampala Furniture & Interiors')).toBe(false)
  })

  test('rejects emoji in a business name with a clear correction message', () => {
    const result = businessProfileSchema.safeParse({
      businessName: 'Annet cakes 🎂',
      photoUrl: null,
      category: null,
      description: null,
      county: 'Kampala',
      area: null,
      phone: '0772345678',
      whatsapp: null,
      hours: null,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('businessName') && issue.message.includes('Remove emojis'))).toBe(true)
    }
  })

  test('accepts the same shop name once only the emoji is removed', () => {
    const result = businessProfileSchema.safeParse({
      businessName: 'Annet cakes',
      photoUrl: null,
      category: null,
      description: null,
      county: 'Kampala',
      area: null,
      phone: '0772345678',
      whatsapp: null,
      hours: null,
    })
    expect(result.success).toBe(true)
  })
})


describe('Mudaala safety report reasons', () => {
  test('includes specific report categories for image and user-safety abuse', () => {
    expect(REPORT_REASONS).toContain('NUDITY_OR_SEXUAL_CONTENT')
    expect(REPORT_REASONS).toContain('HARASSMENT_OR_HATE')
    expect(REPORT_REASONS).toContain('PERSONAL_INFORMATION')
    expect(REPORT_REASONS).toContain('SPAM_OR_IMPERSONATION')
  })

  test('accepts a report for nudity or sexual content at the API validation boundary', () => {
    expect(reportCreateSchema.safeParse({
      targetType: 'LISTING',
      targetId: 'listing-example',
      reason: 'NUDITY_OR_SEXUAL_CONTENT',
      details: 'Explicit image in listing photos',
    }).success).toBe(true)
  })
})


describe('Mudaala confirmed violation warning threshold', () => {
  test('does not warn for the first three confirmed violations and warns on the fourth', () => {
    expect(shouldSendFormalPolicyWarning(1)).toBe(false)
    expect(shouldSendFormalPolicyWarning(2)).toBe(false)
    expect(shouldSendFormalPolicyWarning(3)).toBe(false)
    expect(shouldSendFormalPolicyWarning(4)).toBe(true)
    expect(shouldSendFormalPolicyWarning(5)).toBe(true)
    expect(shouldSendFormalPolicyWarning(3.5)).toBe(false)
  })
})

describe('Mudaala bug report and feedback validation', () => {
  const validFeedback = {
    category: 'BUG',
    title: 'Photo upload is stuck',
    description: 'The upload spinner keeps running and the listing is never saved.',
    pagePath: '/#/publish',
    contact: 'help@example.com',
  }

  test('accepts a complete feedback report with a safe local pathname', () => {
    expect(feedbackCreateSchema.safeParse(validFeedback).success).toBe(true)
  })

  test('rejects short descriptions and external or protocol-relative page URLs', () => {
    expect(feedbackCreateSchema.safeParse({ ...validFeedback, description: 'It broke' }).success).toBe(false)
    expect(feedbackCreateSchema.safeParse({ ...validFeedback, pagePath: 'https://evil.example/' }).success).toBe(false)
    expect(feedbackCreateSchema.safeParse({ ...validFeedback, pagePath: '//evil.example/' }).success).toBe(false)
  })


  test('requires a selected policy category for a confirmed violation', () => {
    expect(reportActionSchema.safeParse({ action: 'CONFIRM_VIOLATION' }).success).toBe(false)
    expect(reportActionSchema.safeParse({ action: 'CONFIRM_VIOLATION', policyCategory: 'NUDITY_OR_SEXUAL_CONTENT' }).success).toBe(true)
    expect(reportActionSchema.safeParse({ action: 'REVERSE_VIOLATION' }).success).toBe(true)
  })

  test('rejects oversized feedback payloads', () => {
    expect(feedbackCreateSchema.safeParse({ ...validFeedback, description: 'x'.repeat(3001) }).success).toBe(false)
  })
})
