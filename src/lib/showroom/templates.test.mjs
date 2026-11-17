import { describe, expect, test } from 'bun:test'
import { SHOWROOM_TEMPLATES, getShowroomTemplate } from './templates.ts'

describe('standalone showroom template catalogue', () => {
  test('contains exactly twenty selectable templates with unique stable ids', () => {
    expect(SHOWROOM_TEMPLATES).toHaveLength(20)
    expect(new Set(SHOWROOM_TEMPLATES.map((template) => template.id)).size).toBe(20)
    for (const template of SHOWROOM_TEMPLATES) {
      expect(getShowroomTemplate(template.id)).toBe(template)
      expect(template.version).toBe(1)
    }
  })

  test('defines a complete art direction and information architecture for every template', () => {
    for (const template of SHOWROOM_TEMPLATES) {
      expect(template.promise.length).toBeGreaterThan(12)
      expect(template.artDirection.length).toBeGreaterThan(30)
      expect(template.hero).toBeTruthy()
      expect(template.productLayout).toBeTruthy()
      expect(template.navigation).toBeTruthy()
      expect(template.imageTreatment).toBeTruthy()
      expect(template.surface).toBeTruthy()
      expect(template.accent).toBeTruthy()
    }
  })

  test('does not repeat the same layout recipe across the catalogue', () => {
    const signatures = new Set(SHOWROOM_TEMPLATES.map((template) =>
      [template.hero, template.productLayout, template.navigation, template.imageTreatment, template.surface, template.accent].join('|'),
    ))
    expect(signatures.size).toBeGreaterThanOrEqual(16)
  })
})
