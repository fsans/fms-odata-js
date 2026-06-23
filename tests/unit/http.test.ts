import { describe, expect, it, vi } from 'vitest'
import { FMSOData } from '../../src/client.js'
import { FMSODataError } from '../../src/errors.js'
import { basicAuth, combineSignals, resolveAuthHeader } from '../../src/http.js'
import type { FMSODataOptions } from '../../src/types.js'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('resolveAuthHeader', () => {
  it('prefixes bare tokens with "Bearer "', async () => {
    expect(await resolveAuthHeader('abc123')).toBe('Bearer abc123')
  })

  it('passes through scheme-prefixed values verbatim', async () => {
    expect(await resolveAuthHeader('Basic dXNlcjpwYXNz')).toBe('Basic dXNlcjpwYXNz')
    expect(await resolveAuthHeader('Bearer x.y.z')).toBe('Bearer x.y.z')
    expect(await resolveAuthHeader('Negotiate foo')).toBe('Negotiate foo')
  })

  it('awaits async token providers', async () => {
    expect(await resolveAuthHeader(async () => 'Basic zzz')).toBe('Basic zzz')
  })

  it('throws when the provider returns empty', async () => {
    await expect(resolveAuthHeader(() => '')).rejects.toThrow(/empty/)
  })
})

describe('basicAuth', () => {
  it('base64-encodes user:pass', () => {
    expect(basicAuth('admin', 'wakawaka')).toBe(
      `Basic ${Buffer.from('admin:wakawaka').toString('base64')}`,
    )
  })

  it('handles UTF-8 credentials', () => {
    expect(basicAuth('üser', 'pässword')).toBe(
      `Basic ${Buffer.from('üser:pässword', 'utf8').toString('base64')}`,
    )
  })
})

describe('combineSignals', () => {
  it('returns undefined when given no signals', () => {
    expect(combineSignals([undefined])).toBeUndefined()
  })

  it('returns the same signal when only one is given', () => {
    const s = new AbortController().signal
    expect(combineSignals([s, undefined])).toBe(s)
  })

  it('aborts when any input aborts', () => {
    const a = new AbortController()
    const b = new AbortController()
    const merged = combineSignals([a.signal, b.signal])!
    expect(merged.aborted).toBe(false)
    b.abort(new Error('stopping'))
    expect(merged.aborted).toBe(true)
  })

  it('is already aborted when an input was pre-aborted', () => {
    const a = new AbortController()
    a.abort()
    const merged = combineSignals([a.signal, new AbortController().signal])!
    expect(merged.aborted).toBe(true)
  })
})

describe('FMSOData request plumbing (mocked fetch)', () => {
  function makeClient(
    fetchMock: ReturnType<typeof vi.fn>,
    overrides: Partial<FMSODataOptions> = {},
  ): FMSOData {
    return new FMSOData({
      host: 'https://fms.example.com',
      database: 'Invoices',
      token: 'abc',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      ...overrides,
    })
  }

  it('sends the Authorization header computed from the token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ value: [] }))
    const db = makeClient(fetchMock)
    await db.from('contact').get()
    const call = fetchMock.mock.calls[0]!
    const headers = (call[1] as RequestInit).headers as Headers
    expect(headers.get('authorization')).toBe('Bearer abc')
    expect(headers.get('accept')).toBe('application/json')
  })

  it('passes through a Basic token without re-prefixing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ value: [] }))
    const db = makeClient(fetchMock, { token: basicAuth('admin', 'wakawaka') })
    await db.from('contact').get()
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Headers
    expect(headers.get('authorization')).toMatch(/^Basic /)
  })

  it('retries once on 401 after calling onUnauthorized', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ value: [{ id: 1 }] }))
    const onUnauthorized = vi.fn().mockResolvedValue(undefined)
    const db = makeClient(fetchMock, { onUnauthorized })

    const result = await db.from('contact').get()
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.value).toEqual([{ id: 1 }])
  })

  it('does not retry a 401 if onUnauthorized is absent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 401, statusText: 'Unauthorized' }))
    const db = makeClient(fetchMock)
    await expect(db.from('contact').get()).rejects.toBeInstanceOf(FMSODataError)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not retry twice if the refreshed request also returns 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    const db = makeClient(fetchMock, { onUnauthorized: async () => {} })
    await expect(db.from('contact').get()).rejects.toBeInstanceOf(FMSODataError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws a typed FMSODataError on HTTP errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: '400', message: 'Bad stuff' } }), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
      }),
    )
    const db = makeClient(fetchMock)
    const err = await db
      .from('contact')
      .get()
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FMSODataError)
    expect((err as FMSODataError).status).toBe(400)
    expect((err as FMSODataError).code).toBe('400')
    expect((err as FMSODataError).message).toBe('Bad stuff')
    expect((err as FMSODataError).request).toEqual({
      url: 'https://fms.example.com/fmi/odata/v4/Invoices/contact',
      method: 'GET',
    })
  })

  it('aborts when the caller signal is already aborted', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, init: RequestInit) => {
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
    await expect(db.from('contact').get({ signal: ctrl.signal })).rejects.toThrow(/abort/i)
  })

  it('times out when timeoutMs elapses before the response arrives', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        )
      })
    })
    const db = makeClient(fetchMock, { timeoutMs: 25 })
    await expect(db.from('contact').get()).rejects.toThrow(/abort/i)
  })
})
