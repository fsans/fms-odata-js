/**
 * FileMaker script invocation.
 *
 * FMS exposes FileMaker scripts through the OData v4 Action mechanism at a
 * `Script.<ScriptName>` path suffix. Scripts can be invoked at three scopes:
 *
 *   POST /<db>/Script.<name>                       // database-level
 *   POST /<db>/<EntitySet>/Script.<name>           // entity-set context
 *   POST /<db>/<EntitySet>(<key>)/Script.<name>    // single-record context
 *
 * Starting with FileMaker Server 2026 (v26), scripts can also be invoked by
 * their immutable FMSID instead of the name:
 *
 *   POST /<db>/Script.FMSID:<id>                   // database-level
 *   POST /<db>/<EntitySet>/Script.FMSID:<id>       // entity-set context
 *   POST /<db>/<EntitySet>(<key>)/Script.FMSID:<id> // single-record context
 *
 * The optional parameter is sent as `{ "scriptParameter": "<string>" }`. The
 * response envelope is `{ "scriptResult": "...", "scriptError": "0" }`; a
 * non-zero `scriptError` becomes an `FMScriptError`.
 *
 * @see https://github.com/fsans/FM-ODATA_SPEC/blob/main/docs/06-scripts.md
 */
import type { FMOData } from './client.js';
import type { RequestOptions } from './types.js';
import { type ODataLiteral } from './url.js';
/** Script identifier: either by name or by FMSID (v26+). */
export type ScriptIdentifier = {
    type: 'name';
    name: string;
} | {
    type: 'fmsid';
    id: number;
};
/** Options accepted by a script invocation. */
export interface ScriptOptions extends RequestOptions {
    /**
     * Optional script parameter. Serialized to the FMS `scriptParameter` field
     * in the request body. If omitted, the body is empty and the script runs
     * with no parameter (FileMaker's `Get(ScriptParameter)` returns empty).
     */
    parameter?: string;
}
/**
 * Result envelope returned by a successful script invocation. A non-zero
 * `scriptError` is promoted to an `FMScriptError` before reaching the caller,
 * so values you receive here always represent success (`scriptError === "0"`).
 */
export interface ScriptResult {
    /** Raw value returned by `Exit Script [Text Result: ...]`. */
    scriptResult?: string;
    /** Always `"0"` in a resolved result; non-zero raises `FMScriptError`. */
    scriptError: string;
    /** Full parsed response body, for forward-compatible field access. */
    raw: unknown;
}
/** Scope describing where a `ScriptInvoker` is rooted. */
export interface ScriptScope {
    /** When omitted the script runs at database scope. */
    entitySet?: string;
    /** When present alongside `entitySet`, the script runs at record scope. */
    key?: ODataLiteral;
}
/**
 * Low-level handle used internally by `FMOData#script`, `Query#script`, and
 * `EntityRef#script`. Exposed so advanced callers can build their own
 * invocation paths if needed.
 */
export declare class ScriptInvoker {
    /** @internal */ readonly _client: FMOData;
    readonly entitySet: string | undefined;
    readonly key: ODataLiteral | undefined;
    constructor(client: FMOData, scope?: ScriptScope);
    /** Build the absolute URL for invoking `name` at this scope. */
    url(name: string): string;
    /** Build the absolute URL for invoking by FMSID at this scope. */
    urlById(fmsid: number): string;
    /** @internal — build URL from a script path segment. */
    private _urlForSegment;
    /** Invoke the script by name. Resolves to a `ScriptResult` on success. */
    run(name: string, opts?: ScriptOptions): Promise<ScriptResult>;
    /**
     * Invoke the script by its immutable FMSID.
     *
     * Requires FileMaker Server 2026+ (v26). Use `db.hasFeature('scriptsByFMSID')`
     * to check before calling.
     *
     * ```ts
     * const result = await db.scriptById(42, { parameter: 'hello' })
     * ```
     */
    runById(fmsid: number, opts?: ScriptOptions): Promise<ScriptResult>;
    /** @internal — execute a script POST at the given URL. */
    private _runAtUrl;
}
/**
 * Parse the `{ scriptResult, scriptError }` envelope FMS returns from a
 * script action, promoting a non-zero `scriptError` to `FMScriptError`.
 *
 * @internal
 */
export declare function parseScriptEnvelope(raw: unknown, request: {
    url: string;
    method: string;
}): ScriptResult;
/** @internal — convenience factory used by client/query/entity helpers. */
export declare function runScriptAtDatabase(client: FMOData, name: string, opts?: ScriptOptions): Promise<ScriptResult>;
/** @internal — convenience factory for FMSID-based invocation. */
export declare function runScriptByIdAtDatabase(client: FMOData, fmsid: number, opts?: ScriptOptions): Promise<ScriptResult>;
/** @internal */
export declare function runScriptAtEntitySet(client: FMOData, entitySet: string, name: string, opts?: ScriptOptions): Promise<ScriptResult>;
/** @internal */
export declare function runScriptAtEntity(client: FMOData, entitySet: string, key: ODataLiteral, name: string, opts?: ScriptOptions): Promise<ScriptResult>;
//# sourceMappingURL=scripts.d.ts.map