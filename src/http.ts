/**
 * HTTP plumbing shared by the query builder, entity handles, and (later)
 * containers, scripts, metadata, and batch.
 *
 * Aligned with `@fm-odata/spec-ts` for auth type definitions. fm-odata-js
 * keeps its own `resolveAuthHeader`, `basicAuth`, `combineSignals`, and
 * `executeRequest` implementations which are more feature-rich (401 retry,
 * timeout composition, browser/Web Viewer compatibility).
 *
 * Responsibilities:
 * - Authorization header resolution (Basic, Bearer, or FMID, auto-detected).
 * - Timeout + AbortSignal composition.
 * - 401 retry via `onUnauthorized` (once).
 * - Error envelope normalization into `FMODataError`.
 *
 * @see https://github.com/fsans/FM-ODATA_SPEC/blob/main/docs/04-authentication.md
 */

import { parseErrorResponse, FMODataError } from './errors.js'
import type { TokenProvider, RequestOptions } from './types.js'

/** A scheme-prefixed Authorization value (e.g. `Basic …`, `Bearer …`, or `FMID …`). */
const AUTH_SCHEME_RE = /^(basic|bearer|fmid|negotiate|digest)\s+\S/i

/** Resolve a `TokenProvider` to a complete Authorization header value. */
export async function resolveAuthHeader(provider: TokenProvider): Promise<string> {
  const raw =
    typeof provider === 'function'
      ? await provider()
      : provider
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new TypeError('fm-odata-js: token resolver produced an empty value')
  }
  return AUTH_SCHEME_RE.test(raw) ? raw : `Bearer ${raw}`
}

/** Encode an FMS account username + password into a `Basic …` header value. */
export function basicAuth(user: string, password: string): string {
  const raw = `${user}:${password}`
  // Prefer Buffer (Node); fall back to btoa (browser / Web Viewer).
  const b64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(raw, 'utf8').toString('base64')
      : btoa(unescape(encodeURIComponent(raw)))
  return `Basic ${b64}`
}

/** Build an FMID auth header value for FileMaker Cloud (Claris ID token). */
export function fmidAuth(token: string): string {
  return `FMID ${token}`
}

/** Auth scheme type (aligned with spec). */
export type { FMAuthScheme, FMAuthToken, FMAuthTokenProvider } from '@fm-odata/spec-ts'

/** Combine multiple `AbortSignal`s into one that aborts when any input aborts. */
export function combineSignals(
  signals: ReadonlyArray<AbortSignal | undefined>,
): AbortSignal | undefined {
  const filtered = signals.filter((s): s is AbortSignal => s !== undefined)
  if (filtered.length === 0) return undefined
  if (filtered.length === 1) return filtered[0]
  const ctrl = new AbortController()
  for (const s of filtered) {
    if (s.aborted) {
      ctrl.abort((s as AbortSignal & { reason?: unknown }).reason)
      return ctrl.signal
    }
    s.addEventListener(
      'abort',
      () => ctrl.abort((s as AbortSignal & { reason?: unknown }).reason),
      { once: true },
    )
  }
  return ctrl.signal
}

/** Options accepted by the shared request executor. */
export interface HttpRequestOptions extends RequestOptions {
  method?: string
  headers?: HeadersInit
  body?: BodyInit | null
  /** Expected response shape; controls default Accept header. */
  accept?: 'json' | 'xml' | 'text' | 'binary' | 'none'
}

/** Context supplied by `FMOData` to execute a request. */
export interface HttpClientContext {
  token: TokenProvider
  onUnauthorized?: () => void | Promise<void>
  fetch: typeof globalThis.fetch
  timeoutMs: number | undefined
}

const ACCEPT_DEFAULTS: Record<NonNullable<HttpRequestOptions['accept']>, string> = {
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain',
  binary: 'application/octet-stream',
  none: '*/*',
}

/**
 * Execute an HTTP request against the FMS OData endpoint. Centralizes auth,
 * timeout, retry, and error handling. Returns the raw `Response` on success.
 */
export async function executeRequest(
  ctx: HttpClientContext,
  url: string,
  opts: HttpRequestOptions = {},
): Promise<Response> {
  return executeRequestImpl(ctx, url, opts, /* retried */ false)
}

async function executeRequestImpl(
  ctx: HttpClientContext,
  url: string,
  opts: HttpRequestOptions,
  retried: boolean,
): Promise<Response> {
  const method = opts.method ?? 'GET'
  const headers = new Headers(opts.headers)
  headers.set('Authorization', await resolveAuthHeader(ctx.token))
  // Required by the Claris FMS OData API for all requests.
  if (!headers.has('OData-Version')) headers.set('OData-Version', '4.0')
  if (!headers.has('OData-MaxVersion')) headers.set('OData-MaxVersion', '4.0')
  if (!headers.has('Accept')) {
    headers.set('Accept', ACCEPT_DEFAULTS[opts.accept ?? 'json'])
  }

  const timeoutCtrl = new AbortController()
  const timeoutId =
    ctx.timeoutMs && ctx.timeoutMs > 0
      ? setTimeout(() => timeoutCtrl.abort(new Error(`Timeout after ${ctx.timeoutMs}ms`)), ctx.timeoutMs)
      : undefined

  const signal = combineSignals([opts.signal, ctx.timeoutMs ? timeoutCtrl.signal : undefined])

  let res: Response
  try {
    res = await ctx.fetch(url, {
      method,
      headers,
      keepalive: true,
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      ...(signal ? { signal } : {}),
    })
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId)
    // AbortError (timeout or caller cancellation) propagates as-is.
    throw err
  }
  if (timeoutId) clearTimeout(timeoutId)

  if (res.status === 401 && ctx.onUnauthorized && !retried) {
    await ctx.onUnauthorized()
    return executeRequestImpl(ctx, url, opts, true)
  }

  if (!res.ok) {
    throw await parseErrorResponse(res, { url, method })
  }
  return res
}

/** Convenience: execute and parse the response as JSON. */
export async function executeJson<T = unknown>(
  ctx: HttpClientContext,
  url: string,
  opts: HttpRequestOptions = {},
): Promise<T> {
  const res = await executeRequest(ctx, url, opts)
  if (res.status === 204) return undefined as T
  const ctype = (res.headers.get('content-type') ?? '').toLowerCase()
  if (!ctype.includes('json')) {
    // Some FMS responses omit the header on success; try to parse anyway.
    const text = await res.text()
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new FMODataError(`Expected JSON response, got "${ctype || 'no content-type'}"`, {
        status: res.status,
        odataError: text,
        request: { url, method: opts.method ?? 'GET' },
      })
    }
  }
  return (await res.json()) as T
}
