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
 * The optional parameter is sent as `{ "scriptParameterValue": "<string>" }`. The
 * response envelope is `{ "scriptResult": "...", "scriptError": "0" }`; a
 * non-zero `scriptError` becomes an `FMScriptError`.
 *
 * @see https://github.com/fsans/fms-odata-spec/blob/main/docs/06-scripts.md
 */

import type { FMOData } from './client.js'
import { FMScriptError } from './errors.js'
import { executeJson } from './http.js'
import type { RequestOptions } from './types.js'
import {
  encodePathSegment,
  escapeStringLiteral,
  type ODataLiteral,
} from './url.js'

/** Script identifier: either by name or by FMSID (v26+). */
export type ScriptIdentifier =
  | { type: 'name'; name: string }
  | { type: 'fmsid'; id: number }

/** Options accepted by a script invocation. */
export interface ScriptOptions extends RequestOptions {
  /**
   * Optional script parameter. Serialized to the FMS `scriptParameterValue`
   * field in the request body. If omitted, the body is empty and the script
   * runs with no parameter (FileMaker's `Get(ScriptParameter)` returns empty).
   */
  parameter?: string
}

/**
 * Result envelope returned by a successful script invocation. A non-zero
 * `scriptError` is promoted to an `FMScriptError` before reaching the caller,
 * so values you receive here always represent success (`scriptError === "0"`).
 */
export interface ScriptResult {
  /** Raw value returned by `Exit Script [Text Result: ...]`. */
  scriptResult?: string
  /** Always `"0"` in a resolved result; non-zero raises `FMScriptError`. */
  scriptError: string
  /** Full parsed response body, for forward-compatible field access. */
  raw: unknown
}

/** Format an OData primary-key literal for embedding in a URL path. */
function formatKey(key: ODataLiteral): string {
  if (typeof key === 'number') {
    if (!Number.isFinite(key)) {
      throw new TypeError('ScriptInvoker: key must be a finite number')
    }
    return String(key)
  }
  if (typeof key === 'string') return `'${escapeStringLiteral(key)}'`
  if (typeof key === 'boolean') return key ? 'true' : 'false'
  throw new TypeError('ScriptInvoker: unsupported key type')
}

/** Scope describing where a `ScriptInvoker` is rooted. */
export interface ScriptScope {
  /** When omitted the script runs at database scope. */
  entitySet?: string
  /** When present alongside `entitySet`, the script runs at record scope. */
  key?: ODataLiteral
}

/**
 * Low-level handle used internally by `FMOData#script`, `Query#script`, and
 * `EntityRef#script`. Exposed so advanced callers can build their own
 * invocation paths if needed.
 */
export class ScriptInvoker {
  /** @internal */ readonly _client: FMOData
  readonly entitySet: string | undefined
  readonly key: ODataLiteral | undefined

  constructor(client: FMOData, scope: ScriptScope = {}) {
    this._client = client
    if (scope.entitySet !== undefined) this.entitySet = scope.entitySet
    if (scope.key !== undefined) this.key = scope.key
  }

  /** Build the absolute URL for invoking `name` at this scope. */
  url(name: string): string {
    if (!name) throw new TypeError('ScriptInvoker: script name is required')
    return this._urlForSegment(`Script.${encodePathSegment(name)}`)
  }

  /** Build the absolute URL for invoking by FMSID at this scope. */
  urlById(fmsid: number): string {
    if (!Number.isFinite(fmsid)) throw new TypeError('ScriptInvoker: fmsid must be a finite number')
    return this._urlForSegment(`Script.FMSID:${fmsid}`)
  }

  /** @internal — build URL from a script path segment. */
  private _urlForSegment(scriptSegment: string): string {
    const base = this._client.baseUrl
    if (this.entitySet === undefined) {
      return `${base}/${scriptSegment}`
    }
    const setSegment = encodePathSegment(this.entitySet)
    if (this.key === undefined) {
      return `${base}/${setSegment}/${scriptSegment}`
    }
    return `${base}/${setSegment}(${formatKey(this.key)})/${scriptSegment}`
  }

  /** Invoke the script by name. Resolves to a `ScriptResult` on success. */
  async run(name: string, opts: ScriptOptions = {}): Promise<ScriptResult> {
    return this._runAtUrl(this.url(name), opts)
  }

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
  async runById(fmsid: number, opts: ScriptOptions = {}): Promise<ScriptResult> {
    return this._runAtUrl(this.urlById(fmsid), opts)
  }

  /** @internal — execute a script POST at the given URL. */
  private async _runAtUrl(url: string, opts: ScriptOptions): Promise<ScriptResult> {
    const headers: Record<string, string> = {}
    let body: string | undefined
    if (opts.parameter !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify({ scriptParameterValue: opts.parameter })
    }

    const method = 'POST'
    const json = await executeJson<unknown>(this._client._ctx, url, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })

    return parseScriptEnvelope(json, { url, method })
  }
}

/**
 * Parse the `{ scriptResult, scriptError }` envelope FMS returns from a
 * script action, promoting a non-zero `scriptError` to `FMScriptError`.
 *
 * @internal
 */
export function parseScriptEnvelope(
  raw: unknown,
  request: { url: string; method: string },
): ScriptResult {
  // FMS may wrap the envelope under a single top-level key in some versions;
  // tolerate both shapes by looking for the fields at depth 0 or 1.
  const envelope = extractEnvelope(raw)

  // FMS v26+ wraps the result as: {"scriptResult": {"code": 0, "resultParameter": "..."}}
  // Older FMS uses flat: {"scriptResult": "...", "scriptError": "0"}
  const rawResult = envelope.scriptResult
  let scriptResult: string | undefined
  let scriptError: string

  if (rawResult !== null && typeof rawResult === 'object' && 'resultParameter' in rawResult) {
    // Nested envelope (FMS v26+): code + resultParameter inside scriptResult
    const nested = rawResult as { code?: unknown; resultParameter?: unknown }
    scriptError = nested.code !== undefined ? String(nested.code) : '0'
    scriptResult = nested.resultParameter !== undefined ? String(nested.resultParameter) : undefined
  } else {
    // Flat envelope (older FMS): scriptResult is a string, scriptError is a sibling
    scriptError = envelope.scriptError !== undefined ? String(envelope.scriptError) : '0'
    scriptResult =
      rawResult !== undefined
        ? typeof rawResult === 'string'
          ? rawResult
          : JSON.stringify(rawResult)
        : undefined
  }

  if (scriptError !== '0') {
    throw new FMScriptError(
      `FileMaker script error ${scriptError}`,
      {
        status: 200,
        scriptError,
        ...(scriptResult !== undefined ? { scriptResult } : {}),
        odataError: raw,
        request,
      },
    )
  }

  const out: ScriptResult = { scriptError, raw }
  if (scriptResult !== undefined) out.scriptResult = scriptResult
  return out
}

function extractEnvelope(raw: unknown): {
  scriptResult?: unknown
  scriptError?: unknown
} {
  if (raw === null || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  if ('scriptError' in obj || 'scriptResult' in obj) {
    return obj as { scriptResult?: unknown; scriptError?: unknown }
  }
  // Some callers may see the envelope nested under a single wrapping key.
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const inner = v as Record<string, unknown>
      if ('scriptError' in inner || 'scriptResult' in inner) {
        return inner as { scriptResult?: unknown; scriptError?: unknown }
      }
    }
  }
  return {}
}

/** @internal — convenience factory used by client/query/entity helpers. */
export function runScriptAtDatabase(
  client: FMOData,
  name: string,
  opts?: ScriptOptions,
): Promise<ScriptResult> {
  return new ScriptInvoker(client).run(name, opts)
}

/** @internal — convenience factory for FMSID-based invocation. */
export function runScriptByIdAtDatabase(
  client: FMOData,
  fmsid: number,
  opts?: ScriptOptions,
): Promise<ScriptResult> {
  return new ScriptInvoker(client).runById(fmsid, opts)
}

/** @internal */
export function runScriptAtEntitySet(
  client: FMOData,
  entitySet: string,
  name: string,
  opts?: ScriptOptions,
): Promise<ScriptResult> {
  return new ScriptInvoker(client, { entitySet }).run(name, opts)
}

/** @internal */
export function runScriptAtEntity(
  client: FMOData,
  entitySet: string,
  key: ODataLiteral,
  name: string,
  opts?: ScriptOptions,
): Promise<ScriptResult> {
  return new ScriptInvoker(client, { entitySet, key }).run(name, opts)
}
