/**
 * OData URL encoding helpers.
 *
 * Aligned with `@fms-odata/spec-ts` for the shared helpers (`escapeStringLiteral`,
 * `formatLiteral`). fms-odata-js keeps its richer implementations for
 * `formatDateTime`, `parseDateTime`, `odataEncode`, `buildQueryString`, and
 * `encodePathSegment` which go beyond the spec's minimal versions.
 *
 * - String literals are single-quoted with inner single-quotes doubled.
 * - Dates serialize as UTC ISO-8601 without milliseconds (FileMaker quirk).
 * - Query-string keys are emitted verbatim (always safe ASCII such as `$filter`)
 *   while values are percent-encoded via `odataEncode`, which uses `%20`
 *   for spaces rather than `+` (required by OData `$filter`) and preserves
 *   commas (required by `$select`, `$orderby`, `$expand`).
 *
 * @see https://github.com/fsans/fms-odata-spec/blob/main/docs/13-quirks.md
 */
/** Any value that can appear on the right-hand side of an OData `$filter` comparison. */
export type ODataLiteral = string | number | boolean | Date | null | undefined;
/** Escape a string for inclusion inside a single-quoted OData literal. */
export declare function escapeStringLiteral(s: string): string;
/** Format a `Date` as UTC ISO-8601 without milliseconds (e.g. `2026-04-17T14:45:00Z`). */
export declare function formatDateTime(d: Date): string;
/** Parse an OData DateTimeOffset string (with or without milliseconds). */
export declare function parseDateTime(s: string): Date;
/** Format a primitive as an OData literal suitable for `$filter`, `$search`, etc. */
export declare function formatLiteral(v: ODataLiteral): string;
/** Encode a single URL path segment (spaces become `%20`). */
export declare function encodePathSegment(s: string): string;
/**
 * Encode an OData query-string value.
 *
 * - Spaces become `%20` (not `+`) — required by OData `$filter`.
 * - Commas stay literal (not `%2C`) — required by `$select`, `$orderby`, `$expand`.
 * - Parentheses stay literal (not `%28`/`%29`) — required by `$apply` expressions
 *   such as `aggregate(...)` and `groupby((...))`.
 * - `$`, `=`, and `;` stay literal — required for nested `$expand` options.
 *   FileMaker Server rejects percent-encoded forms of these characters.
 */
export declare function odataEncode(v: string): string;
/**
 * Build a querystring from ordered `[key, value]` pairs.
 *
 * Keys are emitted verbatim (the caller controls them and they are always safe
 * ASCII such as `$filter`). Values are percent-encoded via `odataEncode`.
 * Empty / nullish values are skipped.
 */
export declare function buildQueryString(params: ReadonlyArray<readonly [string, string]>): string;
//# sourceMappingURL=url.d.ts.map