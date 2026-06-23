/**
 * Public TypeScript types for fms-odata-js.
 *
 * These are intentionally minimal during M1 and will be expanded in later
 * milestones (query, CRUD, containers, scripts, metadata, batch).
 */
export type TokenProvider = string | (() => string | Promise<string>);
export interface FMSODataOptions {
    /** Base FMS host, e.g. `https://fms.example.com` (no trailing slash). */
    host: string;
    /** FileMaker database (solution) name. */
    database: string;
    /** Bearer token or resolver. */
    token: TokenProvider;
    /** Invoked once on 401 to refresh credentials before a single retry. */
    onUnauthorized?: () => void | Promise<void>;
    /** Injectable fetch implementation (defaults to `globalThis.fetch`). */
    fetch?: typeof globalThis.fetch;
    /** Per-request timeout in milliseconds. */
    timeoutMs?: number;
}
/** Common request-level options accepted by every method. */
export interface RequestOptions {
    signal?: AbortSignal;
}
//# sourceMappingURL=types.d.ts.map