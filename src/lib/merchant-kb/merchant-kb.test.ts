import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ALL_ENTRIES, gapReport, merchantKb, renderReply } from './index.ts'

const all = merchantKb({ serveStatuses: ['live', 'partial', 'unverified', 'planned'] })
const prod = merchantKb()
const idOf = (r: any) => r.entry?.id ?? r.candidates?.map((c: any) => c.id)

describe('data integrity', () => {
  it('ids unique; each entry has phrasings, answer, source', () => {
    const ids = ALL_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of ALL_ENTRIES) { expect(e.questions.length).toBeGreaterThanOrEqual(3); expect(e.answer.length).toBeGreaterThan(10); expect(e.source).toBeTruthy() }
  })
  it('covers all 12 topics', () => expect(new Set(ALL_ENTRIES.map((e) => e.topic)).size).toBe(12))
  it('partial entries carry a statusNote or a needs gap', () => {
    for (const e of ALL_ENTRIES.filter((e) => e.status === 'partial')) expect(Boolean(e.statusNote || e.needs)).toBe(true)
  })
  it('every command action exists in the real webhook route', () => {
    const route = readFileSync(new URL('../../app/api/telegram/webhook/route.ts', import.meta.url), 'utf8')
    for (const e of ALL_ENTRIES) if (e.action?.kind === 'command') expect(route).toContain(`'${e.action.value}'`)
  })
  it('no served answer claims payments are confirmed or sales are guaranteed', () => {
    for (const e of ALL_ENTRIES.filter((e) => e.status !== 'unverified')) expect(/has paid you|payment (is )?confirmed by mudaala/i.test(e.answer)).toBe(false)
  })
})

describe('exact + alternative phrasing', () => {
  it.each([
    ['What is a MU-CODE?', 'identity.mucode'],
    ['Show my products', 'products.list'],
    ['How do I reply to customers?', 'enquiries.reply'],
    ['How do I get my shop link?', 'shop.preview'],
    ['whats my mu code', 'identity.mucode'],
    ['my link code does not work', 'registration.code-expired'],
    ['why did my listing expire', 'products.expiry'],
    ['i want to change the price of my handbag', 'products.change-price'],
    ['mark handbag as sold out', 'products.soldout'],
    ['photo too big', 'photos.limit'],
    ['how many people looked at my shop', 'analytics.summary'],
    ['is a view a sale', 'analytics.meaning'],
    ['disconnect telegram', 'account.unlink'],
    ['did the customer pay', 'enquiries.payment'],
  ])('%s -> %s', (q, id) => expect(idOf(all.match(q))).toBe(id))
})

describe('verified controls', () => {
  it('delete warns it is permanent and points to pause', () => {
    const t = renderReply(prod.match('How do I delete a product?')).text
    expect(t).toMatch(/permanent/); expect(t).toMatch(/pause/)
  })
  it('pause explains restore and moderation limit', () => {
    expect(renderReply(prod.match('How do I hide a product?')).text).toMatch(/cannot restore/)
  })
  it('QR answer gives the real path', () => expect(renderReply(prod.match('How do I get my shop QR code?')).text).toMatch(/Show poster and print/))
})

describe('actions', () => {
  it('returns the existing command to run', () => {
    expect(renderReply(prod.match('Show my products')).action).toEqual({ kind: 'command', value: '/products' })
    expect(renderReply(prod.match('How do I get my shop link?')).action).toEqual({ kind: 'command', value: '/publicshop' })
  })
  it('points to the Mini App for management tasks', () => {
    expect(renderReply(prod.match('How do I upload products?')).action).toEqual({ kind: 'miniapp' })
  })
})

describe('honesty about unbuilt features', () => {
  it('partial answers carry their note', () => {
    const t = renderReply(prod.match('How do I upload products?')).text
    expect(t).toContain('open Products')
    expect(t).toContain('Note:')
  })
  it('unverified entries are never served in production mode', () => {
    for (const q of ['Do I pay to use Mudaala?', 'Are there fees?', 'Can customers negotiate the price?']) {
      expect(prod.match(q).kind === 'answer').toBe(false)
    }
  })
  it('fees are never guessed', () => expect(renderReply(prod.match('Are there fees?')).text).not.toMatch(/free|\d+%|UGX/i))
  it('never claims a payment', () => expect(renderReply(prod.match('Did the customer pay?')).text).toMatch(/does not collect or confirm payments/))
})

describe('fallback and ambiguity', () => {
  it.each(['what is the weather in kampala', 'hello', 'asdf qwerty', ''])('%j goes to AI', (q) => {
    const r = all.match(q)
    expect(r.kind).toBe('no_match')
    expect(renderReply(r).useAI).toBe(true)
  })
  it('known questions never need AI', () => expect(renderReply(prod.match('How do I link my account?')).useAI).toBe(false))
  it('vague input does not return a confident wrong answer', () => expect(['ambiguous', 'no_match']).toContain(all.match('change my shop').kind))
})

describe('gap report', () => {
  it('lists non-live entries', () => expect(gapReport(ALL_ENTRIES).length).toBe(ALL_ENTRIES.filter((e) => e.status !== 'live').length))
})
