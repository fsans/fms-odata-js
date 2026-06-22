import { describe, expect, it, vi } from 'vitest'
import { FMOData } from '../../src/client.js'
import { FMODataError, FMScriptError } from '../../src/errors.js'
import type { FMODataOptions } from '../../src/types.js'

const BASE = 'https://fms.example.com/fmi/odata/v4/Invoices'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function makeClient(
  fetchMock: ReturnType<typeof vi.fn>,
  overrides: Partial<FMODataOptions> = {},
): FMOData {
  return new FMOData({
    host: 'https://fms.example.com',
    database: 'Invoices',
    token: 'abc',
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    ...overrides,
  })
}

describe('FMOData#script (database scope)', () => {
  it('POSTs to /<db>/Script.<name> with no body when parameter is omitted', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ scriptResult: 'pong', scriptError: '0' }))
    const db = makeClient(fetchMock)

    const result = await db.script('Ping')

    expect(result.scriptResult).toBe('pong')
    expect(result.scriptError).toBe('0')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/Script.Ping`)
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).body).toBeUndefined()
    const headers = (init as RequestInit).headers as Headers
    expect(headers.has('content-type')).toBe(false)
  })

  it('sends { scriptParameter } as JSON when parameter is provided', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ scriptResult: 'pong:hi', scriptError: '0' }))
    const db = makeClient(fetchMock)

    await db.script('Ping', { parameter: 'hi' })

    const [, init] = fetchMock.mock.calls[0]!
    expect((init as RequestInit).body).toBe(JSON.stringify({ scriptParameter: 'hi' }))
    const headers = (init as RequestInit).headers as Headers
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('percent-encodes the script name segment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ scriptResult: '', scriptError: '0' }))
    const db = makeClient(fetchMock)

    await db.script('My Script')

    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/Script.My%20Script`)
  })

  it('rejects empty script names', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    await expect(db.script('')).rejects.toThrow(/name is required/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Query#script (entity-set scope)', () => {
  it('POSTs to /<db>/<EntitySet>/Script.<name>', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ scriptResult: 'ok', scriptError: '0' }))
    const db = makeClient(fetchMock)

    await db.from('contact').script('RefreshCache')

    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact/Script.RefreshCache`)
  })

  it('ignores filter/select/orderby state on the query', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ scriptResult: 'ok', scriptError: '0' }))
    const db = makeClient(fetchMock)

    await db
      .from('contact')
      .select('id', 'name')
      .filter((f) => f.eq('active', true))
      .orderby('name')
      .top(10)
      .script('RefreshCache')

    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact/Script.RefreshCache`)
  })
})

describe('EntityRef#script (record scope)', () => {
  it('POSTs to /<db>/<EntitySet>(<key>)/Script.<name> with numeric key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ scriptResult: 'done', scriptError: '0' }))
    const db = makeClient(fetchMock)

    await db.from('contact').byKey(42).script('Archive')

    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact(42)/Script.Archive`)
  })

  it('single-quotes and escapes string keys', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ scriptResult: '', scriptError: '0' }))
    const db = makeClient(fetchMock)

    await db.from('contact').byKey("O'Brien").script('Archive')

    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact('O''Brien')/Script.Archive`)
  })
})

describe('script error handling', () => {
  it('throws FMScriptError when scriptError is non-zero', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ scriptResult: 'oops', scriptError: '101' }),
    )
    const db = makeClient(fetchMock)

    const err = await db.script('Boom').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FMScriptError)
    expect(err).toBeInstanceOf(FMODataError) // subclass relationship
    expect((err as FMScriptError).scriptError).toBe('101')
    expect((err as FMScriptError).scriptResult).toBe('oops')
    expect((err as FMScriptError).status).toBe(200)
    expect((err as FMScriptError).code).toBe('101')
    expect((err as FMScriptError).request).toEqual({
      url: `${BASE}/Script.Boom`,
      method: 'POST',
    })
  })

  it('coerces numeric scriptError to string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ scriptResult: '', scriptError: 5 } as unknown as object),
    )
    const db = makeClient(fetchMock)
    const err = await db.script('Boom').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FMScriptError)
    expect((err as FMScriptError).scriptError).toBe('5')
  })

  it('treats a missing scriptError as success ("0")', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ scriptResult: 'partial' }))
    const db = makeClient(fetchMock)
    const result = await db.script('Quiet')
    expect(result.scriptError).toBe('0')
    expect(result.scriptResult).toBe('partial')
  })

  it('unwraps an envelope nested under a wrapper key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        '@odata.context': `${BASE}/$metadata#Edm.ComplexType`,
        value: { scriptResult: 'pong', scriptError: '0' },
      }),
    )
    const db = makeClient(fetchMock)
    const result = await db.script('Ping')
    expect(result.scriptResult).toBe('pong')
  })

  it('surfaces HTTP-level failures as plain FMODataError (not FMScriptError)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: '401', message: 'nope' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const db = makeClient(fetchMock)
    const err = await db.script('Ping').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FMODataError)
    expect(err).not.toBeInstanceOf(FMScriptError)
    expect((err as FMODataError).status).toBe(401)
  })
})

describe('script plumbing', () => {
  it('retries once on 401 via onUnauthorized, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ scriptResult: 'pong', scriptError: '0' }))
    const onUnauthorized = vi.fn().mockResolvedValue(undefined)
    const db = makeClient(fetchMock, { onUnauthorized })

    const result = await db.script('Ping')
    expect(result.scriptResult).toBe('pong')
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('forwards AbortSignal', async () => {
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
    await expect(db.script('Ping', { signal: ctrl.signal })).rejects.toThrow(/abort/i)
  })
})

// ---------------------------------------------------------------------------
// FMSID-based script invocation (Phase 3 — requires FMS 26+)
// ---------------------------------------------------------------------------

describe('FMOData#scriptById (FMSID, database scope)', () => {
  it('POSTs to /<db>/Script.FMSID:<id> with no body when parameter is omitted', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ scriptResult: 'pong', scriptError: '0' }))
    const db = makeClient(fetchMock)

    const result = await db.scriptById(42)

    expect(result.scriptResult).toBe('pong')
    expect(result.scriptError).toBe('0')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/Script.FMSID:42`)
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).body).toBeUndefined()
  })

  it('sends { scriptParameter } as JSON when parameter is provided', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ scriptResult: 'ok', scriptError: '0' }))
    const db = makeClient(fetchMock)

    await db.scriptById(42, { parameter: 'hello' })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/Script.FMSID:42`)
    expect((init as RequestInit).body).toBe(JSON.stringify({ scriptParameter: 'hello' }))
    const headers = (init as RequestInit).headers as Headers
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('throws FMScriptError on non-zero scriptError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ scriptResult: '', scriptError: '101' }))
    const db = makeClient(fetchMock)

    await expect(db.scriptById(42)).rejects.toBeInstanceOf(FMScriptError)
  })
})

describe('ScriptInvoker FMSID URLs', () => {
  it('urlById builds database-scope URL', async () => {
    const { ScriptInvoker } = await import('../../src/scripts.js')
    const db = makeClient(vi.fn())
    const inv = new ScriptInvoker(db)
    expect(inv.urlById(42)).toBe(`${BASE}/Script.FMSID:42`)
  })

  it('urlById builds entity-set scope URL', async () => {
    const { ScriptInvoker } = await import('../../src/scripts.js')
    const db = makeClient(vi.fn())
    const inv = new ScriptInvoker(db, { entitySet: 'contact' })
    expect(inv.urlById(42)).toBe(`${BASE}/contact/Script.FMSID:42`)
  })

  it('urlById builds record-scope URL', async () => {
    const { ScriptInvoker } = await import('../../src/scripts.js')
    const db = makeClient(vi.fn())
    const inv = new ScriptInvoker(db, { entitySet: 'contact', key: 7 })
    expect(inv.urlById(42)).toBe(`${BASE}/contact(7)/Script.FMSID:42`)
  })

  it('urlById throws on non-finite id', async () => {
    const { ScriptInvoker } = await import('../../src/scripts.js')
    const db = makeClient(vi.fn())
    const inv = new ScriptInvoker(db)
    expect(() => inv.urlById(Number.NaN)).toThrow(/fmsid/)
  })
})
