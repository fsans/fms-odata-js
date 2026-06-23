/**
 * Normalized error thrown by all fm-odata-js operations.
 *
 * The error class shape is aligned with `@fm-odata/spec-ts` (the canonical
 * spec package). fm-odata-js keeps its own class identity for backward
 * compatibility with existing `instanceof` checks in user code.
 *
 * @see https://github.com/fsans/fms-odata-spec/blob/main/docs/13-quirks.md
 */
export class FMODataError extends Error {
  readonly status: number
  readonly code: string | undefined
  readonly odataError: unknown
  readonly request: { url: string; method: string } | undefined

  constructor(
    message: string,
    init: {
      status: number
      code?: string
      odataError?: unknown
      request?: { url: string; method: string }
    },
  ) {
    super(message)
    this.name = 'FMODataError'
    this.status = init.status
    if (init.code !== undefined) this.code = init.code
    if (init.odataError !== undefined) this.odataError = init.odataError
    if (init.request !== undefined) this.request = init.request
  }
}

/**
 * Parse an error Response body into a `FMODataError`. Handles both stock OData
 * JSON envelopes (`{ error: { code, message } }`) and FileMaker's XML envelope
 * (`<m:error><m:code>212</m:code><m:message>...</m:message></m:error>`).
 *
 * @internal
 */
export async function parseErrorResponse(
  res: Response,
  request: { url: string; method: string },
): Promise<FMODataError> {
  const status = res.status
  let body = ''
  try {
    body = await res.text()
  } catch {
    // body unreadable; fall through with empty string
  }

  let code: string | undefined
  let message = res.statusText || `HTTP ${status}`
  let odataError: unknown = body

  const ctype = (res.headers.get('content-type') ?? '').toLowerCase()
  const looksJson = ctype.includes('json') || (body.startsWith('{') && body.endsWith('}'))
  const looksXml = ctype.includes('xml') || body.trimStart().startsWith('<?xml') || body.includes('<m:error')

  if (looksJson) {
    try {
      const json = JSON.parse(body) as { error?: { code?: string; message?: string | { value?: string } } }
      odataError = json
      const errCode = json?.error?.code
      const rawMsg = json?.error?.message
      const msg = typeof rawMsg === 'string' ? rawMsg : rawMsg?.value
      if (errCode) code = String(errCode)
      if (msg) message = msg
    } catch {
      // leave defaults
    }
  } else if (looksXml) {
    const codeMatch = body.match(/<m:code>([^<]+)<\/m:code>/)
    const msgMatch = body.match(/<m:message(?:\s[^>]*)?>([^<]+)<\/m:message>/)
    if (codeMatch?.[1]) code = codeMatch[1]
    if (msgMatch?.[1]) message = msgMatch[1]
  }

  return new FMODataError(message, { status, ...(code !== undefined ? { code } : {}), odataError, request })
}

/**
 * Thrown when a FileMaker script invocation completes with a non-zero
 * `scriptError`. The HTTP request itself succeeded (the server returned 2xx),
 * but the script reported an error via the FMS result envelope.
 *
 * Subclass of `FMODataError` so existing `instanceof FMODataError` checks and
 * error-handling code keep working.
 */
export class FMScriptError extends FMODataError {
  /** FileMaker script error code as a string (e.g. `"101"`). */
  readonly scriptError: string
  /** Raw `scriptResult` value returned by the script, if any. */
  readonly scriptResult: string | undefined

  constructor(
    message: string,
    init: {
      status: number
      scriptError: string
      scriptResult?: string
      odataError?: unknown
      request?: { url: string; method: string }
    },
  ) {
    super(message, {
      status: init.status,
      code: init.scriptError,
      ...(init.odataError !== undefined ? { odataError: init.odataError } : {}),
      ...(init.request !== undefined ? { request: init.request } : {}),
    })
    this.name = 'FMScriptError'
    this.scriptError = init.scriptError
    if (init.scriptResult !== undefined) this.scriptResult = init.scriptResult
  }
}

// ---------------------------------------------------------------------------
// Spec alignment: re-export type-level helpers from @fm-odata/spec-ts
// ---------------------------------------------------------------------------

/** OData standard error response body shape (from spec). */
export type { ODataErrorBody } from '@fm-odata/spec-ts'

/** Check if an error is a FileMaker OData error. */
export function isFMODataError(err: unknown): err is FMODataError {
  return err instanceof FMODataError
}

/** Check if an error is a FileMaker script error. */
export function isFMScriptError(err: unknown): err is FMScriptError {
  return err instanceof FMScriptError
}
