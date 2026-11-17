import { PRODUCT_TAXONOMY, taxonomyAncestors } from '@/lib/product-taxonomy'

export function resolveTelegramTaxonomyPath(value: string) {
  const normalized = value.split('>').map((part) => part.trim().toLocaleLowerCase()).join(' > ')
  return PRODUCT_TAXONOMY.find((node) =>
    taxonomyAncestors(node.id).map((ancestor) => ancestor.label.toLocaleLowerCase()).join(' > ') === normalized,
  )
}

export function parseTelegramAttributes(value: string, taxonomyId: string | undefined): Record<string, string | number | boolean> | undefined {
  if (!value.trim() || !taxonomyId) return undefined
  const node = PRODUCT_TAXONOMY.find((item) => item.id === taxonomyId)
  const definitions = new Map((node?.attributes ?? []).map((item) => [item.key, item]))
  const output: Record<string, string | number | boolean> = {}
  for (const entry of value.split(';')) {
    const separator = entry.indexOf('=')
    if (separator < 1) continue
    const key = entry.slice(0, separator).trim()
    const raw = entry.slice(separator + 1).trim()
    const definition = definitions.get(key)
    if (!definition || !raw) continue
    if (definition.type === 'number') {
      const number = Number(raw)
      if (Number.isFinite(number)) output[key] = number
    } else if (definition.type === 'boolean') {
      if (/^(true|yes)$/i.test(raw)) output[key] = true
      else if (/^(false|no)$/i.test(raw)) output[key] = false
    } else {
      const option = definition.type === 'enum'
        ? definition.options?.find((item) => item.toLowerCase() === raw.toLowerCase())
        : raw
      if (option) output[key] = option
    }
  }
  return Object.keys(output).length ? output : undefined
}
