import { describe, it, expect } from 'vitest'
import { Filter, Query, filterFactory, serializeOptions } from '../../src/query.js'

const BASE = 'https://fms.example.com/fmi/odata/v4/Invoices'

function q(entitySet = 'Customer'): Query {
  return new Query(BASE, entitySet)
}

/** Decode a Query's URL's querystring to make assertions readable. */
function decodedParams(url: string): Record<string, string> {
  const qs = url.split('?')[1] ?? ''
  const out: Record<string, string> = {}
  for (const part of qs.split('&').filter(Boolean)) {
    const eq = part.indexOf('=')
    const k = decodeURIComponent(part.slice(0, eq))
    const v = decodeURIComponent(part.slice(eq + 1))
    out[k] = v
  }
  return out
}

describe('Filter factory', () => {
  const f = filterFactory

  it('eq/ne/gt/ge/lt/le format correctly for strings and numbers', () => {
    expect(f.eq('city', 'Barcelona').expr).toBe("city eq 'Barcelona'")
    expect(f.ne('city', 'Girona').expr).toBe("city ne 'Girona'")
    expect(f.gt('balance', 0).expr).toBe('balance gt 0')
    expect(f.ge('balance', 100).expr).toBe('balance ge 100')
    expect(f.lt('balance', 50).expr).toBe('balance lt 50')
    expect(f.le('balance', 50).expr).toBe('balance le 50')
  })

  it('escapes single quotes in string literals', () => {
    expect(f.eq('name', "O'Brien").expr).toBe("name eq 'O''Brien'")
  })

  it('supports startswith / endswith / contains', () => {
    expect(f.startswith('name', 'A').expr).toBe("startswith(name,'A')")
    expect(f.endswith('name', 'Z').expr).toBe("endswith(name,'Z')")
    expect(f.contains('name', "O'B").expr).toBe("contains(name,'O''B')")
  })

  it('composes with and / or / not (factory form)', () => {
    const a = f.eq('city', 'Barcelona')
    const b = f.gt('balance', 0)
    expect(f.and(a, b).expr).toBe(
      "(city eq 'Barcelona') and (balance gt 0)",
    )
    expect(f.or(a, b).expr).toBe(
      "(city eq 'Barcelona') or (balance gt 0)",
    )
    expect(f.not(a).expr).toBe("not (city eq 'Barcelona')")
  })

  it('composes with chained .and / .or / .not on Filter', () => {
    const expr = f.eq('city', 'Barcelona').and(f.gt('balance', 0)).expr
    expect(expr).toBe("(city eq 'Barcelona') and (balance gt 0)")

    const expr2 = f.eq('a', 1).or('b eq 2').not().expr
    expect(expr2).toBe('not ((a eq 1) or (b eq 2))')
  })

  it('raw escape hatch embeds verbatim', () => {
    expect(f.raw("startswith(name,'A')").expr).toBe("startswith(name,'A')")
  })

  it('formats Date values as UTC ISO without milliseconds', () => {
    const d = new Date(Date.UTC(2026, 3, 17, 14, 45, 30, 999))
    expect(f.gt('createdAt', d).expr).toBe('createdAt gt 2026-04-17T14:45:30Z')
  })

  it('formats null and boolean correctly', () => {
    expect(f.eq('deletedAt', null).expr).toBe('deletedAt eq null')
    expect(f.eq('active', true).expr).toBe('active eq true')
  })
})

describe('Query builder - URL output', () => {
  it('emits just the entity set when no options are set', () => {
    expect(q('Customer').toURL()).toBe(`${BASE}/Customer`)
  })

  it('percent-encodes entity-set names with spaces', () => {
    expect(q('My Layout').toURL()).toBe(`${BASE}/My%20Layout`)
  })

  it('$select joins fields with commas (preserving case)', () => {
    const url = q().select('ID', 'Name').toURL()
    expect(decodedParams(url)).toEqual({ $select: 'ID,Name' })
  })

  it('$select preserves literal commas in URL (not %2C)', () => {
    // FileMaker Server rejects %2C encoding in $select
    const url = q().select('ID', 'Name', 'Age').toURL()
    expect(url).toContain('$select=ID,Name,Age')
    expect(url).not.toContain('%2C')
  })

  it('$select is cumulative across multiple calls', () => {
    const url = q().select('a').select('b', 'c').toURL()
    expect(decodedParams(url).$select).toBe('a,b,c')
  })

  it('$filter accepts a Filter instance', () => {
    const url = q().filter(filterFactory.eq('city', 'Barcelona')).toURL()
    expect(decodedParams(url).$filter).toBe("city eq 'Barcelona'")
  })

  it('$filter accepts a raw string', () => {
    const url = q().filter("balance gt 0").toURL()
    expect(decodedParams(url).$filter).toBe('balance gt 0')
  })

  it('$filter accepts a callback that receives the factory', () => {
    const url = q()
      .filter((f) => f.eq('city', 'Barcelona').and(f.gt('balance', 0)))
      .toURL()
    expect(decodedParams(url).$filter).toBe(
      "(city eq 'Barcelona') and (balance gt 0)",
    )
  })

  it('consecutive .filter() calls AND together', () => {
    const url = q()
      .filter("a eq 1")
      .filter("b eq 2")
      .toURL()
    expect(decodedParams(url).$filter).toBe('(a eq 1) and (b eq 2)')
  })

  it('.or() after .filter() ORs together', () => {
    const url = q()
      .filter("a eq 1")
      .or((_) => "b eq 2")
      .toURL()
    expect(decodedParams(url).$filter).toBe('(a eq 1) or (b eq 2)')
  })

  it('$orderby accepts multiple fields and defaults to asc', () => {
    const url = q().orderby('name').orderby('age', 'desc').toURL()
    expect(decodedParams(url).$orderby).toBe('name asc,age desc')
  })

  it('$orderby preserves literal commas in URL (not %2C)', () => {
    // FileMaker Server rejects %2C encoding in $orderby
    const url = q().orderby('name').orderby('age', 'desc').toURL()
    expect(url).toContain('$orderby=name%20asc,age%20desc')
    expect(url).not.toContain('%2C')
  })

  it('$top, $skip, and $count can be combined', () => {
    const url = q().top(50).skip(10).count().toURL()
    const p = decodedParams(url)
    expect(p.$top).toBe('50')
    expect(p.$skip).toBe('10')
    expect(p.$count).toBe('true')
  })

  it('.count(false) omits $count', () => {
    const url = q().count(false).toURL()
    expect(url).toBe(`${BASE}/Customer`)
  })

  it('rejects negative / non-integer $top and $skip', () => {
    expect(() => q().top(-1)).toThrow(/non-negative/)
    expect(() => q().top(1.5)).toThrow(/non-negative/)
    expect(() => q().skip(-1)).toThrow(/non-negative/)
  })

  it('$search is included verbatim (percent-encoded in URL)', () => {
    const url = q().search('hello world').toURL()
    expect(decodedParams(url).$search).toBe('hello world')
  })

  it('$expand without nested options emits just the navigation name', () => {
    const url = q().expand('Orders').toURL()
    expect(decodedParams(url).$expand).toBe('Orders')
  })

  it('$expand with nested options emits ;-separated option block', () => {
    const url = q()
      .expand('Orders', (nested) =>
        nested.select('id', 'total').top(5),
      )
      .toURL()
    expect(decodedParams(url).$expand).toBe('Orders($select=id,total;$top=5)')
  })

  it('$expand preserves literal commas in nested $select (not %2C)', () => {
    // FileMaker Server rejects %2C encoding in $expand nested options
    const url = q()
      .expand('Orders', (nested) => nested.select('id', 'total'))
      .toURL()
    expect(url).toContain('$expand=Orders($select=id,total')
    expect(url).not.toContain('%2C')
  })

  it('$expand supports multiple navigation properties (comma-joined)', () => {
    const url = q()
      .expand('Orders')
      .expand('Contacts', (n) => n.select('email'))
      .toURL()
    expect(decodedParams(url).$expand).toBe(
      'Orders,Contacts($select=email)',
    )
  })

  it('composes a full query matching the plan example', () => {
    const url = q()
      .select('id', 'name')
      .filter((f) => f.eq('city', 'Barcelona').and(f.gt('balance', 0)))
      .or((_) => "startswith(name,'A')")
      .expand('Orders', (n) => n.select('id', 'total').top(5))
      .orderby('name', 'desc')
      .top(50)
      .skip(0)
      .count()
      .toURL()

    const p = decodedParams(url)
    expect(p).toEqual({
      $select: 'id,name',
      $filter: "((city eq 'Barcelona') and (balance gt 0)) or (startswith(name,'A'))",
      $expand: 'Orders($select=id,total;$top=5)',
      $orderby: 'name desc',
      $top: '50',
      $skip: '0',
      $count: 'true',
    })

    // Raw URL must percent-encode special chars, not use `+` for spaces.
    expect(url).not.toContain('+')
    expect(url).toContain('%20')
  })
})

describe('serializeOptions (internal)', () => {
  it('returns empty string when no options are set', () => {
    expect(serializeOptions({}, { topLevel: true })).toBe('')
    expect(serializeOptions({}, { topLevel: false })).toBe('')
  })

  it('nested mode uses `;` separators without URL-encoding', () => {
    const out = serializeOptions(
      { select: ['id', 'total'], top: 5 },
      { topLevel: false },
    )
    expect(out).toBe('$select=id,total;$top=5')
  })

  it('top-level mode percent-encodes values', () => {
    const out = serializeOptions(
      { filter: "name eq 'Joe'" },
      { topLevel: true },
    )
    expect(out).toBe("$filter=name%20eq%20'Joe'")
  })
})

describe('Filter class directly', () => {
  it('toString returns the underlying expression', () => {
    expect(String(new Filter('a eq 1'))).toBe('a eq 1')
  })

  it('coerces string input in .and / .or', () => {
    expect(new Filter('a eq 1').and('b eq 2').expr).toBe('(a eq 1) and (b eq 2)')
    expect(new Filter('a eq 1').or('b eq 2').expr).toBe('(a eq 1) or (b eq 2)')
  })
})
