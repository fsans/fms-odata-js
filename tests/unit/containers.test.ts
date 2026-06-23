import { describe, expect, it, vi } from 'vitest'
import { FMSOData } from '../../src/client.js'
import {
  formatContentDisposition,
  parseContentDispositionFilename,
  sniffContainerMime,
} from '../../src/containers.js'
import { FMSODataError } from '../../src/errors.js'
import type { FMSODataOptions } from '../../src/types.js'

const BASE = 'https://fms.example.com/fmi/odata/v4/Invoices'

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

function binaryResponse(
  body: BodyInit,
  headers: Record<string, string> = {},
  status = 200,
): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/octet-stream', ...headers },
  })
}

describe('parseContentDispositionFilename', () => {
  it('parses quoted filename', () => {
    expect(parseContentDispositionFilename('attachment; filename="logo.png"')).toBe('logo.png')
  })

  it('parses unquoted filename', () => {
    expect(parseContentDispositionFilename('attachment; filename=logo.png')).toBe('logo.png')
  })

  it('parses RFC 5987 filename* and prefers it over plain filename', () => {
    expect(
      parseContentDispositionFilename(
        `attachment; filename="ascii.png"; filename*=UTF-8''na%C3%AFve%20file.png`,
      ),
    ).toBe('naïve file.png')
  })

  it('unescapes backslash-escapes in quoted filenames', () => {
    expect(parseContentDispositionFilename('attachment; filename="a\\"b.png"')).toBe('a"b.png')
  })

  it('returns undefined when no filename parameter is present', () => {
    expect(parseContentDispositionFilename('inline')).toBeUndefined()
    expect(parseContentDispositionFilename('attachment')).toBeUndefined()
  })
})

describe('formatContentDisposition', () => {
  it('emits an unquoted inline header for token-safe filenames (Claris guide form)', () => {
    expect(formatContentDisposition('logo.png')).toBe('inline; filename=logo.png')
    expect(formatContentDisposition('ALFKI.png')).toBe('inline; filename=ALFKI.png')
  })

  it('falls back to quoted form when the filename contains separators', () => {
    expect(formatContentDisposition('hello world.png')).toBe('inline; filename="hello world.png"')
  })

  it('escapes inner double-quotes in the quoted-form fallback', () => {
    expect(formatContentDisposition('a"b.png')).toBe('inline; filename="a\\"b.png"')
  })

  it('adds a UTF-8 filename* parameter for non-ASCII names', () => {
    const got = formatContentDisposition('niño.png')
    expect(got).toMatch(/^inline; filename="ni_o\.png"; filename\*=UTF-8''ni%C3%B1o\.png$/)
  })
})

describe('ContainerRef.url', () => {
  it('builds /<EntitySet>(<key>)/<field> with percent-encoding (no $value suffix)', () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    expect(db.from('contact').byKey(7).container('photo').url()).toBe(
      `${BASE}/contact(7)/photo`,
    )
    expect(db.from('contact').byKey(7).container('Profile Photo').url()).toBe(
      `${BASE}/contact(7)/Profile%20Photo`,
    )
  })

  it('rejects empty field names', () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    expect(() => db.from('contact').byKey(7).container('')).toThrow(/required/)
  })
})

describe('ContainerRef.get', () => {
  it('returns blob + content-type + size + parsed filename', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const fetchMock = vi.fn().mockResolvedValue(
      binaryResponse(bytes, {
        'content-type': 'image/png',
        'content-disposition': 'attachment; filename="logo.png"',
      }),
    )
    const db = makeClient(fetchMock)
    const dl = await db.from('contact').byKey(7).container('photo').get()

    expect(dl.contentType).toBe('image/png')
    expect(dl.filename).toBe('logo.png')
    expect(dl.size).toBe(4)
    const buf = new Uint8Array(await dl.blob.arrayBuffer())
    expect(Array.from(buf)).toEqual(Array.from(bytes))

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact(7)/photo/$value`)
    expect((init as RequestInit).method).toBe('GET')
    const accept = ((init as RequestInit).headers as Headers).get('accept')
    // Must not be application/octet-stream — see docs/filemaker-quirks.md
    // (`Accept: application/octet-stream` makes FMS return the filename text).
    expect(accept).toBe('*/*')
  })

  it('omits filename when Content-Disposition is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      binaryResponse(new Uint8Array([1, 2, 3]), { 'content-type': 'image/jpeg' }),
    )
    const db = makeClient(fetchMock)
    const dl = await db.from('contact').byKey(7).container('photo').get()
    expect(dl.filename).toBeUndefined()
    expect(dl.contentType).toBe('image/jpeg')
  })

  it('reports size 0 for an empty container', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream', 'content-length': '0' },
      }),
    )
    const db = makeClient(fetchMock)
    const dl = await db.from('contact').byKey(7).container('photo').get()
    expect(dl.size).toBe(0)
    expect(dl.blob.size).toBe(0)
  })
})

describe('ContainerRef.getStream', () => {
  it('returns the underlying ReadableStream', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const fetchMock = vi.fn().mockResolvedValue(binaryResponse(bytes))
    const db = makeClient(fetchMock)

    const stream = await db.from('contact').byKey(7).container('photo').getStream()
    expect(stream).toBeInstanceOf(ReadableStream)

    // Drain and assert byte equality.
    const reader = stream.getReader()
    const chunks: number[] = []
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      for (const b of value) chunks.push(b)
    }
    expect(chunks).toEqual(Array.from(bytes))
  })

  it('throws when the response body is null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    )
    const db = makeClient(fetchMock)
    await expect(
      db.from('contact').byKey(7).container('photo').getStream(),
    ).rejects.toThrow(/no body/)
  })
})

describe('ContainerRef.upload (binary, opt-in)', () => {
  it('PATCHes /<field> with Content-Type and (when filename given) unquoted Content-Disposition', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    const data = new Uint8Array([0xff, 0xd8, 0xff])

    await db
      .from('contact')
      .byKey(7)
      .container('photo')
      .upload({ data, contentType: 'image/jpeg', filename: 'snap.jpg', encoding: 'binary' })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact(7)/photo`) // no $value
    expect((init as RequestInit).method).toBe('PATCH')
    const headers = (init as RequestInit).headers as Headers
    expect(headers.get('content-type')).toBe('image/jpeg')
    expect(headers.get('content-disposition')).toBe('inline; filename=snap.jpg')
    // Body is normalized to ArrayBuffer for cross-runtime stability.
    const sent = new Uint8Array((init as RequestInit).body as ArrayBuffer)
    expect(Array.from(sent)).toEqual([0xff, 0xd8, 0xff])
  })

  it('omits Content-Disposition when no filename is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    await db.from('contact').byKey(7).container('photo').upload({
      data: new Uint8Array([1]),
      contentType: 'image/png',
      encoding: 'binary',
    })
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Headers
    expect(headers.has('content-disposition')).toBe(false)
  })

  it('accepts Blob and ArrayBuffer payloads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)

    await db.from('contact').byKey(7).container('photo').upload({
      data: new Blob([new Uint8Array([1, 2])]),
      contentType: 'image/png',
      encoding: 'binary',
    })
    await db.from('contact').byKey(7).container('photo').upload({
      data: new Uint8Array([3, 4]).buffer,
      contentType: 'image/png',
      encoding: 'binary',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit
      expect(init.method).toBe('PATCH')
      expect(init.body).toBeDefined()
    }
  })

  it('rejects uploads when contentType is missing AND magic bytes are unrecognised', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    await expect(
      db
        .from('contact')
        .byKey(7)
        .container('photo')
        .upload({ data: new Uint8Array([1, 2, 3]), encoding: 'binary' }),
    ).rejects.toThrow(/contentType is required and could not be sniffed/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects unsupported MIME types in binary mode', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    await expect(
      db.from('contact').byKey(7).container('photo').upload({
        data: new Uint8Array([1, 2, 3]),
        contentType: 'application/zip',
        encoding: 'binary',
      }),
    ).rejects.toThrow(/not a FileMaker-supported container type/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts image/tiff as a supported binary MIME', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    await db.from('contact').byKey(7).container('photo').upload({
      // Little-endian TIFF magic bytes
      data: new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
      contentType: 'image/tiff',
      encoding: 'binary',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Headers
    expect(headers.get('content-type')).toBe('image/tiff')
  })

  it('sniffs contentType from PNG magic bytes when omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
    await db.from('contact').byKey(7).container('photo').upload({ data: png })
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Headers
    expect(headers.get('content-type')).toBe('image/png')
  })

  it('sniffs contentType from PDF magic bytes when omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    await db.from('contact').byKey(7).container('photo').upload({ data: pdf })
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Headers
    expect(headers.get('content-type')).toBe('application/pdf')
  })
})

describe('sniffContainerMime', () => {
  it('detects PNG (89 50 4E 47 0D 0A 1A 0A)', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(sniffContainerMime(png)).toBe('image/png')
  })

  it('detects JPEG (FF D8 FF)', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    expect(sniffContainerMime(jpeg)).toBe('image/jpeg')
  })

  it('detects GIF87a / GIF89a (47 49 46 38)', () => {
    expect(sniffContainerMime(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe('image/gif')
  })

  it('detects little-endian TIFF (49 49 2A 00)', () => {
    expect(sniffContainerMime(new Uint8Array([0x49, 0x49, 0x2a, 0x00]))).toBe('image/tiff')
  })

  it('detects big-endian TIFF (4D 4D 00 2A)', () => {
    expect(sniffContainerMime(new Uint8Array([0x4d, 0x4d, 0x00, 0x2a]))).toBe('image/tiff')
  })

  it('detects PDF (%PDF)', () => {
    expect(sniffContainerMime(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe('application/pdf')
  })

  it('returns undefined for unsupported / random bytes', () => {
    expect(sniffContainerMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeUndefined()
    expect(sniffContainerMime(new Uint8Array([]))).toBeUndefined()
  })
})

describe('ContainerRef.upload (binary, default)', () => {
  it('PATCHes /<field> with raw bytes and no Content-Disposition when filename is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    const data = new Uint8Array([0xff, 0xd8, 0xff]) // JPEG magic bytes

    await db.from('contact').byKey(7).container('photo').upload({
      data,
      contentType: 'image/jpeg',
      // filename omitted — FMS stores embedded binary (not a file reference)
      // encoding omitted — should default to 'binary'
    })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact(7)/photo`) // field URL, not record URL
    expect((init as RequestInit).method).toBe('PATCH')
    const headers = (init as RequestInit).headers as Headers
    expect(headers.get('content-type')).toBe('image/jpeg')
    expect(headers.has('content-disposition')).toBe(false) // no filename = embedded binary
    const sent = new Uint8Array((init as RequestInit).body as ArrayBuffer)
    expect(Array.from(sent)).toEqual([0xff, 0xd8, 0xff])
  })

  it('omits the Filename annotation when no filename is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    await db.from('contact').byKey(7).container('photo').upload({
      data: new Uint8Array([0xaa]),
      contentType: 'application/zip',
      encoding: 'base64',
    })
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    )
    expect(body).toEqual({
      photo: 'qg==',
      'photo@com.filemaker.odata.ContentType': 'application/zip',
    })
  })
})

describe('ContainerRef.delete', () => {
  it('PATCHes the record with { <field>: null } to clear the value', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)
    await db.from('contact').byKey(7).container('photo').delete()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/contact(7)`)
    expect((init as RequestInit).method).toBe('PATCH')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ photo: null })
  })
})

describe('ContainerRef error propagation', () => {
  it('surfaces 4xx responses as FMSODataError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: '404', message: 'No record' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const db = makeClient(fetchMock)
    const err = await db
      .from('contact')
      .byKey(7)
      .container('photo')
      .get()
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FMSODataError)
    expect((err as FMSODataError).status).toBe(404)
  })
})
