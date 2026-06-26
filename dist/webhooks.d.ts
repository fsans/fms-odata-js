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
import type { WebhookCreateParams, WebhookData } from '@fms-odata/spec-ts';
import type { FMSOData } from './client.js';
import type { RequestOptions } from './types.js';
/** Options accepted by webhook operations. */
export interface WebhookOptions extends RequestOptions {
}
/**
 * Webhook manager for FileMaker Server webhook CRUD.
 *
 * Obtain an instance via `db.webhooks()` or use the convenience methods on
 * `FMSOData` (`db.createWebhook`, `db.removeWebhook`, etc.).
 *
 * Requires FileMaker Server 2023+ (v21).
 */
export declare class WebhookManager {
    /** @internal */ readonly _client: FMSOData;
    constructor(client: FMSOData);
    /** Build the URL for a webhook operation. */
    private _url;
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
    create(params: WebhookCreateParams, opts?: WebhookOptions): Promise<unknown>;
    /**
     * Remove (delete) a webhook by its ID.
     *
     * ```ts
     * await db.webhooks().remove('abc123')
     * ```
     */
    remove(id: string, opts?: WebhookOptions): Promise<unknown>;
    /**
     * Get a specific webhook's data by ID.
     *
     * ```ts
     * const data = await db.webhooks().get('abc123')
     * ```
     */
    get(id: string, opts?: WebhookOptions): Promise<WebhookData | unknown>;
    /**
     * List all webhooks.
     *
     * ```ts
     * const result = await db.webhooks().getAll()
     * ```
     */
    getAll(opts?: WebhookOptions): Promise<unknown>;
    /**
     * Manually invoke (trigger) a webhook by ID. Useful for testing.
     *
     * ```ts
     * await db.webhooks().invoke('abc123')
     * ```
     */
    invoke(id: string, opts?: WebhookOptions): Promise<unknown>;
}
//# sourceMappingURL=webhooks.d.ts.map