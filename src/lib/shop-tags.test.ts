// Bun executes this test file in CI; Bun's ambient test types are not part of the Next.js TypeScript build.
// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { composeReportDetails, reportDetailsRoom, REPORT_DETAILS_MAX } from './report-details'
import { buildTagUrl, createTagSchema, generateTagCode, normalizeTagCode, tagTapSchema, updateTagSchema } from './shop-tags'

describe('generateTagCode', () => {
  it('makes 10-character codes that pass normalizeTagCode', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateTagCode()
      expect(code).toHaveLength(10)
      expect(normalizeTagCode(code)).toBe(code)
    }
  })

  it('never uses look-alike characters', () => {
    const all = Array.from({ length: 300 }, generateTagCode).join('')
    expect(all).not.toMatch(/[01ilo]/)
  })

  it('does not repeat across a large sample', () => {
    const codes = new Set(Array.from({ length: 2000 }, generateTagCode))
    expect(codes.size).toBe(2000)
  })
})

describe('normalizeTagCode', () => {
  it('trims and lowercases a valid code', () => {
    expect(normalizeTagCode('  K7M2QX9P4A ')).toBe('k7m2qx9p4a')
  })

  it('rejects wrong length, ambiguous characters and punctuation', () => {
    for (const bad of ['', 'short', 'k7m2qx9p4ab', 'k7m2qx9p4o', 'k7m2qx9p41', 'k7m2-x9p4a', "k7m2qx9p4a'; --", '../../etc/x']) {
      expect(normalizeTagCode(bad)).toBeNull()
    }
  })

  it('rejects non-strings', () => {
    for (const bad of [undefined, null, 42, {}, ['k7m2qx9p4a']]) expect(normalizeTagCode(bad)).toBeNull()
  })
})

describe('buildTagUrl', () => {
  it('builds the NFC link on the shop page', () => {
    expect(buildTagUrl('https://mudaala.example', 'MD-4821', 'k7m2qx9p4a')).toBe('https://mudaala.example/s/MD-4821?t=k7m2qx9p4a')
  })

  it('marks the QR twin so scans and taps are counted separately', () => {
    expect(buildTagUrl('https://mudaala.example/', 'MD-4821', 'k7m2qx9p4a', 'qr')).toBe('https://mudaala.example/s/MD-4821?t=k7m2qx9p4a&v=qr')
  })
})

describe('schemas', () => {
  it('requires a short readable label', () => {
    expect(createTagSchema.safeParse({ label: ' Hostel A door ' }).data.label).toBe('Hostel A door')
    expect(createTagSchema.safeParse({ label: 'A' }).success).toBe(false)
    expect(createTagSchema.safeParse({ label: 'x'.repeat(41) }).success).toBe(false)
  })

  it('accepts one change at a time and rejects an empty update', () => {
    expect(updateTagSchema.safeParse({ status: 'DISABLED' }).success).toBe(true)
    expect(updateTagSchema.safeParse({ rotate: true }).success).toBe(true)
    expect(updateTagSchema.safeParse({ locked: true }).success).toBe(true)
    expect(updateTagSchema.safeParse({}).success).toBe(false)
    expect(updateTagSchema.safeParse({ status: 'DELETED' }).success).toBe(false)
    expect(updateTagSchema.safeParse({ rotate: false }).success).toBe(false)
  })

  it('limits the tap beacon payload', () => {
    expect(tagTapSchema.safeParse({ t: 'k7m2qx9p4a', v: 'qr' }).success).toBe(true)
    expect(tagTapSchema.safeParse({ t: 'x'.repeat(41) }).success).toBe(false)
    expect(tagTapSchema.safeParse({ t: 'k7m2qx9p4a', v: 'sms' }).success).toBe(false)
  })
})

describe('composeReportDetails', () => {
  const note = '[Reported from a tap-to-shop tag]'

  it('passes plain details through and returns null when empty', () => {
    expect(composeReportDetails('  fake sticker  ')).toBe('fake sticker')
    expect(composeReportDetails('   ')).toBeNull()
  })

  it('puts the context note first and keeps it when the reporter writes nothing', () => {
    expect(composeReportDetails('sticker was covered', note)).toBe(`${note} sticker was covered`)
    expect(composeReportDetails('', note)).toBe(note)
  })

  it('never exceeds the 500-character API cap, trimming the reporter text not the note', () => {
    const out = composeReportDetails('x'.repeat(900), note)
    expect(out.length).toBe(REPORT_DETAILS_MAX)
    expect(out.startsWith(note)).toBe(true)
    expect(reportDetailsRoom(note)).toBe(REPORT_DETAILS_MAX - note.length - 1)
  })
})
