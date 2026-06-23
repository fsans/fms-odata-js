import { describe, expect, it, vi } from 'vitest'
import { FMSOData } from '../../src/client.js'
import type { FMSODataOptions } from '../../src/types.js'

const BASE = 'https://fms.example.com/fmi/odata/v4/Invoices'

function multipartResponse(parts: string[], boundary: string): Response {
  const body = parts.map(p => `--${boundary}\r\n${p}`).join('\r\n') + `\r\n--${boundary}--`
  return new Response(body, {
    status: 200,
    headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
  })
}

function httpPart(status: number, body: unknown, contentType = 'application/json'): string {
  const jsonBody = typeof body === 'string' ? body : JSON.stringify(body)
  return [
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    '',
    `HTTP/1.1 ${status} OK`,
    `Content-Type: ${contentType}`,
    '',
    jsonBody,
  ].join('\r\n')
}

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

describe('Batch', () => {
  it('creates a batch builder', () => {
    const db = makeClient(vi.fn())
    const batch = db.batch()
    expect(batch).toBeDefined()
  })

  it('serializes a read operation', () => {
    const db = makeClient(vi.fn())
    const batch = db.batch()

    batch.add({ op: 'list', entitySet: 'contact', query: { $top: 5 } })

    const { boundary, body } = batch._serialize()
    expect(boundary).toMatch(/^batch_/)
    expect(body).toContain(`GET ${BASE}/contact?$top=5`)
    expect(body).toContain(`--${boundary}`)
    expect(body).toContain(`--${boundary}--`)
  })

  it('serializes multiple read operations', () => {
    const db = makeClient(vi.fn())
    const batch = db.batch()

    batch.add({ op: 'list', entitySet: 'contact', query: { $top: 5 } })
    batch.add({ op: 'list', entitySet: 'invoice', query: { $filter: "status eq 'open'" } })

    const { body } = batch._serialize()
    expect(body).toContain('GET')
    expect(body).toContain('contact')
    expect(body).toContain('invoice')
    expect(body).toContain('$top=5')
    expect(body).toContain('$filter=')
  })

  it('preserves literal commas in $select (not %2C)', () => {
    // FileMaker Server rejects %2C encoding in $select
    const db = makeClient(vi.fn())
    const batch = db.batch()

    batch.add({ op: 'list', entitySet: 'contact', query: { $select: 'ID,Name,Age' } })

    const { body } = batch._serialize()
    expect(body).toContain('$select=ID,Name,Age')
    expect(body).not.toContain('%2C')
  })

  it('serializes a changeset with create', () => {
    const db = makeClient(vi.fn())
    const batch = db.batch()

    batch.changeset(cs => {
      cs.create('contact', { firstName: 'John', lastName: 'Doe' })
    })

    const { body } = batch._serialize()
    expect(body).toContain('Content-Type: multipart/mixed; boundary=changeset_')
    expect(body).toContain('POST')
    expect(body).toContain('contact')
    expect(body).toContain('firstName')
    expect(body).toContain('John')
  })

  it('serializes a changeset with patch and delete', () => {
    const db = makeClient(vi.fn())
    const batch = db.batch()

    batch.changeset(cs => {
      cs.patch('contact', 123, { firstName: 'Jane' })
      cs.delete('contact', 456)
    })

    const { body } = batch._serialize()
    expect(body).toContain('PATCH')
    expect(body).toContain('DELETE')
    expect(body).toContain('contact(123)')
    expect(body).toContain('contact(456)')
  })

  it('handles string keys with quote escaping', () => {
    const db = makeClient(vi.fn())
    const batch = db.batch()

    batch.changeset(cs => {
      cs.patch('contact', "O'Brien", { firstName: 'Updated' })
    })

    const { body } = batch._serialize()
    expect(body).toContain("contact('O''Brien')")
  })

  it('parses a read response', async () => {
    const boundary = 'batch_abc123'
    const responseBody = { value: [{ id: 1, name: 'Test' }] }
    const fetchMock = vi.fn().mockResolvedValue(
      multipartResponse([httpPart(200, responseBody)], boundary),
    )
    const db = makeClient(fetchMock)
    const batch = db.batch()

    batch.add({ op: 'list', entitySet: 'contact' })
    const result = await batch.send()

    expect(result.ok).toBe(true)
    expect(result.responses).toHaveLength(1)
    expect(result.responses[0].status).toBe(200)
    expect(result.responses[0].body).toEqual(responseBody)
  })

  it('parses multiple responses in order', async () => {
    const boundary = 'batch_abc123'
    const fetchMock = vi.fn().mockResolvedValue(
      multipartResponse(
        [
          httpPart(200, { value: [{ id: 1 }] }),
          httpPart(200, { value: [{ id: 2 }] }),
        ],
        boundary,
      ),
    )
    const db = makeClient(fetchMock)
    const batch = db.batch()

    const first = batch.add({ op: 'list', entitySet: 'contact' })
    const second = batch.add({ op: 'list', entitySet: 'invoice' })
    const result = await batch.send()

    expect(result.responses).toHaveLength(2)
    expect(first._index).toBe(0)
    expect(second._index).toBe(1)
  })

  it('handles error responses', async () => {
    const boundary = 'batch_abc123'
    const errorBody = { error: { message: 'Not found' } }
    const fetchMock = vi.fn().mockResolvedValue(
      multipartResponse([httpPart(404, errorBody)], boundary),
    )
    const db = makeClient(fetchMock)
    const batch = db.batch()

    batch.add({ op: 'list', entitySet: 'missing' })
    const result = await batch.send()

    expect(result.ok).toBe(false)
    expect(result.responses[0].status).toBe(404)
    expect(result.responses[0].ok).toBe(false)
  })

  it('sends correct Content-Type header', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(
        multipartResponse([httpPart(200, { value: [] })], 'batch_123'),
      )
    })
    const db = makeClient(fetchMock)
    const batch = db.batch()

    batch.add({ op: 'list', entitySet: 'contact' })
    await batch.send()

    const [, init] = fetchMock.mock.calls[0]!
    const headers = (init as RequestInit).headers as unknown as Headers
    expect(headers.get('content-type')).toMatch(/multipart\/mixed; boundary=batch_/)
  })

  it('POSTs to $batch endpoint', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(
        multipartResponse([httpPart(200, { value: [] })], 'batch_123'),
      )
    })
    const db = makeClient(fetchMock)
    const batch = db.batch()

    batch.add({ op: 'list', entitySet: 'contact' })
    await batch.send()

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/$batch`)
    expect((init as RequestInit).method).toBe('POST')
  })

  it('handles mixed read and changeset operations', async () => {
    const boundary = 'batch_abc123'
    const changesetBoundary = 'changeset_def456'
    const changesetPart = [
      `Content-Type: multipart/mixed; boundary=${changesetBoundary}`,
      '',
      `--${changesetBoundary}`,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      '',
      'HTTP/1.1 201 Created',
      'Content-Type: application/json',
      '',
      JSON.stringify({ id: 123 }),
      `--${changesetBoundary}--`,
    ].join('\r\n')

    const fetchMock = vi.fn().mockResolvedValue(
      multipartResponse(
        [httpPart(200, { value: [] }), changesetPart],
        boundary,
      ),
    )
    const db = makeClient(fetchMock)
    const batch = db.batch()

    batch.add({ op: 'list', entitySet: 'contact' })
    batch.changeset(cs => {
      cs.create('contact', { firstName: 'Test' })
    })

    const result = await batch.send()
    expect(result.responses.length).toBeGreaterThan(0)
  })

  it('respects AbortSignal', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Aborted')), 10)
      })
    })
    const db = makeClient(fetchMock)
    const batch = db.batch()

    batch.add({ op: 'list', entitySet: 'contact' })
    const ctrl = new AbortController()
    ctrl.abort()

    await expect(batch.send({ signal: ctrl.signal })).rejects.toThrow()
  })

  it('handles If-Match headers in changeset', () => {
    const db = makeClient(vi.fn())
    const batch = db.batch()

    batch.changeset(cs => {
      cs.patch('contact', 123, { firstName: 'Jane' }, { ifMatch: '"abc123"' })
    })

    const { body } = batch._serialize()
    expect(body).toContain('If-Match: "abc123"')
  })
})
