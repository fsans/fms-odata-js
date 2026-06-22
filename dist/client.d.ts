import { Batch } from './batch.js';
import { type HttpClientContext, type HttpRequestOptions } from './http.js';
import { type MetadataOptions, type ODataMetadata } from './metadata.js';
import { Query } from './query.js';
import { type ScriptOptions, type ScriptResult } from './scripts.js';
import type { FMODataOptions, RequestOptions } from './types.js';
import { type FMVersionMajor, type FMVersionInfo, type FMFeatureFlags } from '@fm-odata/spec-ts';
/**
 * `FMOData` is the entrypoint for all OData operations against a FileMaker
 * Server database. Covers query/CRUD, script invocation, container I/O,
 * `$metadata` introspection, and `$batch` operations.
 */
export declare class FMOData {
    readonly host: string;
    readonly database: string;
    readonly baseUrl: string;
    readonly timeoutMs: number | undefined;
    /** @internal */ readonly _ctx: HttpClientContext;
    /** @internal */ private _metadataFetcher?;
    constructor(options: FMODataOptions);
    /**
     * Start a query against the given entity set (FileMaker layout name).
     */
    from<T = Record<string, unknown>>(entitySet: string): Query<T>;
    /**
     * Low-level escape hatch: execute a raw request against a path relative to
     * the database base URL (or an absolute URL). Returns the parsed JSON body.
     *
     * @example
     * ```ts
     * const body = await db.request<{ value: unknown[] }>('/contact?$top=1')
     * ```
     */
    request<T = unknown>(pathOrUrl: string, opts?: HttpRequestOptions): Promise<T>;
    /**
     * Low-level escape hatch: execute a raw request and return the `Response`
     * object directly (useful for binary / streaming responses).
     */
    rawRequest(pathOrUrl: string, opts?: HttpRequestOptions): Promise<Response>;
    /**
     * Invoke a FileMaker script at database scope.
     *
     * ```ts
     * const result = await db.script('Ping', { parameter: 'hello' })
     * console.log(result.scriptResult) // => string value returned by the script
     * ```
     *
     * A non-zero `scriptError` is thrown as `FMScriptError`.
     */
    script(name: string, opts?: ScriptOptions): Promise<ScriptResult>;
    /**
     * Invoke a FileMaker script by its immutable FMSID.
     *
     * Requires FileMaker Server 2026+ (v26). Use `hasFeature('scriptsByFMSID')`
     * to check before calling. FMSID-based invocation is more stable than
     * name-based: it survives script renames and works across database
     * migrations.
     *
     * ```ts
     * const result = await db.scriptById(42, { parameter: 'hello' })
     * ```
     */
    scriptById(fmsid: number, opts?: ScriptOptions): Promise<ScriptResult>;
    /**
     * Fetch the OData CSDL `$metadata` XML and parse it into a typed structure.
     * Results are cached; pass `refresh: true` to force a refetch.
     *
     * ```ts
     * const meta = await db.metadata()
     * console.log(meta.entitySets.map(es => es.name))
     * ```
     */
    metadata(opts?: MetadataOptions): Promise<ODataMetadata>;
    /**
     * Fetch the raw `$metadata` XML (escape hatch for debugging or custom parsing).
     */
    metadataXml(opts?: RequestOptions): Promise<string>;
    /** @internal */ private _detectedVersion;
    /**
     * Detect the FileMaker Server major version by fetching `$metadata` and
     * extracting the `Org.OData.Core.V1.ProductVersion` annotation. The result
     * is cached for the lifetime of this `FMOData` instance.
     *
     * Returns the major version string (`'19'`, `'21'`, `'22'`, `'26'`) or
     * `'future'` if the version is newer than the spec knows about. Returns
     * `null` if the version cannot be determined (e.g. the metadata lacks the
     * annotation).
     *
     * ```ts
     * const v = await db.version()
     * if (v === '26') console.log('Server is FileMaker 2026')
     * ```
     */
    version(): Promise<FMVersionMajor | null>;
    /**
     * Get the full version info (feature flags + query option flags) for the
     * detected server version. Fetches metadata if not already cached.
     *
     * Returns `null` if the version cannot be determined.
     *
     * ```ts
     * const info = await db.versionInfo()
     * if (info?.features.applyAggregation) {
     *   // Server supports $apply
     * }
     * ```
     */
    versionInfo(): Promise<FMVersionInfo | null>;
    /**
     * Check if the server supports a specific feature. Fetches metadata (to
     * detect the version) on first call; subsequent calls use the cached result.
     *
     * Returns `false` if the version cannot be determined.
     *
     * ```ts
     * if (await db.hasFeature('applyAggregation')) {
     *   const result = await db.from('orders').apply(...)
     * }
     * ```
     */
    hasFeature(feature: keyof FMFeatureFlags): Promise<boolean>;
    /**
     * Create a new `$batch` builder for composing multiple OData operations
     * into a single HTTP round-trip.
     *
     * Read operations (`add`) are executed independently. Write operations
     * (`changeset`) are grouped atomically — all succeed or all fail.
     *
     * ```ts
     * const batch = db.batch()
     * const contacts = batch.add({ op: 'list', entitySet: 'contact', query: { $top: 5 } })
     * batch.changeset(cs => {
     *   cs.create('contact', { firstName: 'A', lastName: 'B' })
     *   cs.patch('contact', 123, { firstName: 'Updated' })
     * })
     * const result = await batch.send()
     * console.log(await contacts._promise) // First op result
     * ```
     */
    batch(): Batch;
    /** @internal */
    _resolveUrl(pathOrUrl: string): string;
}
export type { RequestOptions };
//# sourceMappingURL=client.d.ts.map