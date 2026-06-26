import { Batch } from './batch.js'
import { executeJson, executeRequest, type HttpClientContext, type HttpRequestOptions } from './http.js'
import { MetadataFetcher, type MetadataOptions, type ODataMetadata } from './metadata.js'
import { Query } from './query.js'
import { SchemaEditor, type DeleteSchemaOptions, type SchemaOptions } from './schema.js'
import { runScriptAtDatabase, runScriptByIdAtDatabase, type ScriptOptions, type ScriptResult } from './scripts.js'
import type { FMSODataOptions, RequestOptions } from './types.js'
import {
  type FMVersionMajor,
  type FMVersionInfo,
  type FMFeatureFlags,
  type FMServerVersion,
  FM_VERSION_MATRIX,
  hasFeature as specHasFeature,
} from '@fms-odata/spec-ts'

/**
 * `FMSOData` is the entrypoint for all OData operations against a FileMaker
 * Server database. Covers query/CRUD, script invocation, container I/O,
 * `$metadata` introspection, and `$batch` operations.
 */
export class FMSOData {
  readonly host: string
  readonly database: string
  readonly baseUrl: string
  readonly timeoutMs: number | undefined

  /** @internal */ readonly _ctx: HttpClientContext
  /** @internal */ private _metadataFetcher?: MetadataFetcher

  constructor(options: FMSODataOptions) {
    if (!options.host) throw new TypeError('FMSOData: `host` is required')
    if (!options.database) throw new TypeError('FMSOData: `database` is required')
    if (options.token === undefined || options.token === null) {
      throw new TypeError('FMSOData: `token` is required')
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
    if (!entitySet) throw new TypeError('FMSOData#from: entitySet is required')
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
  /** @internal */ private _detectedServerVersion: FMServerVersion | null | undefined

  /**
   * Detect the FileMaker Server major version by fetching `$metadata` and
   * parsing the version annotation using a multi-strategy approach (see
   * `@fms-odata/spec-ts` `parseServerVersion`). The result is cached for the
   * lifetime of this `FMSOData` instance.
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
      const sv = await this.serverVersion()
      if (!sv) {
        this._detectedVersion = null
        return null
      }
      const major = String(sv.major) as FMVersionMajor
      // If the version is known in the spec matrix, use it; otherwise 'future'.
      this._detectedVersion = major in FM_VERSION_MATRIX ? major : 'future'
      return this._detectedVersion
    } catch {
      this._detectedVersion = null
      return null
    }
  }

  /**
   * Get the full parsed FileMaker Server version (major, minor, patch, raw)
   * by fetching `$metadata` and parsing the version annotation. The result is
   * cached for the lifetime of this `FMSOData` instance.
   *
   * Returns `null` if the version cannot be determined.
   *
   * ```ts
   * const sv = await db.serverVersion()
   * if (sv) console.log(`Server is ${sv.raw} (major ${sv.major})`)
   * ```
   */
  async serverVersion(): Promise<FMServerVersion | null> {
    if (this._detectedServerVersion !== undefined) return this._detectedServerVersion
    try {
      const meta = await this.metadata()
      this._detectedServerVersion = meta.serverVersion ?? null
      return this._detectedServerVersion
    } catch {
      this._detectedServerVersion = null
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

  // -------------------------------------------------------------------------
  // Schema modification (DDL)
  // -------------------------------------------------------------------------

  /** @internal */ private _schemaEditor?: SchemaEditor

  /**
   * Get a `SchemaEditor` handle for DDL operations (create/delete tables,
   * add/delete fields, create/delete indexes). Requires a FileMaker account
   * with full access privileges.
   *
   * ```ts
   * await db.schema().createTable({ tableName: 'Company', fields: [...] })
   * ```
   */
  schema(): SchemaEditor {
    if (!this._schemaEditor) this._schemaEditor = new SchemaEditor(this)
    return this._schemaEditor
  }

  /** Convenience: create a table. See {@link SchemaEditor#createTable}. */
  async createTable(
    params: import('@fms-odata/spec-ts').CreateTableParams,
    opts: SchemaOptions = {},
  ): Promise<unknown> {
    return this.schema().createTable(params, opts)
  }

  /** Convenience: add fields to a table. See {@link SchemaEditor#addFields}. */
  async addFields(
    params: import('@fms-odata/spec-ts').AddFieldsParams,
    opts: SchemaOptions = {},
  ): Promise<unknown> {
    return this.schema().addFields(params, opts)
  }

  /** Convenience: delete a table (requires `confirm: true`). See {@link SchemaEditor#deleteTable}. */
  async deleteTable(tableName: string, opts: DeleteSchemaOptions): Promise<void> {
    return this.schema().deleteTable(tableName, opts)
  }

  /** Convenience: delete a field (requires `confirm: true`). See {@link SchemaEditor#deleteField}. */
  async deleteField(
    tableName: string,
    fieldName: string,
    opts: DeleteSchemaOptions,
  ): Promise<void> {
    return this.schema().deleteField(tableName, fieldName, opts)
  }

  /** Convenience: create an index. See {@link SchemaEditor#createIndex}. */
  async createIndex(
    tableName: string,
    fieldName: string,
    opts: SchemaOptions = {},
  ): Promise<unknown> {
    return this.schema().createIndex(tableName, fieldName, opts)
  }

  /** Convenience: delete an index. See {@link SchemaEditor#deleteIndex}. */
  async deleteIndex(
    tableName: string,
    fieldName: string,
    opts: SchemaOptions = {},
  ): Promise<void> {
    return this.schema().deleteIndex(tableName, fieldName, opts)
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
