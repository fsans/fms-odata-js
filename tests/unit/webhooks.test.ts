import { describe, expect, it, vi } from 'vitest'
import { FMSOData } from '../../src/client.js'
import { WebhookManager } from '../../src/webhooks.js'
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

describe('WebhookManager#create', () => {
  it('POSTs to Webhook.Add with the webhook params as JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'wh1' }))
    const db = makeClient(fetchMock)

    await db.webhooks().create({
      webhook: 'https://my.example.com:8080/wh',
      tableName: 'contact',
      select: 'id,first_name',
      filter: "status eq 'active'",
      notifySchemaChanges: true,
    })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/Webhook.Add`)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.webhook).toBe('https://my.example.com:8080/wh')
    expect(body.tableName).toBe('contact')
    expect(body.select).toBe('id,first_name')
    expect(body.filter).toBe("status eq 'active'")
    expect(body.notifySchemaChanges).toBe(true)
    const headers = (init as RequestInit).headers as Headers
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('rejects empty webhook URL', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    await expect(
      db.webhooks().create({ webhook: '', tableName: 't' } as never),
    ).rejects.toThrow(/webhook/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects empty tableName', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    await expect(
      db.webhooks().create({ webhook: 'https://x', tableName: '' } as never),
    ).rejects.toThrow(/tableName/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps legacy headers alias to endpointHeaders', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'wh1' }))
    const db = makeClient(fetchMock)

    await db.webhooks().create({
      webhook: 'https://my.example.com/wh',
      tableName: 'contact',
      headers: { 'X-Custom': 'val' },
    } as never)

    const [, callInit] = fetchMock.mock.calls[0]!
    const body = JSON.parse((callInit as RequestInit).body as string)
    expect(body.endpointHeaders).toEqual({ 'X-Custom': 'val' })
    expect(body.headers).toBeUndefined()
  })

  it('prefers endpointHeaders over legacy headers when both are set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'wh1' }))
    const db = makeClient(fetchMock)

    await db.webhooks().create({
      webhook: 'https://my.example.com/wh',
      tableName: 'contact',
      endpointHeaders: { A: '1' },
      headers: { B: '2' },
    } as never)

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.endpointHeaders).toEqual({ A: '1' })
  })

  it('works via db.createWebhook convenience method', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'wh1' }))
    const db = makeClient(fetchMock)
    await db.createWebhook({ webhook: 'https://x', tableName: 't' })
    expect(fetchMock).toHaveBeenCalled()
  })
})

describe('WebhookManager#remove', () => {
  it('POSTs { id } to Webhook.Remove', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    const db = makeClient(fetchMock)

    await db.webhooks().remove('wh1')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/Webhook.Remove`)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ id: 'wh1' })
  })

  it('rejects empty id', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    await expect(db.webhooks().remove('')).rejects.toThrow(/id/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('WebhookManager#get', () => {
  it('POSTs { id } to Webhook.Get', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ id: 'wh1', webhook: 'https://x', tableName: 't' }),
    )
    const db = makeClient(fetchMock)

    const result = await db.webhooks().get('wh1')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/Webhook.Get`)
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ id: 'wh1' })
    expect(result).toEqual({ id: 'wh1', webhook: 'https://x', tableName: 't' })
  })

  it('rejects empty id', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    await expect(db.webhooks().get('')).rejects.toThrow(/id/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('WebhookManager#getAll', () => {
  it('POSTs to Webhook.GetAll with no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: 'wh1' }]))
    const db = makeClient(fetchMock)

    await db.webhooks().getAll()

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/Webhook.GetAll`)
    expect((init as RequestInit).method).toBe('POST')
    const headers = (init as RequestInit).headers as Headers
    expect(headers.get('content-type')).toBe('application/json')
  })
})

describe('WebhookManager#invoke', () => {
  it('POSTs { id } to Webhook.Invoke', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    const db = makeClient(fetchMock)

    await db.webhooks().invoke('wh1')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/Webhook.Invoke`)
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ id: 'wh1' })
  })

  it('rejects empty id', async () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    await expect(db.webhooks().invoke('')).rejects.toThrow(/id/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('WebhookManager instance caching', () => {
  it('db.webhooks() returns the same instance on repeated calls', () => {
    const fetchMock = vi.fn()
    const db = makeClient(fetchMock)
    const w1 = db.webhooks()
    const w2 = db.webhooks()
    expect(w1).toBeInstanceOf(WebhookManager)
    expect(w1).toBe(w2)
  })
})
