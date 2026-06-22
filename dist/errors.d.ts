/**
 * Normalized error thrown by all fm-odata-js operations.
 *
 * The error class shape is aligned with `@fm-odata/spec-ts` (the canonical
 * spec package). fm-odata-js keeps its own class identity for backward
 * compatibility with existing `instanceof` checks in user code.
 *
 * @see https://github.com/fsans/FM-ODATA_SPEC/blob/main/docs/13-quirks.md
 */
export declare class FMODataError extends Error {
    readonly status: number;
    readonly code: string | undefined;
    readonly odataError: unknown;
    readonly request: {
        url: string;
        method: string;
    } | undefined;
    constructor(message: string, init: {
        status: number;
        code?: string;
        odataError?: unknown;
        request?: {
            url: string;
            method: string;
        };
    });
}
/**
 * Parse an error Response body into a `FMODataError`. Handles both stock OData
 * JSON envelopes (`{ error: { code, message } }`) and FileMaker's XML envelope
 * (`<m:error><m:code>212</m:code><m:message>...</m:message></m:error>`).
 *
 * @internal
 */
export declare function parseErrorResponse(res: Response, request: {
    url: string;
    method: string;
}): Promise<FMODataError>;
/**
 * Thrown when a FileMaker script invocation completes with a non-zero
 * `scriptError`. The HTTP request itself succeeded (the server returned 2xx),
 * but the script reported an error via the FMS result envelope.
 *
 * Subclass of `FMODataError` so existing `instanceof FMODataError` checks and
 * error-handling code keep working.
 */
export declare class FMScriptError extends FMODataError {
    /** FileMaker script error code as a string (e.g. `"101"`). */
    readonly scriptError: string;
    /** Raw `scriptResult` value returned by the script, if any. */
    readonly scriptResult: string | undefined;
    constructor(message: string, init: {
        status: number;
        scriptError: string;
        scriptResult?: string;
        odataError?: unknown;
        request?: {
            url: string;
            method: string;
        };
    });
}
/** OData standard error response body shape (from spec). */
export type { ODataErrorBody } from '@fm-odata/spec-ts';
/** Check if an error is a FileMaker OData error. */
export declare function isFMODataError(err: unknown): err is FMODataError;
/** Check if an error is a FileMaker script error. */
export declare function isFMScriptError(err: unknown): err is FMScriptError;
//# sourceMappingURL=errors.d.ts.map