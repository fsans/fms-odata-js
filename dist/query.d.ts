/**
 * Fluent OData query builder.
 *
 * `Query` accumulates `$select`, `$filter`, `$expand`, `$orderby`, `$top`,
 * `$skip`, `$count`, and `$search` options and serializes them into an absolute
 * URL via `toURL()`. Actual HTTP execution (`.get()`) lands in M3 alongside
 * auth, error handling, and the mock server.
 */
import type { FMSOData } from './client.js';
import { type ContainerJsonValue } from './containers.js';
import { EntityRef } from './entity.js';
import { type ScriptOptions, type ScriptResult } from './scripts.js';
import type { RequestOptions } from './types.js';
import { type ODataLiteral } from './url.js';
import type { AggregateFunction } from '@fms-odata/spec-ts';
/**
 * Opaque filter expression produced by `filterFactory`. Use `.and()`, `.or()`,
 * `.not()` to compose; pass to `Query#filter`.
 */
export declare class Filter {
    readonly expr: string;
    constructor(expr: string);
    toString(): string;
    and(other: Filter | string): Filter;
    or(other: Filter | string): Filter;
    not(): Filter;
    /** @internal */
    static coerce(x: Filter | string): string;
}
/** Factory passed to callback-form `Query#filter(f => ...)`. */
export interface FilterFactory {
    eq(field: string, value: ODataLiteral): Filter;
    ne(field: string, value: ODataLiteral): Filter;
    gt(field: string, value: ODataLiteral): Filter;
    ge(field: string, value: ODataLiteral): Filter;
    lt(field: string, value: ODataLiteral): Filter;
    le(field: string, value: ODataLiteral): Filter;
    startswith(field: string, value: string): Filter;
    endswith(field: string, value: string): Filter;
    contains(field: string, value: string): Filter;
    and(a: Filter | string, b: Filter | string): Filter;
    or(a: Filter | string, b: Filter | string): Filter;
    not(a: Filter | string): Filter;
    /** Escape hatch: embed a raw OData filter fragment verbatim. */
    raw(expr: string): Filter;
}
export declare const filterFactory: FilterFactory;
export type FilterInput = Filter | string | ((f: FilterFactory) => Filter | string);
export type OrderDir = 'asc' | 'desc';
/** @internal */
export interface QueryOptionsState {
    select?: string[];
    filter?: string;
    expand?: Array<{
        name: string;
        options?: QueryOptionsState;
    }>;
    orderby?: Array<{
        field: string;
        dir: OrderDir;
    }>;
    top?: number;
    skip?: number;
    count?: boolean;
    search?: string;
    apply?: string;
}
/**
 * Fluent query builder. Methods mutate and return `this` for chaining.
 */
/** Result envelope returned by `Query#get()`. */
export interface QueryResult<T> {
    value: T[];
    /** Present when `.count()` was enabled on the query. */
    count?: number;
    /** Server-driven paging link. */
    nextLink?: string;
}
export declare class Query<T = Record<string, unknown>> {
    /** @internal */ readonly _state: QueryOptionsState;
    /** @internal */ readonly _baseUrl: string;
    /** @internal */ readonly _entitySet: string;
    /** @internal */ readonly _client: FMSOData | undefined;
    constructor(baseUrl: string, entitySet: string, client?: FMSOData);
    select(...fields: string[]): this;
    filter(input: FilterInput): this;
    or(input: FilterInput): this;
    expand(name: string, build?: (q: Query) => Query | void): this;
    orderby(field: string, dir?: OrderDir): this;
    top(n: number): this;
    skip(n: number): this;
    count(enabled?: boolean): this;
    search(term: string): this;
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
    apply(expr: string): this;
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
    aggregate(expressions: Array<{
        field: string;
        function: AggregateFunction;
        alias: string;
    }>): this;
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
    groupBy(fields: string[], aggregateExpressions?: Array<{
        field: string;
        function: AggregateFunction;
        alias: string;
    }>): this;
    /** Build the absolute request URL for this query. */
    toURL(): string;
    /**
     * Get a handle to a single entity by its primary key. Subsequent operations
     * (`.get()`, `.patch()`, `.delete()`) hit `/<EntitySet>(<key>)`.
     */
    byKey(key: string | number): EntityRef<T>;
    /**
     * `POST` a new entity to the collection. Returns the created row (FMS echoes
     * it by default).
     */
    create(body: Partial<T> | Record<string, unknown>, opts?: RequestOptions): Promise<T>;
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
    createWithContainers(regularFields: Partial<T> | Record<string, unknown>, containers: Record<string, ContainerJsonValue>, opts?: RequestOptions): Promise<T>;
    /**
     * Execute the query. Returns the parsed OData collection envelope.
     */
    get(opts?: RequestOptions): Promise<QueryResult<T>>;
    /**
     * Invoke a FileMaker script in the context of this query's entity set.
     *
     * Filter / select / orderby / paging state on the `Query` is **ignored** —
     * the underlying OData Action only cares about the entity set. Use
     * `EntityRef#script` to run a script in the context of a specific record.
     */
    script(name: string, opts?: ScriptOptions): Promise<ScriptResult>;
}
/**
 * Serialize query options either as a top-level querystring (percent-encoded)
 * or as a nested `$expand` option block (semicolon-joined, unencoded — the
 * outer param encoder will encode the whole block once).
 *
 * @internal
 */
export declare function serializeOptions(s: QueryOptionsState, opts: {
    topLevel: boolean;
}): string;
//# sourceMappingURL=query.d.ts.map