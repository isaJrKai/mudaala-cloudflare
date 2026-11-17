// One call from "products + settings" to everything a renderer needs.
// Used by the public page AND the merchant preview, so what the merchant
// previews is exactly what customers get.

import { orderProducts, planSections } from './plan'
import { selectComposition } from './select'
import type { PlannedSection, Selection, ShowroomProduct, ShowroomPurpose } from './types'

export interface ShowroomViewModel {
  selection: Selection
  ordered: ShowroomProduct[]
  sections: PlannedSection[]
}

export function buildShowroomView(input: {
  products: ShowroomProduct[]
  highlights: string[]
  purpose: ShowroomPurpose
  merchantCategory: string | null
  seed: string
  styleKey?: string | null
}): ShowroomViewModel {
  const ordered = orderProducts(input.products, input.highlights, input.purpose)
  const selection = selectComposition({
    products: ordered,
    merchantCategory: input.merchantCategory,
    purpose: input.purpose,
    seed: input.seed,
    styleKey: input.styleKey,
  })
  return { selection, ordered, sections: planSections(selection.composition, ordered) }
}
