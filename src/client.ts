import { Batch } from './batch.js'
import { executeJson, executeRequest, type HttpClientContext, type HttpRequestOptions } from './http.js'
import { MetadataFetcher, type MetadataOptions, type ODataMetadata } from './metadata.js'
import { Query } from './query.js'
import { runScriptAtDatabase, type ScriptOptions, type ScriptResult } from './scripts.js'
import type { FMODataOptions, RequestOptions } from './types.js'

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
