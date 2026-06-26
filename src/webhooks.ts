/**
 * Webhook management for FileMaker Server OData.
 *
 * FMS exposes webhook management through five POST endpoints:
 *
 *   POST /<db>/Webhook.Add      — create a webhook
 *   POST /<db>/Webhook.Remove   — delete a webhook
 *   POST /<db>/Webhook.Get      — get a specific webhook's data
 *   POST /<db>/Webhook.GetAll   — list all webhooks
 *   POST /<db>/Webhook.Invoke   — manually trigger a webhook (for testing)
 *
 * Webhooks require FileMaker Server 2023+ (v21). Use
 * `db.hasFeature('webhooks')` to check before calling.
 *
 * @see https://github.com/fsans/fms-odata-spec/blob/main/docs/09-webhooks.md
 */

import type { WebhookCreateParams, WebhookData } from '@fms-odata/spec-ts'
import type { FMSOData } from './client.js'
import { executeJson } from './http.js'
import type { RequestOptions } from './types.js'

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
 * Webhook manager for FileMaker Server webhook CRUD.
 *
 * Obtain an instance via `db.webhooks()` or use the convenience methods on
 * `FMSOData` (`db.createWebhook`, `db.removeWebhook`, etc.).
 *
 * Requires FileMaker Server 2023+ (v21).
 */
export class WebhookManager {
  /** @internal */ readonly _client: FMSOData

  constructor(client: FMSOData) {
    this._client = client
  }

  /** Build the URL for a webhook operation. */
  private _url(operation: 'Add' | 'Remove' | 'Get' | 'GetAll' | 'Invoke'): string {
    return `${this._client.baseUrl}/Webhook.${operation}`
  }

  /**
   * Create a webhook.
   *
   * ```ts
   * await db.webhooks().create({
   *   webhook: 'https://my.example.com:8080/webhook',
   *   tableName: 'contact',
   *   select: 'id,first_name',
   *   filter: "status eq 'active'",
   *   notifySchemaChanges: true,
   * })
   * ```
   */
  async create(
    params: WebhookCreateParams,
    opts: WebhookOptions = {},
  ): Promise<unknown> {
    if (!params.webhook) throw new TypeError('WebhookManager: `webhook` URL is required')
    if (!params.tableName) throw new TypeError('WebhookManager: `tableName` is required')

    const body = JSON.stringify(normalizeCreateParams(params))
    return executeJson<unknown>(this._client._ctx, this._url('Add'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  /**
   * Remove (delete) a webhook by its ID.
   *
   * ```ts
   * await db.webhooks().remove('abc123')
   * ```
   */
  async remove(id: string, opts: WebhookOptions = {}): Promise<unknown> {
    if (!id) throw new TypeError('WebhookManager: webhook `id` is required')
    return executeJson<unknown>(this._client._ctx, this._url('Remove'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  /**
   * Get a specific webhook's data by ID.
   *
   * ```ts
   * const data = await db.webhooks().get('abc123')
   * ```
   */
  async get(id: string, opts: WebhookOptions = {}): Promise<WebhookData | unknown> {
    if (!id) throw new TypeError('WebhookManager: webhook `id` is required')
    return executeJson<unknown>(this._client._ctx, this._url('Get'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  /**
   * Manually invoke (trigger) a webhook by ID. Useful for testing.
   *
   * ```ts
   * await db.webhooks().invoke('abc123')
   * ```
   */
  async invoke(id: string, opts: WebhookOptions = {}): Promise<unknown> {
    if (!id) throw new TypeError('WebhookManager: webhook `id` is required')
    return executeJson<unknown>(this._client._ctx, this._url('Invoke'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }
}
