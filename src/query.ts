/**
 * Fluent OData query builder.
 *
 * `Query` accumulates `$select`, `$filter`, `$expand`, `$orderby`, `$top`,
 * `$skip`, `$count`, and `$search` options and serializes them into an absolute
 * URL via `toURL()`. Actual HTTP execution (`.get()`) lands in M3 alongside
 * auth, error handling, and the mock server.
 */

import type { FMSOData } from './client.js'
import {
  buildContainerJsonBody,
  type ContainerJsonValue,
} from './containers.js'
import { EntityRef } from './entity.js'
import { executeJson } from './http.js'
import { runScriptAtEntitySet, type ScriptOptions, type ScriptResult } from './scripts.js'
import type { RequestOptions } from './types.js'
import {
  buildQueryString,
  encodePathSegment,
  formatLiteral,
  type ODataLiteral,
} from './url.js'
import type { AggregateFunction } from '@fms-odata/spec-ts'

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/**
 * Opaque filter expression produced by `filterFactory`. Use `.and()`, `.or()`,
 * `.not()` to compose; pass to `Query#filter`.
 */
export class Filter {
  constructor(readonly expr: string) {}

  toString(): string {
    return this.expr
  }

  and(other: Filter | string): Filter {
    return new Filter(`(${this.expr}) and (${Filter.coerce(other)})`)
  }

  or(other: Filter | string): Filter {
    return new Filter(`(${this.expr}) or (${Filter.coerce(other)})`)
  }

  not(): Filter {
    return new Filter(`not (${this.expr})`)
  }

  /** @internal */
  static coerce(x: Filter | string): string {
    return x instanceof Filter ? x.expr : x
  }
}

/** Factory passed to callback-form `Query#filter(f => ...)`. */
export interface FilterFactory {
  eq(field: string, value: ODataLiteral): Filter
  ne(field: string, value: ODataLiteral): Filter
  gt(field: string, value: ODataLiteral): Filter
  ge(field: string, value: ODataLiteral): Filter
  lt(field: string, value: ODataLiteral): Filter
  le(field: string, value: ODataLiteral): Filter
  startswith(field: string, value: string): Filter
  endswith(field: string, value: string): Filter
  contains(field: string, value: string): Filter
  and(a: Filter | string, b: Filter | string): Filter
  or(a: Filter | string, b: Filter | string): Filter
  not(a: Filter | string): Filter
  /** Escape hatch: embed a raw OData filter fragment verbatim. */
  raw(expr: string): Filter
}

export const filterFactory: FilterFactory = {
  eq: (f, v) => new Filter(`${f} eq ${formatLiteral(v)}`),
  ne: (f, v) => new Filter(`${f} ne ${formatLiteral(v)}`),
  gt: (f, v) => new Filter(`${f} gt ${formatLiteral(v)}`),
  ge: (f, v) => new Filter(`${f} ge ${formatLiteral(v)}`),
  lt: (f, v) => new Filter(`${f} lt ${formatLiteral(v)}`),
  le: (f, v) => new Filter(`${f} le ${formatLiteral(v)}`),
  startswith: (f, v) => new Filter(`startswith(${f},${formatLiteral(v)})`),
  endswith: (f, v) => new Filter(`endswith(${f},${formatLiteral(v)})`),
  contains: (f, v) => new Filter(`contains(${f},${formatLiteral(v)})`),
  and: (a, b) => new Filter(`(${Filter.coerce(a)}) and (${Filter.coerce(b)})`),
  or: (a, b) => new Filter(`(${Filter.coerce(a)}) or (${Filter.coerce(b)})`),
  not: (a) => new Filter(`not (${Filter.coerce(a)})`),
  raw: (s) => new Filter(s),
}

export type FilterInput =
  | Filter
  | string
  | ((f: FilterFactory) => Filter | string)

function resolveFilter(input: FilterInput): string {
  if (typeof input === 'function') return Filter.coerce(input(filterFactory))
  return Filter.coerce(input)
}

// ---------------------------------------------------------------------------
// Query state
// ---------------------------------------------------------------------------

export type OrderDir = 'asc' | 'desc'

/** @internal */
export interface QueryOptionsState {
  select?: string[]
  filter?: string
  expand?: Array<{ name: string; options?: QueryOptionsState }>
  orderby?: Array<{ field: string; dir: OrderDir }>
  top?: number
  skip?: number
  count?: boolean
  search?: string
  apply?: string
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

/**
 * Fluent query builder. Methods mutate and return `this` for chaining.
 */
/** Result envelope returned by `Query#get()`. */
export interface QueryResult<T> {
  value: T[]
  /** Present when `.count()` was enabled on the query. */
  count?: number
  /** Server-driven paging link. */
  nextLink?: string
}

export class Query<T = Record<string, unknown>> {
  /** @internal */ readonly _state: QueryOptionsState = {}
  /** @internal */ readonly _baseUrl: string
  /** @internal */ readonly _entitySet: string
  /** @internal */ readonly _client: FMSOData | undefined

  constructor(baseUrl: string, entitySet: string, client?: FMSOData) {
    this._baseUrl = baseUrl
    this._entitySet = entitySet
    if (client) this._client = client
  }

  select(...fields: string[]): this {
    this._state.select = [...(this._state.select ?? []), ...fields]
    return this
  }

  filter(input: FilterInput): this {
    const expr = resolveFilter(input)
    this._state.filter = this._state.filter
      ? `(${this._state.filter}) and (${expr})`
      : expr
    return this
  }

  or(input: FilterInput): this {
    const expr = resolveFilter(input)
    this._state.filter = this._state.filter
      ? `(${this._state.filter}) or (${expr})`
      : expr
    return this
  }

  expand(name: string, build?: (q: Query) => Query | void): this {
    const entry: { name: string; options?: QueryOptionsState } = { name }
    if (build) {
      const nested = new Query('', name)
      build(nested)
      entry.options = nested._state
    }
    this._state.expand = [...(this._state.expand ?? []), entry]
    return this
  }

  orderby(field: string, dir: OrderDir = 'asc'): this {
    this._state.orderby = [...(this._state.orderby ?? []), { field, dir }]
    return this
  }

  top(n: number): this {
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError(`Query#top: expected non-negative integer, got ${n}`)
    }
    this._state.top = n
    return this
  }

  skip(n: number): this {
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError(`Query#skip: expected non-negative integer, got ${n}`)
    }
    this._state.skip = n
    return this
  }

  count(enabled: boolean = true): this {
    this._state.count = enabled
    return this
  }

  search(term: string): this {
    this._state.search = term
    return this
  }

  // -------------------------------------------------------------------------
  // $apply (aggregation) — requires FMS 22.0.1+ (FileMaker 2025)
  // -------------------------------------------------------------------------

  /**
   * Set a raw `$apply` expression. Use this for advanced transformations
   * that the `aggregate()` / `groupBy()` helpers don't cover.
   *
   * Requires FileMaker Server 2025+ (v22). Use `db.hasFeature('applyAggregation')`
   * to check before calling.
   *
   * @example
   * ```ts
   * const result = await db.from('orders').apply('aggregate(total with sum as totalSum)')
   *   .get()
   * ```
   */
  apply(expr: string): this {
    this._state.apply = expr
    return this
  }

  /**
   * Aggregate the entity set. Produces a `$apply=aggregate(...)` expression.
   *
   * Requires FileMaker Server 2025+ (v22).
   *
   * @example
   * ```ts
   * const result = await db.from('orders')
   *   .aggregate([{ field: 'total', function: 'sum', alias: 'totalSum' }])
   *   .get()
   * // $apply=aggregate(total with sum as totalSum)
   * ```
   */
  aggregate(expressions: Array<{ field: string; function: AggregateFunction; alias: string }>): this {
    const parts = expressions.map((e) => `${e.field} with ${e.function} as ${e.alias}`)
    this._state.apply = `aggregate(${parts.join(',')})`
    return this
  }

  /**
   * Group the entity set by one or more fields, optionally with aggregation.
   * Produces a `$apply=groupby((fields), aggregate(...))` expression.
   *
   * Requires FileMaker Server 2025+ (v22).
   *
   * @example
   * ```ts
   * const result = await db.from('orders')
   *   .groupBy(
   *     ['customerId'],
   *     [{ field: 'total', function: 'sum', alias: 'totalSum' }],
   *   )
   *   .get()
   * // $apply=groupby((customerId),aggregate(total with sum as totalSum))
   * ```
   */
  groupBy(
    fields: string[],
    aggregateExpressions?: Array<{ field: string; function: AggregateFunction; alias: string }>,
  ): this {
    const fieldList = fields.join(',')
    if (aggregateExpressions && aggregateExpressions.length > 0) {
      const aggParts = aggregateExpressions.map((e) => `${e.field} with ${e.function} as ${e.alias}`)
      this._state.apply = `groupby((${fieldList}),aggregate(${aggParts.join(',')}))`
    } else {
      this._state.apply = `groupby((${fieldList}))`
    }
    return this
  }

  /** Build the absolute request URL for this query. */
  toURL(): string {
    const qs = serializeOptions(this._state, { topLevel: true })
    const base = `${this._baseUrl}/${encodePathSegment(this._entitySet)}`
    return qs ? `${base}?${qs}` : base
  }

  /**
   * Get a handle to a single entity by its primary key. Subsequent operations
   * (`.get()`, `.patch()`, `.delete()`) hit `/<EntitySet>(<key>)`.
   */
  byKey(key: string | number): EntityRef<T> {
    if (!this._client) {
      throw new Error('Query#byKey: no client attached (use FMSOData#from)')
    }
    return new EntityRef<T>(this._client, this._entitySet, key)
  }

  /**
   * `POST` a new entity to the collection. Returns the created row (FMS echoes
   * it by default).
   */
  async create(
    body: Partial<T> | Record<string, unknown>,
    opts: RequestOptions = {},
  ): Promise<T> {
    if (!this._client) {
      throw new Error('Query#create: no client attached (use FMSOData#from)')
    }
    const url = `${this._baseUrl}/${encodePathSegment(this._entitySet)}`
    const json = await executeJson<T>(this._client._ctx, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    return json
  }

  /**
   * `POST` a new entity carrying one or more container fields. Maps to the
   * Claris "Operation 1" — the request body is a JSON object containing
   * regular field values plus, for each container field, the base64 data
   * and the `@com.filemaker.odata.{ContentType,Filename}` annotations.
   *
   * Each container value's `data` must already be base64-encoded.
   *
   * @example
   * await db.from('contact').createWithContainers(
   *   { first_name: 'Bob', last_name: 'Jones' },
   *   { photo: { data: photoB64, contentType: 'image/png', filename: 'BJONES.png' } },
   * )
   */
  async createWithContainers(
    regularFields: Partial<T> | Record<string, unknown>,
    containers: Record<string, ContainerJsonValue>,
    opts: RequestOptions = {},
  ): Promise<T> {
    if (!this._client) {
      throw new Error('Query#createWithContainers: no client attached (use FMSOData#from)')
    }
    const url = `${this._baseUrl}/${encodePathSegment(this._entitySet)}`
    const body = buildContainerJsonBody(
      containers,
      regularFields as Record<string, unknown>,
    )
    const json = await executeJson<T>(this._client._ctx, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    return json
  }

  /**
   * Execute the query. Returns the parsed OData collection envelope.
   */
  async get(opts: RequestOptions = {}): Promise<QueryResult<T>> {
    if (!this._client) {
      throw new Error('Query#get: no client attached (use FMSOData#from)')
    }
    type Envelope = {
      value?: T[]
      '@odata.count'?: number
      '@odata.nextLink'?: string
    }
    const json = await executeJson<Envelope>(this._client._ctx, this.toURL(), {
      method: 'GET',
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    const out: QueryResult<T> = { value: json?.value ?? [] }
    if (json && typeof json['@odata.count'] === 'number') out.count = json['@odata.count']
    if (json && typeof json['@odata.nextLink'] === 'string') out.nextLink = json['@odata.nextLink']
    return out
  }

  /**
   * Invoke a FileMaker script in the context of this query's entity set.
   *
   * Filter / select / orderby / paging state on the `Query` is **ignored** —
   * the underlying OData Action only cares about the entity set. Use
   * `EntityRef#script` to run a script in the context of a specific record.
   */
  async script(name: string, opts: ScriptOptions = {}): Promise<ScriptResult> {
    if (!this._client) {
      throw new Error('Query#script: no client attached (use FMSOData#from)')
    }
    return runScriptAtEntitySet(this._client, this._entitySet, name, opts)
  }
}

/**
 * Serialize query options either as a top-level querystring (percent-encoded)
 * or as a nested `$expand` option block (semicolon-joined, unencoded — the
 * outer param encoder will encode the whole block once).
 *
 * @internal
 */
export function serializeOptions(
  s: QueryOptionsState,
  opts: { topLevel: boolean },
): string {
  const pairs: Array<[string, string]> = []

  if (s.select && s.select.length > 0) {
    pairs.push(['$select', s.select.join(',')])
  }
  if (s.filter) {
    pairs.push(['$filter', s.filter])
  }
  if (s.expand && s.expand.length > 0) {
    const parts = s.expand.map((e) => {
      if (!e.options) return e.name
      const inner = serializeOptions(e.options, { topLevel: false })
      return inner ? `${e.name}(${inner})` : e.name
    })
    pairs.push(['$expand', parts.join(',')])
  }
  if (s.orderby && s.orderby.length > 0) {
    pairs.push([
      '$orderby',
      s.orderby.map((o) => `${o.field} ${o.dir}`).join(','),
    ])
  }
  if (s.top !== undefined) pairs.push(['$top', String(s.top)])
  if (s.skip !== undefined) pairs.push(['$skip', String(s.skip)])
  if (s.count) pairs.push(['$count', 'true'])
  if (s.search) pairs.push(['$search', s.search])
  if (s.apply) pairs.push(['$apply', s.apply])

  if (opts.topLevel) return buildQueryString(pairs)
  return pairs.map(([k, v]) => `${k}=${v}`).join(';')
}
