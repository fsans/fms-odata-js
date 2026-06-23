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
export type ODataLiteral = string | number | boolean | Date | null | undefined

/** Escape a string for inclusion inside a single-quoted OData literal. */
export function escapeStringLiteral(s: string): string {
  return s.replace(/'/g, "''")
}

/** Format a `Date` as UTC ISO-8601 without milliseconds (e.g. `2026-04-17T14:45:00Z`). */
export function formatDateTime(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new TypeError('formatDateTime: invalid Date')
  }
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Parse an OData DateTimeOffset string (with or without milliseconds). */
export function parseDateTime(s: string): Date {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`parseDateTime: invalid date string: ${s}`)
  }
  return d
}

/** Format a primitive as an OData literal suitable for `$filter`, `$search`, etc. */
export function formatLiteral(v: ODataLiteral): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return `'${escapeStringLiteral(v)}'`
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new TypeError(`formatLiteral: cannot encode non-finite number: ${v}`)
    }
    return String(v)
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (v instanceof Date) return formatDateTime(v)
  throw new TypeError(`formatLiteral: unsupported OData literal type: ${typeof v}`)
}

/** Encode a single URL path segment (spaces become `%20`). */
export function encodePathSegment(s: string): string {
  return encodeURIComponent(s)
}

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
export function odataEncode(v: string): string {
  return encodeURIComponent(v)
    .replace(/%2C/gi, ',')
    .replace(/%24/g, '$')
    .replace(/%3D/g, '=')
    .replace(/%3B/g, ';')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
}

/**
 * Build a querystring from ordered `[key, value]` pairs.
 *
 * Keys are emitted verbatim (the caller controls them and they are always safe
 * ASCII such as `$filter`). Values are percent-encoded via `odataEncode`.
 * Empty / nullish values are skipped.
 */
export function buildQueryString(params: ReadonlyArray<readonly [string, string]>): string {
  const parts: string[] = []
  for (const [k, v] of params) {
    if (v === '' || v === undefined || v === null) continue
    parts.push(`${k}=${odataEncode(v)}`)
  }
  return parts.join('&')
}
