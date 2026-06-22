import { describe, expect, it, vi } from 'vitest'
import { FMOData } from '../../src/client.js'
import { EntityRef } from '../../src/entity.js'
import type { FMODataOptions } from '../../src/types.js'

const BASE = 'https://fms.example.com/fmi/odata/v4/Invoices'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function makeClient(fetch: ReturnType<typeof vi.fn>, overrides: Partial<FMODataOptions> = {}): FMOData {
  return new FMOData({
    host: 'https://fms.example.com',
    database: 'Invoices',
    token: 'abc',
    fetch: fetch as unknown as typeof globalThis.fetch,
    ...overrides,
  })
}

describe('EntityRef URL building', () => {
  it('formats numeric keys without quotes', () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    expect(db.from('contact').byKey(123).toURL()).toBe(`${BASE}/contact(123)`)
  })

  it('formats string keys with single quotes and escapes inner quotes', () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    expect(db.from('contact').byKey("O'B-1").toURL()).toBe(`${BASE}/contact('O''B-1')`)
  })

  it('percent-encodes entity-set names with spaces', () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    expect(db.from('My Layout').byKey(5).toURL()).toBe(`${BASE}/My%20Layout(5)`)
  })

  it('rejects non-finite numeric keys', () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    // Direct construction bypasses Query typing to exercise the guard
    const ref = new EntityRef(db, 'contact', Number.NaN)
    expect(() => ref.toURL()).toThrow(/finite/)
  })
})

describe('EntityRef.get', () => {
  it('issues GET to the entity URL and returns the parsed row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 7, name: 'Alice' }))
    const db = makeClient(fetchMock)
    const row = await db.from<{ id: number; name: string }>('contact').byKey(7).get()
    expect(row).toEqual({ id: 7, name: 'Alice' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact(7)`)
    expect((init as RequestInit).method).toBe('GET')
  })
})

describe('EntityRef.fieldValue', () => {
  it('GETs the field property URL and unwraps { value: … }', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ value: 'Alice' }))
    const db = makeClient(fetchMock)
    const v = await db.from('contact').byKey(7).fieldValue<string>('first_name')
    expect(v).toBe('Alice')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact(7)/first_name`)
    expect((init as RequestInit).method).toBe('GET')
  })

  it('percent-encodes field names with spaces', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ value: 42 }))
    const db = makeClient(fetchMock)
    const v = await db.from('contact').byKey(7).fieldValue<number>('Total Hours')
    expect(v).toBe(42)
    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact(7)/Total%20Hours`)
  })

  it('returns null when the value is null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ value: null }))
    const db = makeClient(fetchMock)
    const v = await db.from('contact').byKey(7).fieldValue<string | null>('middle_name')
    expect(v).toBeNull()
  })
})

describe('EntityRef.patch', () => {
  it('sends PATCH with JSON body and Prefer: return=minimal by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    const result = await db.from<{ id: number; city: string }>('contact').byKey(7).patch({ city: 'Girona' })
    expect(result).toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact(7)`)
    expect((init as RequestInit).method).toBe('PATCH')
    expect((init as RequestInit).body).toBe(JSON.stringify({ city: 'Girona' }))
    const headers = (init as RequestInit).headers as Headers
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('prefer')).toBe('return=minimal')
  })

  it('asks for representation when returnRepresentation is true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 7, city: 'Girona' }))
    const db = makeClient(fetchMock)
    const updated = await db
      .from<{ id: number; city: string }>('contact')
      .byKey(7)
      .patch({ city: 'Girona' }, { returnRepresentation: true })
    expect(updated).toEqual({ id: 7, city: 'Girona' })
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Headers
    expect(headers.get('prefer')).toBe('return=representation')
  })

  it('forwards If-Match when supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    await db
      .from('contact')
      .byKey(7)
      .patch({ x: 1 }, { ifMatch: 'W/"etag-1"' })
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Headers
    expect(headers.get('if-match')).toBe('W/"etag-1"')
  })
})

describe('EntityRef.delete', () => {
  it('issues DELETE and resolves on 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    await db.from('contact').byKey(7).delete()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact(7)`)
    expect((init as RequestInit).method).toBe('DELETE')
  })

  it('forwards If-Match on delete', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    await db.from('contact').byKey(7).delete({ ifMatch: 'W/"etag-9"' })
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Headers
    expect(headers.get('if-match')).toBe('W/"etag-9"')
  })
})

describe('Query.create', () => {
  it('POSTs the body and returns the echoed row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 99, name: 'Acme' }))
    const db = makeClient(fetchMock)
    const row = await db.from<{ id: number; name: string }>('contact').create({ name: 'Acme' })
    expect(row).toEqual({ id: 99, name: 'Acme' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact`)
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).body).toBe(JSON.stringify({ name: 'Acme' }))
  })
})

describe('Query.get', () => {
  it('returns { value, count, nextLink } from the OData envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        value: [{ id: 1 }, { id: 2 }],
        '@odata.count': 17,
        '@odata.nextLink': 'https://fms.example.com/next',
      }),
    )
    const db = makeClient(fetchMock)
    const result = await db.from('contact').top(2).count().get()
    expect(result.value).toHaveLength(2)
    expect(result.count).toBe(17)
    expect(result.nextLink).toBe('https://fms.example.com/next')
  })

  it('defaults to an empty value array when the server omits it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    const db = makeClient(fetchMock)
    const result = await db.from('contact').get()
    expect(result.value).toEqual([])
    expect(result.count).toBeUndefined()
    expect(result.nextLink).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Record references ($ref) — Phase 3
// ---------------------------------------------------------------------------

describe('EntityRef $ref operations', () => {
  it('getRefs returns array from collection navigation property', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        value: [
          { '@odata.id': `${BASE}/address(1)` },
          { '@odata.id': `${BASE}/address(2)` },
        ],
      }),
    )
    const db = makeClient(fetchMock)
    const refs = await db.from('contact').byKey(7).getRefs('addresses')

    expect(refs).toHaveLength(2)
    expect(refs[0]!['@odata.id']).toBe(`${BASE}/address(1)`)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact(7)/addresses/$ref`)
    expect((init as RequestInit).method).toBe('GET')
  })

  it('getRefs returns single-element array for single-valued nav property', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ '@odata.id': `${BASE}/customer(7)` }),
    )
    const db = makeClient(fetchMock)
    const refs = await db.from('order').byKey(100).getRefs('customer')

    expect(refs).toHaveLength(1)
    expect(refs[0]!['@odata.id']).toBe(`${BASE}/customer(7)`)
  })

  it('getRefs returns empty array when no references exist', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    const db = makeClient(fetchMock)
    const refs = await db.from('contact').byKey(7).getRefs('addresses')
    expect(refs).toEqual([])
  })

  it('addRef POSTs to $ref with @odata.id body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    await db.from('contact').byKey(7).addRef('addresses', 42)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact(7)/addresses/$ref`)
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      '@odata.id': 'addresses(42)',
    })
  })

  it('addRef escapes string keys in @odata.id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    await db.from('contact').byKey(7).addRef('tags', "O'Brien")

    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      '@odata.id': "tags('O''Brien')",
    })
  })

  it('setRef PATCHes $ref with @odata.id body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    await db.from('order').byKey(100).setRef('customer', 7)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/order(100)/customer/$ref`)
    expect((init as RequestInit).method).toBe('PATCH')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      '@odata.id': 'customer(7)',
    })
  })

  it('removeRef DELETEs $ref without relatedKey (single-valued)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    await db.from('order').byKey(100).removeRef('customer')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/order(100)/customer/$ref`)
    expect((init as RequestInit).method).toBe('DELETE')
  })

  it('removeRef DELETEs specific $ref with relatedKey (collection)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    await db.from('contact').byKey(7).removeRef('addresses', 42)

    const [url, init] = fetchMock.mock.calls[0]!
    expect((init as RequestInit).method).toBe('DELETE')
    // URL includes the reference ID
    expect(url).toContain('$ref')
  })

  it('forwards AbortSignal on $ref operations', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      if (init.signal?.aborted) {
        return Promise.reject(new DOMException('aborted', 'AbortError'))
      }
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        )
      })
    })
    const db = makeClient(fetchMock)
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(
      db.from('contact').byKey(7).getRefs('addresses', { signal: ctrl.signal }),
    ).rejects.toThrow(/abort/i)
  })
})
