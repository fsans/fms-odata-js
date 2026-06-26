import { describe, expect, it, vi } from 'vitest'
import { FMSOData } from '../../src/client.js'
import { SchemaEditor } from '../../src/schema.js'
import type { FMSODataOptions } from '../../src/types.js'

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

describe('SchemaEditor#createTable', () => {
  it('POSTs to FileMaker_Tables with the table definition as JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ tableName: 'Company' }))
    const db = makeClient(fetchMock)

    await db.schema().createTable({
      tableName: 'Company',
      fields: [
        { name: 'Company ID', type: 'int', primary: true },
        { name: 'Company Name', type: 'varchar(100)', nullable: false },
      ],
    })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/FileMaker_Tables`)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.tableName).toBe('Company')
    expect(body.fields).toHaveLength(2)
    expect(body.fields[0]).toEqual({ name: 'Company ID', type: 'int', primary: true })
    const headers = (init as RequestInit).headers as Headers
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('rejects empty tableName', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    await expect(
      db.schema().createTable({ tableName: '', fields: [{ name: 'x', type: 'int' }] }),
    ).rejects.toThrow(/tableName/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects empty fields array', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    await expect(
      db.schema().createTable({ tableName: 'T', fields: [] }),
    ).rejects.toThrow(/fields/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects unsupported field type', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    await expect(
      db.schema().createTable({
        tableName: 'T',
        fields: [{ name: 'x', type: 'BOGUS' }],
      }),
    ).rejects.toThrow(/unsupported field type/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts case-insensitive field types', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    const db = makeClient(fetchMock)
    await db.schema().createTable({
      tableName: 'T',
      fields: [{ name: 'x', type: 'varchar(50)' }],
    })
    expect(fetchMock).toHaveBeenCalled()
  })

  it('works via db.createTable convenience method', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    const db = makeClient(fetchMock)
    await db.createTable({ tableName: 'T', fields: [{ name: 'x', type: 'int' }] })
    expect(fetchMock).toHaveBeenCalled()
  })
})

describe('SchemaEditor#addFields', () => {
  it('PATCHes FileMaker_Tables(\'{table}\') with { fields } body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    const db = makeClient(fetchMock)

    await db.schema().addFields({
      tableName: 'Company',
      fields: [{ name: 'Phone', type: 'varchar(30)' }],
    })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/FileMaker_Tables('Company')`)
    expect((init as RequestInit).method).toBe('PATCH')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ fields: [{ name: 'Phone', type: 'varchar(30)' }] })
  })

  it('URL-encodes table names with special characters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    const db = makeClient(fetchMock)

    await db.schema().addFields({
      tableName: 'My Table',
      fields: [{ name: 'x', type: 'int' }],
    })

    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/FileMaker_Tables('My%20Table')`)
  })
})

describe('SchemaEditor#deleteTable', () => {
  it('DELETEs FileMaker_Tables(\'{table}\') when confirm is true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)

    await db.schema().deleteTable('OldTable', { confirm: true })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/FileMaker_Tables('OldTable')`)
    expect((init as RequestInit).method).toBe('DELETE')
  })

  it('refuses without confirm: true', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)

    await expect(
      db.schema().deleteTable('OldTable', { confirm: false } as never),
    ).rejects.toThrow(/confirm/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses when confirm is omitted', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)

    await expect(
      db.schema().deleteTable('OldTable', undefined as never),
    ).rejects.toThrow(/confirm/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('SchemaEditor#deleteField', () => {
  it('DELETEs FileMaker_Tables(\'{table}\')/{field} when confirm is true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)

    await db.schema().deleteField('Company', 'OldField', { confirm: true })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/FileMaker_Tables('Company')/OldField`)
    expect((init as RequestInit).method).toBe('DELETE')
  })

  it('refuses without confirm: true', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)

    await expect(
      db.schema().deleteField('Company', 'OldField', { confirm: false } as never),
    ).rejects.toThrow(/confirm/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('URL-encodes table and field names with special characters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)

    await db.schema().deleteField('My Table', 'Field/Name', { confirm: true })

    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/FileMaker_Tables('My%20Table')/Field%2FName`)
  })
})

describe('SchemaEditor#createIndex', () => {
  it('POSTs { indexName } to FileMaker_Indexes/{table}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    const db = makeClient(fetchMock)

    await db.schema().createIndex('Company', 'Company Name')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/FileMaker_Indexes/Company`)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ indexName: 'Company Name' })
  })

  it('rejects empty tableName', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    await expect(db.schema().createIndex('', 'x')).rejects.toThrow(/tableName/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects empty fieldName', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    await expect(db.schema().createIndex('T', '')).rejects.toThrow(/fieldName/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('SchemaEditor#deleteIndex', () => {
  it('DELETEs FileMaker_Indexes/{table}/{field}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const db = makeClient(fetchMock)

    await db.schema().deleteIndex('Company', 'Company Name')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/FileMaker_Indexes/Company/Company%20Name`)
    expect((init as RequestInit).method).toBe('DELETE')
  })
})

describe('SchemaEditor instance caching', () => {
  it('db.schema() returns the same instance on repeated calls', () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    const s1 = db.schema()
    const s2 = db.schema()
    expect(s1).toBeInstanceOf(SchemaEditor)
    expect(s1).toBe(s2)
  })
})
