import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SHOWROOM_TEMPLATES, getShowroomTemplate } from './templates.ts'

describe('standalone showroom template catalogue', () => {
  it('contains exactly twenty selectable templates with unique stable ids', () => {
    assert.equal(SHOWROOM_TEMPLATES.length, 20)
    assert.equal(new Set(SHOWROOM_TEMPLATES.map((template) => template.id)).size, 20)
    for (const template of SHOWROOM_TEMPLATES) {
      assert.equal(getShowroomTemplate(template.id), template)
      assert.equal(template.version, 1)
    }
  })

  it('defines a complete art direction and information architecture for every template', () => {
    for (const template of SHOWROOM_TEMPLATES) {
      assert.ok(template.promise.length > 12)
      assert.ok(template.artDirection.length > 30)
      assert.ok(template.hero)
      assert.ok(template.productLayout)
      assert.ok(template.navigation)
      assert.ok(template.imageTreatment)
      assert.ok(template.surface)
      assert.ok(template.accent)
    }
  })

  it('does not repeat the same layout recipe across the catalogue', () => {
    const signatures = new Set(SHOWROOM_TEMPLATES.map((template) =>
      [template.hero, template.productLayout, template.navigation, template.imageTreatment, template.surface, template.accent].join('|'),
    ))
    assert.ok(signatures.size >= 16)
  })
})
