/**
 * HTTP plumbing shared by the query builder, entity handles, and (later)
 * containers, scripts, metadata, and batch.
 *
 * Aligned with `@fms-odata/spec-ts` for auth type definitions. fms-odata-js
 * keeps its own `resolveAuthHeader`, `basicAuth`, `combineSignals`, and
 * `executeRequest` implementations which are more feature-rich (401 retry,
 * timeout composition, browser/Web Viewer compatibility).
 *
 * Responsibilities:
 * - Authorization header resolution (Basic or Bearer/OAuth, auto-detected).
 * - Timeout + AbortSignal composition.
 * - 401 retry via `onUnauthorized` (once).
 * - Error envelope normalization into `FMSODataError`.
 *
 * @see https://github.com/fsans/fms-odata-spec/blob/main/docs/04-authentication.md
 */
import type { TokenProvider, RequestOptions } from './types.js';
/** Resolve a `TokenProvider` to a complete Authorization header value. */
export declare function resolveAuthHeader(provider: TokenProvider): Promise<string>;
/** Encode an FMS account username + password into a `Basic …` header value. */
export declare function basicAuth(user: string, password: string): string;
/** Build a Bearer auth header value for an OAuth session token (FileMaker Cloud / external IdP). */
export declare function bearerAuth(token: string): string;
/** Auth scheme type (aligned with spec). */
export type { FMAuthScheme, FMAuthToken, FMAuthTokenProvider } from '@fms-odata/spec-ts';
/** Combine multiple `AbortSignal`s into one that aborts when any input aborts. */
export declare function combineSignals(signals: ReadonlyArray<AbortSignal | undefined>): AbortSignal | undefined;
/** Options accepted by the shared request executor. */
export interface HttpRequestOptions extends RequestOptions {
    method?: string;
    headers?: HeadersInit;
    body?: BodyInit | null;
    /** Expected response shape; controls default Accept header. */
    accept?: 'json' | 'xml' | 'text' | 'binary' | 'none';
}
/** Context supplied by `FMSOData` to execute a request. */
export interface HttpClientContext {
    token: TokenProvider;
    onUnauthorized?: () => void | Promise<void>;
    fetch: typeof globalThis.fetch;
    timeoutMs: number | undefined;
}
/**
 * Execute an HTTP request against the FMS OData endpoint. Centralizes auth,
 * timeout, retry, and error handling. Returns the raw `Response` on success.
 */
export declare function executeRequest(ctx: HttpClientContext, url: string, opts?: HttpRequestOptions): Promise<Response>;
/** Convenience: execute and parse the response as JSON. */
export declare function executeJson<T = unknown>(ctx: HttpClientContext, url: string, opts?: HttpRequestOptions): Promise<T>;
//# sourceMappingURL=http.d.ts.map