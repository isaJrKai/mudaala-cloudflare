/**
 * FNV-1a 32-bit. Stable across runtimes (Workers, Node, Bun) and releases:
 * the only source of "variety" in the engine, always keyed by the showroom's
 * slug, so a showroom never changes look between visits.
 */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}
