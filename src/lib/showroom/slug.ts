import { stableHash } from './hash'

/** URL slug: lowercase ascii words joined by single hyphens, 3-60 chars. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return base.length >= 3 ? base : base ? `${base}-showroom`.slice(0, 60) : 'showroom'
}

/**
 * Deterministic candidate sequence for collision handling:
 * base, base-2 ... base-5, then base-<4 char hash> variants. The unique index
 * is the real arbiter; this only decides what to try next.
 */
export function slugCandidate(base: string, attempt: number): string {
  if (attempt === 0) return base
  if (attempt <= 4) return `${base}-${attempt + 1}`
  const suffix = stableHash(`${base}:${attempt}`).toString(36).slice(0, 4).padStart(4, '0')
  return `${base.slice(0, 74)}-${suffix}`
}

export const MAX_SLUG_ATTEMPTS = 10
