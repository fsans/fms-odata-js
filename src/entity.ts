/**
 * Single-entity handle returned by `Query#byKey(key)`. Supports `.get()`,
 * `.patch()`, `.delete()`, `.script()` (record-scope FileMaker script
 * invocation, v0.1.4+), and `.container(field)` (container-field binary
 * I/O, v0.1.5+).
 */

import type { FMSOData } from './client.js'
import {
  buildContainerJsonBody,
  ContainerRef,
  type ContainerJsonValue,
} from './containers.js'
import { executeJson, executeRequest } from './http.js'
import { runScriptAtEntity, type ScriptOptions, type ScriptResult } from './scripts.js'
import type { RequestOptions } from './types.js'
import {
  encodePathSegment,
  escapeStringLiteral,
  type ODataLiteral,
} from './url.js'

/** Options accepted by mutating entity operations. */
export interface EntityWriteOptions extends RequestOptions {
  /**
   * Optional `If-Match` precondition. Pass an ETag returned from a prior read
   * to enable optimistic concurrency.
   */
  ifMatch?: string
  /**
   * Whether the server should return the updated representation. Defaults to
   * `false` (`Prefer: return=minimal`) to match FMS behaviour; set to `true`
   * to request `Prefer: return=representation`.
   */
  returnRepresentation?: boolean
}

/**
 * Format an OData primary-key literal for embedding in a URL path
 * (`EntitySet(<key>)`).
 */
function formatKey(key: ODataLiteral): string {
  if (typeof key === 'number') {
    if (!Number.isFinite(key)) {
      throw new TypeError('EntityRef: key must be a finite number')
    }
    return String(key)
  }
  if (typeof key === 'string') return `'${escapeStringLiteral(key)}'`
  if (typeof key === 'boolean') return key ? 'true' : 'false'
  throw new TypeError('EntityRef: unsupported key type')
}

/**
 * Handle to a single OData entity. Holds the client, entity-set name, and the
 * primary key; every method builds a URL of the form
 * `<baseUrl>/<EntitySet>(<key>)` and delegates to the shared HTTP executor.
 */
export class EntityRef<T = Record<string, unknown>> {
  readonly entitySet: string
  readonly key: ODataLiteral

  /** @internal */ readonly _client: FMSOData

  constructor(client: FMSOData, entitySet: string, key: ODataLiteral) {
    this._client = client
    this.entitySet = entitySet
    this.key = key
  }

  /** Absolute URL for this entity. */
  toURL(): string {
    return `${this._client.baseUrl}/${encodePathSegment(this.entitySet)}(${formatKey(this.key)})`
  }

  /** `GET` the entity. Returns the parsed JSON row. */
  async get(opts: RequestOptions = {}): Promise<T> {
    const json = await executeJson<T>(this._client._ctx, this.toURL(), {
      method: 'GET',
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    return json
  }

  /**
   * `GET` a single field's scalar value via the OData property URL
   * (`…/<EntitySet>(<key>)/<fieldName>`). FMS responds with the JSON envelope
   * `{ value: … }`; this method unwraps it and returns just the value.
   *
   * Useful when you only need one column without composing a `$select` query.
   * For container fields use `container(name).get()` instead.
   */
  async fieldValue<V = unknown>(fieldName: string, opts: RequestOptions = {}): Promise<V> {
    const url = `${this.toURL()}/${encodePathSegment(fieldName)}`
    const json = await executeJson<{ value: V }>(this._client._ctx, url, {
      method: 'GET',
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    return json.value
  }

  /**
   * `PATCH` the entity with partial values. Returns the updated row when the
   * server echoes one (OData `Prefer: return=representation`), otherwise
   * `undefined` on `204 No Content`.
   */
  async patch(
    body: Partial<T> | Record<string, unknown>,
    opts: EntityWriteOptions = {},
  ): Promise<T | undefined> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Prefer: opts.returnRepresentation ? 'return=representation' : 'return=minimal',
    }
    if (opts.ifMatch) headers['If-Match'] = opts.ifMatch

    const json = await executeJson<T | undefined>(this._client._ctx, this.toURL(), {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    return json
  }

  /** `DELETE` the entity. Resolves on success; throws `FMSODataError` otherwise. */
  async delete(opts: EntityWriteOptions = {}): Promise<void> {
    const headers: Record<string, string> = {}
    if (opts.ifMatch) headers['If-Match'] = opts.ifMatch

    await executeRequest(this._client._ctx, this.toURL(), {
      method: 'DELETE',
      headers,
      accept: 'none',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  /**
   * Invoke a FileMaker script in the context of this single record. FMS sets
   * the script's current record to this entity before running it.
   */
  async script(name: string, opts: ScriptOptions = {}): Promise<ScriptResult> {
    return runScriptAtEntity(this._client, this.entitySet, this.key, name, opts)
  }

  /**
   * Get a typed handle to one of this record's container fields, exposing
   * `.get()`, `.getStream()`, `.upload(...)`, and `.delete()`.
   */
  container(fieldName: string): ContainerRef {
    return new ContainerRef(this as EntityRef<unknown>, fieldName)
  }

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
  async patchContainers(
    containers: Record<string, ContainerJsonValue>,
    regularFields: Record<string, unknown> = {},
    opts: EntityWriteOptions = {},
  ): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Prefer: opts.returnRepresentation ? 'return=representation' : 'return=minimal',
    }
    if (opts.ifMatch) headers['If-Match'] = opts.ifMatch

    const body = buildContainerJsonBody(containers, regularFields)
    await executeRequest(this._client._ctx, this.toURL(), {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
      accept: 'none',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  // -------------------------------------------------------------------------
  // Record references ($ref) — OData standard, supported since FMS 19
  // -------------------------------------------------------------------------

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
  async getRefs(navProperty: string, opts: RequestOptions = {}): Promise<EntityRefInfo[]> {
    const url = `${this.toURL()}/${encodePathSegment(navProperty)}/$ref`
    const json = await executeJson<{ value?: EntityRefInfo[]; '@odata.id'?: string }>(
      this._client._ctx,
      url,
      {
        method: 'GET',
        accept: 'json',
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    )
    // Single-valued nav properties return { "@odata.id": "..." } directly;
    // collection nav properties return { value: [{ "@odata.id": "..." }, ...] }
    if (json?.value) return json.value
    if (json?.['@odata.id']) return [json as EntityRefInfo]
    return []
  }

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
  async addRef(navProperty: string, relatedKey: string | number, opts: EntityWriteOptions = {}): Promise<void> {
    const url = `${this.toURL()}/${encodePathSegment(navProperty)}/$ref`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (opts.ifMatch) headers['If-Match'] = opts.ifMatch

    const body = JSON.stringify({ '@odata.id': this._refId(navProperty, relatedKey) })
    await executeRequest(this._client._ctx, url, {
      method: 'POST',
      headers,
      body,
      accept: 'none',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

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
  async setRef(navProperty: string, relatedKey: string | number, opts: EntityWriteOptions = {}): Promise<void> {
    const url = `${this.toURL()}/${encodePathSegment(navProperty)}/$ref`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (opts.ifMatch) headers['If-Match'] = opts.ifMatch

    const body = JSON.stringify({ '@odata.id': this._refId(navProperty, relatedKey) })
    await executeRequest(this._client._ctx, url, {
      method: 'PATCH',
      headers,
      body,
      accept: 'none',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

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
  async removeRef(navProperty: string, relatedKey?: string | number, opts: EntityWriteOptions = {}): Promise<void> {
    let url = `${this.toURL()}/${encodePathSegment(navProperty)}/$ref`
    const headers: Record<string, string> = {}
    if (opts.ifMatch) headers['If-Match'] = opts.ifMatch

    if (relatedKey !== undefined) {
      // For collection nav properties, target the specific reference by ID
      url += `('${escapeStringLiteral(this._refId(navProperty, relatedKey))}')`
    }

    await executeRequest(this._client._ctx, url, {
      method: 'DELETE',
      headers,
      accept: 'none',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  /** @internal — build a relative @odata.id for a related entity. */
  private _refId(navProperty: string, relatedKey: string | number): string {
    // The @odata.id can be a relative URL or a full URL. We use a relative
    // form that's portable across deployments: just the entity set name and key.
    // FMS resolves this relative to the service root.
    const navSet = navProperty // The navigation property name typically matches the target entity set
    if (typeof relatedKey === 'number') return `${navSet}(${relatedKey})`
    return `${navSet}('${escapeStringLiteral(relatedKey)}')`
  }
}

/** Entity reference info returned by `getRefs()`. */
export interface EntityRefInfo {
  '@odata.id': string
}

