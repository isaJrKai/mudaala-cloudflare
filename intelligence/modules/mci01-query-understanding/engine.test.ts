/**
 * MCI-01 engine tests — deterministic behaviour, price grammar, honesty.
 */
import { describe, expect, test } from 'bun:test'
import { MCI01Result } from '../../contracts/modules/mci01'
import { MCI01_ENGINE_VERSION, normalizeText, parsePriceGrammar, parseUgxAmount, understandQuery } from './engine'
import { CONCEPT_PACK_VERSION } from './concepts'

function run(query: string) {
  return understandQuery({ query })
}

describe('MCI-01 normalisation and tokens', () => {
  test('preserves the original query byte-for-byte (registry guardrail)', () => {
    const query = 'Kitenge  Dresses under 50k!!'
    const result = run(query)
    expect(result.original_query).toBe(query)
    expect(MCI01Result.safeParse(result).success).toBe(true)
  })

  test('unicode-safe normalisation (mirrors commerce unicode-search fixes)', () => {
    expect(normalizeText('Café NAINs')).toBe('cafe nains')
    expect(normalizeText('Matoooke & Guavas')).toBe('matoooke guavas')
  })

  test('stop words are dropped, informative tokens kept', () => {
    const result = run('I am looking for a good iPhone under 1.5m please')
    expect(result.tokens).toContain('iphone')
    expect(result.tokens).not.toContain('please')
    expect(result.tokens).not.toContain('good')
  })
})

describe('MCI-01 UGX price grammar', () => {
  test('k/m/million/thousand suffixes parse to UGX integers', () => {
    expect(parseUgxAmount('20k')).toBe(20_000)
    expect(parseUgxAmount('1.5m')).toBe(1_500_000)
    expect(parseUgxAmount('2 million')).toBe(2_000_000)
    expect(parseUgxAmount('50 thousand')).toBe(50_000)
    expect(parseUgxAmount('20,000')).toBe(20_000)
    expect(parseUgxAmount('0')).toBeNull()
    expect(parseUgxAmount('2b')).toBeNull()
  })

  test('range grammar: between 20k and 40k', () => {
    const g = parsePriceGrammar('phones between 20k and 40k')
    expect(g.min).toBe(20_000)
    expect(g.max).toBe(40_000)
  })

  test('from X to Y', () => {
    const g = parsePriceGrammar('sofa from 300,000 to 500,000')
    expect(g.min).toBe(300_000)
    expect(g.max).toBe(500_000)
  })

  test('under/less-than sets max only', () => {
    const g = parsePriceGrammar('under ugx 50k')
    expect(g.min).toBeNull()
    expect(g.max).toBe(50_000)
  })

  test('over/above sets min only', () => {
    const g = parsePriceGrammar('land above 20m in Wakiso')
    expect(g.min).toBe(20_000_000)
    expect(g.max).toBeNull()
  })

  test('price expressions are removed from retrieval tokens', () => {
    const under = run('iPhone under 1m')
    expect(under.price_filter?.max).toBe(1_000_000)
    expect(under.tokens).toEqual(['iphone'])

    const range = run('sofa between 300k and 500k')
    expect(range.price_filter?.min).toBe(300_000)
    expect(range.price_filter?.max).toBe(500_000)
    expect(range.tokens).toEqual(['sofa'])
  })

  test('bare amount becomes an upper bound with an explicit note', () => {
    const result = run('iphone 20k')
    expect(result.price_filter?.max).toBe(20_000)
    expect(result.price_filter?.min).toBeNull()
    expect(result.ambiguity.notes.join(' ')).toContain('upper bound')
  })

  test('non-UGX currencies are skipped honestly, not guessed', () => {
    const g = parsePriceGrammar('laptop $500')
    expect(g.min).toBeNull()
    expect(g.max).toBeNull()
    expect(g.notes.join(' ')).toContain('non-UGX')
  })
})

describe('MCI-01 category hints and intent', () => {
  test('concept pack maps everyday words to taxonomy ids', () => {
    const result = run('kitenge dresses')
    expect(result.category_hints.map((h) => h.category_id)).toContain('textiles-clothing')
    expect(result.category_hints.map((h) => h.category_id)).toContain('fashion-dresses')
    expect(result.intent).toBe('SEARCH')
  })

  test('request intent detected from buyer language', () => {
    expect(run('looking for a Toyota Premio').offer_request).toBe('REQUEST')
    expect(run('anyone selling fridge here').offer_request).toBe('REQUEST')
    expect(run('brand new stove for sale').offer_request).toBe('OFFER')
  })

  test('conflicting intent markers left unset with a note', () => {
    const result = run('selling stove, looking for a buyer')
    expect(result.offer_request).toBeNull()
    expect(result.ambiguity.notes.join(' ')).toContain('offer and request markers')
  })

  test('sort preference detection', () => {
    expect(run('cheapest rice 25kg').sort_preference).toBe('PRICE_ASC')
    expect(run('newest smartphones in Kampala').sort_preference).toBe('FRESHNESS')
    expect(run('kitenge dresses').sort_preference).toBeNull()
  })

  test('unknown language is a valid, explicit value', () => {
    const result = run('xyzzy plugh')
    expect(result.language_hints).toEqual(['unknown'])
    expect(result.ambiguity.level).not.toBe('LOW')
  })

  test('empty informative content degrades honestly to HIGH ambiguity', () => {
    const result = run('the for and')
    expect(result.ambiguity.level).toBe('HIGH')
    expect(result.intent).toBe('UNKNOWN')
    expect(result.tokens.length).toBe(0)
  })
})

describe('MCI-01 versioning', () => {
  test('engine version is stable and semantically named', () => {
    expect(MCI01_ENGINE_VERSION).toMatch(/^mci01-query-understanding-v0\.3\.0$/)
    expect(CONCEPT_PACK_VERSION).toMatch(/^mci01\.concepts\.v/)
  })

  test('deterministic: same input → identical output', () => {
    const a = run('kitenge dresses under 50k in Kampala')
    const b = run('kitenge dresses under 50k in Kampala')
    expect(a).toEqual(b)
  })
})
