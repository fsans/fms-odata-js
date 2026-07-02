/**
 * Webhook management for FileMaker Server OData.
 *
 * FMS exposes webhook management through five endpoints following the
 * standard OData function-call shape: read endpoints use GET, and action
 * endpoints use POST with the `<id>` passed as a function argument in the
 * URL path.
 *
 *   GET  /<db>/Webhook.GetAll        — list all webhooks
 *   GET  /<db>/Webhook.Get(<id>)     — get one webhook by id
 *   POST /<db>/Webhook.Add           — create a webhook (config in JSON body)
 *   POST /<db>/Webhook.Delete(<id>)  — delete a webhook (id in URL path)
 *   POST /<db>/Webhook.Invoke(<id>)  — manually trigger a webhook (id in URL path)
 *
 * Webhooks require FileMaker Server 2025+ (v22). Use
 * `db.hasFeature('webhooks')` to check before calling.
 *
 * @see https://github.com/fsans/fms-odata-spec/blob/main/docs/09-webhooks.md
 */

import type { WebhookCreateParams, WebhookData } from '@fms-odata/spec-ts'
import type { FMSOData } from './client.js'
import { executeJson } from './http.js'
import type { RequestOptions } from './types.js'
import { encodePathSegment } from './url.js'

/** Options accepted by webhook operations. */
export interface WebhookOptions extends RequestOptions {}

/**
 * Normalize create params: merge legacy `headers` into `endpointHeaders`
 * (spec says `headers` is a legacy alias for `endpointHeaders`).
 */
function normalizeCreateParams(params: WebhookCreateParams): Record<string, unknown> {
  const out: Record<string, unknown> = {
    webhook: params.webhook,
    tableName: params.tableName,
  }
  if (params.endpointHeaders) out.endpointHeaders = params.endpointHeaders
  if (params.headers && !params.endpointHeaders) out.endpointHeaders = params.headers
  if (params.queryHeaders) out.queryHeaders = params.queryHeaders
  if (params.notifySchemaChanges !== undefined) out.notifySchemaChanges = params.notifySchemaChanges
  if (params.select) out.select = params.select
  if (params.filter) out.filter = params.filter
  if (params.maxFailedAttempts !== undefined) out.maxFailedAttempts = params.maxFailedAttempts
  return out
}

/**
 * Extract the webhook ID from a `Webhook.Add` response.
 *
 * FMS returns `{ webhookResult: { webhookID: N } }`. Older or alternate
 * shapes (`{ webhookID: N }`, `{ id: N }`) are accepted as fallbacks.
 */
function extractWebhookId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const obj = data as Record<string, unknown>
  const fromResult = obj.webhookResult as Record<string, unknown> | undefined
  const id = fromResult?.webhookID ?? obj.webhookID ?? obj.id
  return id !== undefined ? String(id) : undefined
}

/**
 * Webhook manager for FileMaker Server webhook CRUD.
 *
 * Obtain an instance via `db.webhooks()` or use the convenience methods on
 * `FMSOData` (`db.createWebhook`, `db.removeWebhook`, etc.).
 *
 * Requires FileMaker Server 2025+ (v22).
 */
export class WebhookManager {
  /** @internal */ readonly _client: FMSOData

  constructor(client: FMSOData) {
    this._client = client
  }

  /** Build the URL for a webhook operation. */
  private _url(operation: 'Add' | 'Delete' | 'Get' | 'GetAll' | 'Invoke', id?: string | number): string {
    const base = `${this._client.baseUrl}/Webhook.${operation}`
    return id !== undefined ? `${base}(${encodePathSegment(String(id))})` : base
  }

  /**
   * Create a webhook.
   *
   * ```ts
   * const { id } = await db.webhooks().create({
   *   webhook: 'https://my.example.com:8080/webhook',
   *   tableName: 'contact',
   *   select: 'id,first_name',
   *   filter: "status eq 'active'",
   *   notifySchemaChanges: true,
   * })
   * ```
   *
   * @returns An object with the server-generated `id` of the new webhook.
   */
  async create(
    params: WebhookCreateParams,
    opts: WebhookOptions = {},
  ): Promise<{ id: string }> {
    if (!params.webhook) throw new TypeError('WebhookManager: `webhook` URL is required')
    if (!params.tableName) throw new TypeError('WebhookManager: `tableName` is required')

    const body = JSON.stringify(normalizeCreateParams(params))
    const data = await executeJson<unknown>(this._client._ctx, this._url('Add'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    const id = extractWebhookId(data)
    if (id === undefined) {
      throw new Error('WebhookManager: Webhook.Add did not return a webhook id')
    }
    return { id }
  }

  /**
   * Delete a webhook by its ID.
   *
   * ```ts
   * await db.webhooks().remove('1')
   * ```
   */
  async remove(id: string | number, opts: WebhookOptions = {}): Promise<unknown> {
    if (id === '' || id === undefined) throw new TypeError('WebhookManager: webhook `id` is required')
    return executeJson<unknown>(this._client._ctx, this._url('Delete', id), {
      method: 'POST',
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  /** Alias for {@link remove} (matches the FMS endpoint name `Webhook.Delete`). */
  async delete(id: string | number, opts: WebhookOptions = {}): Promise<unknown> {
    return this.remove(id, opts)
  }

  /**
   * Get a specific webhook's data by ID.
   *
   * ```ts
   * const data = await db.webhooks().get('1')
   * ```
   */
  async get(id: string | number, opts: WebhookOptions = {}): Promise<WebhookData | unknown> {
    if (id === '' || id === undefined) throw new TypeError('WebhookManager: webhook `id` is required')
    return executeJson<unknown>(this._client._ctx, this._url('Get', id), {
      method: 'GET',
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  /**
   * List all webhooks.
   *
   * ```ts
   * const result = await db.webhooks().getAll()
   * ```
   */
  async getAll(opts: WebhookOptions = {}): Promise<unknown> {
    return executeJson<unknown>(this._client._ctx, this._url('GetAll'), {
      method: 'GET',
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  /**
   * Manually invoke (trigger) a webhook by ID. Useful for testing.
   *
   * Optionally pass `rowIDs` to target specific records; if omitted, FMS
   * triggers the webhook for all pending records.
   *
   * ```ts
   * await db.webhooks().invoke('1')
   * await db.webhooks().invoke('1', { rowIDs: [10, 20] })
   * ```
   */
  async invoke(
    id: string | number,
    opts: WebhookOptions & { rowIDs?: ReadonlyArray<string | number> } = {},
  ): Promise<unknown> {
    if (id === '' || id === undefined) throw new TypeError('WebhookManager: webhook `id` is required')
    const { rowIDs, signal, ...rest } = opts
    // FMS requires a JSON body for Invoke (it rejects empty bodies with a
    // JSON syntax error). Send { rowIDs: [...] } — an empty array triggers
    // the webhook for all pending records.
    const body = JSON.stringify({ rowIDs: rowIDs ? [...rowIDs] : [] })
    return executeJson<unknown>(this._client._ctx, this._url('Invoke', id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      accept: 'json',
      ...(signal ? { signal } : {}),
      ...rest,
    })
  }
}
