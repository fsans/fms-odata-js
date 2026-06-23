/**
 * Single-entity handle returned by `Query#byKey(key)`. Supports `.get()`,
 * `.patch()`, `.delete()`, `.script()` (record-scope FileMaker script
 * invocation, v0.1.4+), and `.container(field)` (container-field binary
 * I/O, v0.1.5+).
 */
import type { FMSOData } from './client.js';
import { ContainerRef, type ContainerJsonValue } from './containers.js';
import { type ScriptOptions, type ScriptResult } from './scripts.js';
import type { RequestOptions } from './types.js';
import { type ODataLiteral } from './url.js';
/** Options accepted by mutating entity operations. */
export interface EntityWriteOptions extends RequestOptions {
    /**
     * Optional `If-Match` precondition. Pass an ETag returned from a prior read
     * to enable optimistic concurrency.
     */
    ifMatch?: string;
    /**
     * Whether the server should return the updated representation. Defaults to
     * `false` (`Prefer: return=minimal`) to match FMS behaviour; set to `true`
     * to request `Prefer: return=representation`.
     */
    returnRepresentation?: boolean;
}
/**
 * Handle to a single OData entity. Holds the client, entity-set name, and the
 * primary key; every method builds a URL of the form
 * `<baseUrl>/<EntitySet>(<key>)` and delegates to the shared HTTP executor.
 */
export declare class EntityRef<T = Record<string, unknown>> {
    readonly entitySet: string;
    readonly key: ODataLiteral;
    /** @internal */ readonly _client: FMSOData;
    constructor(client: FMSOData, entitySet: string, key: ODataLiteral);
    /** Absolute URL for this entity. */
    toURL(): string;
    /** `GET` the entity. Returns the parsed JSON row. */
    get(opts?: RequestOptions): Promise<T>;
    /**
     * `GET` a single field's scalar value via the OData property URL
     * (`…/<EntitySet>(<key>)/<fieldName>`). FMS responds with the JSON envelope
     * `{ value: … }`; this method unwraps it and returns just the value.
     *
     * Useful when you only need one column without composing a `$select` query.
     * For container fields use `container(name).get()` instead.
     */
    fieldValue<V = unknown>(fieldName: string, opts?: RequestOptions): Promise<V>;
    /**
     * `PATCH` the entity with partial values. Returns the updated row when the
     * server echoes one (OData `Prefer: return=representation`), otherwise
     * `undefined` on `204 No Content`.
     */
    patch(body: Partial<T> | Record<string, unknown>, opts?: EntityWriteOptions): Promise<T | undefined>;
    /** `DELETE` the entity. Resolves on success; throws `FMSODataError` otherwise. */
    delete(opts?: EntityWriteOptions): Promise<void>;
    /**
     * Invoke a FileMaker script in the context of this single record. FMS sets
     * the script's current record to this entity before running it.
     */
    script(name: string, opts?: ScriptOptions): Promise<ScriptResult>;
    /**
     * Get a typed handle to one of this record's container fields, exposing
     * `.get()`, `.getStream()`, `.upload(...)`, and `.delete()`.
     */
    container(fieldName: string): ContainerRef;
    /**
     * Update one or more container fields (and optionally regular fields) on
     * this record in a single base64 PATCH request. This maps to the Claris
     * "Operation 3" (`PATCH /<EntitySet>(<key>)` with JSON body containing
     * `<field>`, `<field>@com.filemaker.odata.ContentType`, and
     * `<field>@com.filemaker.odata.Filename`).
     *
     * Each container value's `data` must already be base64-encoded (use the
     * library's exported `toBase64()` helper or `Buffer.from(bytes).toString('base64')`).
     *
     * @example
     * await db.from('contact').byKey(7).patchContainers(
     *   {
     *     photo:    { data: photoB64,    contentType: 'image/png',       filename: 'p.png' },
     *     contract: { data: contractB64, contentType: 'application/pdf', filename: 'c.pdf' },
     *   },
     *   { website: 'https://example.com' },
     * )
     */
    patchContainers(containers: Record<string, ContainerJsonValue>, regularFields?: Record<string, unknown>, opts?: EntityWriteOptions): Promise<void>;
    /**
     * Get the references for a navigation property on this record.
     *
     * `GET /<EntitySet>(<key>)/<navProperty>/$ref`
     *
     * Returns an array of entity references. For a single-valued navigation
     * property, the array has at most one element.
     *
     * @example
     * ```ts
     * const refs = await db.from('contact').byKey(7).getRefs('addresses')
     * // [{ '@odata.id': 'https://fms.example.com/fmi/odata/v4/DB/address(1)' }, ...]
     * ```
     */
    getRefs(navProperty: string, opts?: RequestOptions): Promise<EntityRefInfo[]>;
    /**
     * Add a reference to a related record via a navigation property.
     *
     * `POST /<EntitySet>(<key>)/<navProperty>/$ref`
     *
     * For single-valued navigation properties, use `setRef()` instead (PATCH).
     *
     * @example
     * ```ts
     * await db.from('contact').byKey(7).addRef('addresses', 42)
     * ```
     */
    addRef(navProperty: string, relatedKey: string | number, opts?: EntityWriteOptions): Promise<void>;
    /**
     * Set (replace) the reference for a single-valued navigation property.
     *
     * `PATCH /<EntitySet>(<key>)/<navProperty>/$ref`
     *
     * @example
     * ```ts
     * await db.from('order').byKey(100).setRef('customer', 7)
     * ```
     */
    setRef(navProperty: string, relatedKey: string | number, opts?: EntityWriteOptions): Promise<void>;
    /**
     * Remove a reference from a navigation property.
     *
     * `DELETE /<EntitySet>(<key>)/<navProperty>/$ref`
     *
     * For collection-valued navigation properties, pass the `relatedKey` to
     * remove a specific reference. For single-valued, omit `relatedKey` to
     * clear the reference.
     *
     * @example
     * ```ts
     * await db.from('contact').byKey(7).removeRef('addresses', 42)
     * await db.from('order').byKey(100).removeRef('customer')
     * ```
     */
    removeRef(navProperty: string, relatedKey?: string | number, opts?: EntityWriteOptions): Promise<void>;
    /** @internal — build a relative @odata.id for a related entity. */
    private _refId;
}
/** Entity reference info returned by `getRefs()`. */
export interface EntityRefInfo {
    '@odata.id': string;
}
//# sourceMappingURL=entity.d.ts.map