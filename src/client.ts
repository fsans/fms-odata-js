import { Batch } from './batch.js'
import { executeJson, executeRequest, type HttpClientContext, type HttpRequestOptions } from './http.js'
import { MetadataFetcher, type MetadataOptions, type ODataMetadata } from './metadata.js'
import { Query } from './query.js'
import { runScriptAtDatabase, runScriptByIdAtDatabase, type ScriptOptions, type ScriptResult } from './scripts.js'
import type { FMODataOptions, RequestOptions } from './types.js'
import {
  type FMVersionMajor,
  type FMVersionInfo,
  type FMFeatureFlags,
  FM_VERSION_MATRIX,
  hasFeature as specHasFeature,
} from '@fm-odata/spec-ts'

/**
 * `FMOData` is the entrypoint for all OData operations against a FileMaker
 * Server database. Covers query/CRUD, script invocation, container I/O,
 * `$metadata` introspection, and `$batch` operations.
 */
export class FMOData {
  readonly host: string
  readonly database: string
  readonly baseUrl: string
  readonly timeoutMs: number | undefined

  /** @internal */ readonly _ctx: HttpClientContext
  /** @internal */ private _metadataFetcher?: MetadataFetcher

  constructor(options: FMODataOptions) {
    if (!options.host) throw new TypeError('FMOData: `host` is required')
    if (!options.database) throw new TypeError('FMOData: `database` is required')
    if (options.token === undefined || options.token === null) {
      throw new TypeError('FMOData: `token` is required')
    }

    this.host = options.host.replace(/\/+$/, '')
    this.database = options.database
    this.baseUrl = `${this.host}/fmi/odata/v4/${encodeURIComponent(this.database)}`
    this.timeoutMs = options.timeoutMs

    this._ctx = {
      token: options.token,
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
      timeoutMs: options.timeoutMs,
      ...(options.onUnauthorized ? { onUnauthorized: options.onUnauthorized } : {}),
    }
  }

  /**
   * Start a query against the given entity set (FileMaker layout name).
   */
  from<T = Record<string, unknown>>(entitySet: string): Query<T> {
    if (!entitySet) throw new TypeError('FMOData#from: entitySet is required')
    return new Query<T>(this.baseUrl, entitySet, this)
  }

  /**
   * Low-level escape hatch: execute a raw request against a path relative to
   * the database base URL (or an absolute URL). Returns the parsed JSON body.
   *
   * @example
   * ```ts
   * const body = await db.request<{ value: unknown[] }>('/contact?$top=1')
   * ```
   */
  async request<T = unknown>(pathOrUrl: string, opts: HttpRequestOptions = {}): Promise<T> {
    return executeJson<T>(this._ctx, this._resolveUrl(pathOrUrl), opts)
  }

  /**
   * Low-level escape hatch: execute a raw request and return the `Response`
   * object directly (useful for binary / streaming responses).
   */
  async rawRequest(pathOrUrl: string, opts: HttpRequestOptions = {}): Promise<Response> {
    return executeRequest(this._ctx, this._resolveUrl(pathOrUrl), opts)
  }

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
  async script(name: string, opts: ScriptOptions = {}): Promise<ScriptResult> {
    return runScriptAtDatabase(this, name, opts)
  }

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
  async scriptById(fmsid: number, opts: ScriptOptions = {}): Promise<ScriptResult> {
    return runScriptByIdAtDatabase(this, fmsid, opts)
  }

  /**
   * Fetch the OData CSDL `$metadata` XML and parse it into a typed structure.
   * Results are cached; pass `refresh: true` to force a refetch.
   *
   * ```ts
   * const meta = await db.metadata()
   * console.log(meta.entitySets.map(es => es.name))
   * ```
   */
  async metadata(opts: MetadataOptions = {}): Promise<ODataMetadata> {
    if (!this._metadataFetcher) {
      this._metadataFetcher = new MetadataFetcher(this._ctx, this.baseUrl)
    }
    return this._metadataFetcher.fetch(opts)
  }

  /**
   * Fetch the raw `$metadata` XML (escape hatch for debugging or custom parsing).
   */
  async metadataXml(opts: RequestOptions = {}): Promise<string> {
    if (!this._metadataFetcher) {
      this._metadataFetcher = new MetadataFetcher(this._ctx, this.baseUrl)
    }
    return this._metadataFetcher.fetchXml(opts)
  }

  // -------------------------------------------------------------------------
  // Version detection & feature gating (Phase 2 — spec alignment)
  // -------------------------------------------------------------------------

  /** @internal */ private _detectedVersion: FMVersionMajor | null | undefined

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
  async version(): Promise<FMVersionMajor | null> {
    if (this._detectedVersion !== undefined) return this._detectedVersion
    try {
      const meta = await this.metadata()
      const raw = meta.productVersion
      if (!raw) {
        this._detectedVersion = null
        return null
      }
      const match = raw.match(/^(\d+)\./)
      if (!match) {
        this._detectedVersion = null
        return null
      }
      const major = match[1] as FMVersionMajor
      // If the version is known in the spec matrix, use it; otherwise 'future'.
      this._detectedVersion = major in FM_VERSION_MATRIX ? major : 'future'
      return this._detectedVersion
    } catch {
      this._detectedVersion = null
      return null
    }
  }

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
  async versionInfo(): Promise<FMVersionInfo | null> {
    const v = await this.version()
    if (!v) return null
    return FM_VERSION_MATRIX[v]
  }

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
  async hasFeature(feature: keyof FMFeatureFlags): Promise<boolean> {
    const v = await this.version()
    if (!v) return false
    return specHasFeature(v, feature)
  }

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
  batch(): Batch {
    return new Batch(this)
  }

  /** @internal */
  _resolveUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
    if (pathOrUrl.startsWith('/')) return `${this.baseUrl}${pathOrUrl}`
    return `${this.baseUrl}/${pathOrUrl}`
  }
}

// Re-export for ergonomic imports in callers (`import { RequestOptions } …`).
export type { RequestOptions }
