import { describe, expect, it } from 'bun:test'
import { merchantKnowledgeAnswer } from './telegram-merchant-kb'

describe('Telegram merchant knowledge routing', () => {
  it('answers known merchant questions without invoking the AI fallback', () => {
    const answer = merchantKnowledgeAnswer('Show my products')
    expect(answer).toBeTruthy()
    expect(answer).toContain('/products')
  })

  it('returns verified partial guidance for supported but incomplete workflows', () => {
    const answer = merchantKnowledgeAnswer('How do I upload products?')
    expect(answer).toBeTruthy()
    expect(answer).toContain('Note:')
  })

  it('returns a safe unsupported response rather than inventing unverified fees', () => {
    const answer = merchantKnowledgeAnswer('Are there fees?')
    expect(answer).toBeTruthy()
    expect(answer).not.toMatch(/\bfree\b|\d+%|UGX/i)
  })

  it('returns null for unrelated messages so the existing AI fallback can handle them', () => {
    expect(merchantKnowledgeAnswer('what is the weather in kampala')).toBeNull()
    expect(merchantKnowledgeAnswer('')).toBeNull()
  })
})
