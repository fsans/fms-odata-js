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
 * Requires FileMaker Server 2025+ (v22).
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
    create(params: WebhookCreateParams, opts?: WebhookOptions): Promise<{
        id: string;
    }>;
    /**
     * Delete a webhook by its ID.
     *
     * ```ts
     * await db.webhooks().remove('1')
     * ```
     */
    remove(id: string | number, opts?: WebhookOptions): Promise<unknown>;
    /** Alias for {@link remove} (matches the FMS endpoint name `Webhook.Delete`). */
    delete(id: string | number, opts?: WebhookOptions): Promise<unknown>;
    /**
     * Get a specific webhook's data by ID.
     *
     * ```ts
     * const data = await db.webhooks().get('1')
     * ```
     */
    get(id: string | number, opts?: WebhookOptions): Promise<WebhookData | unknown>;
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
     * Optionally pass `rowIDs` to target specific records; if omitted, FMS
     * triggers the webhook for all pending records.
     *
     * ```ts
     * await db.webhooks().invoke('1')
     * await db.webhooks().invoke('1', { rowIDs: [10, 20] })
     * ```
     */
    invoke(id: string | number, opts?: WebhookOptions & {
        rowIDs?: ReadonlyArray<string | number>;
    }): Promise<unknown>;
}
//# sourceMappingURL=webhooks.d.ts.map