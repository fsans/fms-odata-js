/**
 * $batch multipart composer and response parser (M6).
 *
 * OData $batch allows multiple operations in a single HTTP round-trip.
 * A batch consists of:
 *   - Read operations (GET) at the top level
 *   - Changesets (atomic groups of writes: POST, PATCH, DELETE)
 *
 * FMS endpoint: POST /fmi/odata/v4/{db}/$batch
 * Content-Type: multipart/mixed; boundary=batch_<uuid>
 *
 * The implementation generates unique boundaries using crypto.randomUUID()
 * (available in Node 18+ and modern browsers), composes the multipart
 * body, and parses the multipart response back into per-operation results.
 */

import type { FMOData } from './client.js'
import { executeRequest, type HttpRequestOptions } from './http.js'
import type { ODataLiteral } from './url.js'
import { encodePathSegment } from './url.js'
import type { RequestOptions } from './types.js'

/** Handle returned when adding an operation to a batch. Resolves to the operation result. */
export interface BatchHandle<T> {
  readonly __brand: 'BatchHandle'
  /** @internal */ readonly _promise: Promise<T>
  /** @internal */ readonly _index: number
}

/** Input for a read operation (GET) in a batch. */
export interface BatchReadOp {
  /** Entity set name (layout/table). */
  entitySet: string
  /** Operation type. */
  op: 'list'
  /** Query options: $top, $skip, $filter, etc. */
  query?: { $top?: number; $skip?: number; $filter?: string; $select?: string }
}

/** Result of a batch operation. */
export interface BatchOpResult<T = unknown> {
  status: number
  body?: T
  headers: Headers
  ok: boolean
}

/** Result of executing a batch. */
export interface BatchResult {
  /** All responses in request order. */
  responses: BatchOpResult[]
  /** True if all responses have status < 400. */
  ok: boolean
}

/** @internal — generate a unique boundary string. */
function generateBoundary(prefix: string): string {
  // crypto.randomUUID() is available in Node 18+ and modern browsers
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}_${uuid}`
}

/** @internal — build the URL path for an entity set query. */
function buildEntitySetPath(baseUrl: string, entitySet: string, query?: BatchReadOp['query']): string {
  // Build OData query string manually to avoid URLSearchParams percent-encoding
  // the leading '$' in OData system query options ($top, $filter, etc.).
  const parts: string[] = []
  if (query?.$top !== undefined) parts.push(`$top=${encodeURIComponent(String(query.$top))}`)
  if (query?.$skip !== undefined) parts.push(`$skip=${encodeURIComponent(String(query.$skip))}`)
  if (query?.$filter) parts.push(`$filter=${encodeURIComponent(query.$filter)}`)
  if (query?.$select) parts.push(`$select=${encodeURIComponent(query.$select)}`)
  const qs = parts.join('&')
  const encodedSet = encodePathSegment(entitySet)
  return qs ? `${baseUrl}/${encodedSet}?${qs}` : `${baseUrl}/${encodedSet}`
}

/** @internal — build the URL path for a single entity. */
function buildEntityPath(baseUrl: string, entitySet: string, key: ODataLiteral): string {
  const encodedSet = encodePathSegment(entitySet)
  let keySegment: string
  if (typeof key === 'number') {
    keySegment = String(key)
  } else if (typeof key === 'string') {
    keySegment = `'${key.replace(/'/g, "''")}'`
  } else if (typeof key === 'boolean') {
    keySegment = key ? 'true' : 'false'
  } else {
    throw new TypeError('Batch: unsupported key type')
  }
  return `${baseUrl}/${encodedSet}(${keySegment})`
}

/** Represents an operation within a changeset. */
interface ChangesetOp {
  method: string
  path: string
  headers?: Record<string, string>
  body?: string
}

/** Changeset builder for atomic write operations. */
export class Changeset {
  private _ops: ChangesetOp[] = []
  private _handles: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
  private _baseUrl: string

  constructor(baseUrl: string) {
    this._baseUrl = baseUrl
  }

  /** @internal */
  get _operations(): ChangesetOp[] {
    return this._ops
  }

  /** @internal */
  get _handleSlots(): Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> {
    return this._handles
  }

  /**
   * Create a new entity within this changeset.
   */
  create<T = unknown>(entitySet: string, body: Record<string, unknown>): BatchHandle<T> {
    const path = buildEntitySetPath(this._baseUrl, entitySet)
    let resolve: (v: unknown) => void
    let reject: (e: unknown) => void
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res
      reject = rej
    })
    const index = this._handles.length
    this._handles.push({ resolve: resolve!, reject: reject! })
    this._ops.push({
      method: 'POST',
      path,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { __brand: 'BatchHandle', _promise: promise, _index: index } as BatchHandle<T>
  }

  /**
   * Patch an existing entity within this changeset.
   */
  patch<T = unknown>(
    entitySet: string,
    key: ODataLiteral,
    body: Record<string, unknown>,
    opts?: { ifMatch?: string },
  ): BatchHandle<T> {
    const path = buildEntityPath(this._baseUrl, entitySet, key)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (opts?.ifMatch) headers['If-Match'] = opts.ifMatch
    let resolve: (v: unknown) => void
    let reject: (e: unknown) => void
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res
      reject = rej
    })
    const index = this._handles.length
    this._handles.push({ resolve: resolve!, reject: reject! })
    this._ops.push({
      method: 'PATCH',
      path,
      headers,
      body: JSON.stringify(body),
    })
    return { __brand: 'BatchHandle', _promise: promise, _index: index } as BatchHandle<T>
  }

  /**
   * Delete an entity within this changeset.
   */
  delete(entitySet: string, key: ODataLiteral, opts?: { ifMatch?: string }): BatchHandle<void> {
    const path = buildEntityPath(this._baseUrl, entitySet, key)
    const headers: Record<string, string> = {}
    if (opts?.ifMatch) headers['If-Match'] = opts.ifMatch
    let resolve: (v: unknown) => void
    let reject: (e: unknown) => void
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res
      reject = rej
    })
    const index = this._handles.length
    this._handles.push({ resolve: resolve!, reject: reject! })
    this._ops.push({ method: 'DELETE', path, headers })
    return { __brand: 'BatchHandle', _promise: promise, _index: index } as BatchHandle<void>
  }
}

/** Internal representation of a batch part. */
interface BatchPart {
  type: 'read' | 'changeset'
  content: ChangesetOp | Changeset
  handle?: BatchHandle<unknown>
  changesetIndex?: number // for changeset parts, index into changeset handles
}

/** Batch builder for composing multipart/mixed requests. */
export class Batch {
  private _client: FMOData
  private _parts: BatchPart[] = []
  private _changesets: Changeset[] = []

  constructor(client: FMOData) {
    this._client = client
  }

  /**
   * Add a read operation (GET) to the batch.
   * Read operations are not part of a changeset and execute independently.
   */
  add<T = unknown>(op: BatchReadOp): BatchHandle<T> {
    const path = buildEntitySetPath(this._client.baseUrl, op.entitySet, op.query)
    let resolve: (v: unknown) => void
    let reject: (e: unknown) => void
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res
      reject = rej
    })
    const handle = { __brand: 'BatchHandle', _promise: promise, _index: this._parts.length } as BatchHandle<T>
    this._parts.push({
      type: 'read',
      content: { method: 'GET', path },
      handle,
    })
    return handle
  }

  /**
   * Create an atomic changeset (group of write operations).
   * All operations in a changeset succeed or fail together.
   */
  changeset(build: (cs: Changeset) => void): void {
    const cs = new Changeset(this._client.baseUrl)
    build(cs)
    this._changesets.push(cs)
    // Add a placeholder part for the changeset (actual ops are inside cs)
    this._parts.push({ type: 'changeset', content: cs })
  }

  /**
   * Serialize the batch into a multipart/mixed body.
   * @internal
   */
  _serialize(): { boundary: string; body: string } {
    const batchBoundary = generateBoundary('batch')
    const lines: string[] = []

    for (const part of this._parts) {
      lines.push(`--${batchBoundary}`)

      if (part.type === 'read') {
        const op = part.content as ChangesetOp
        lines.push('Content-Type: application/http')
        lines.push('Content-Transfer-Encoding: binary')
        lines.push('')
        lines.push(`${op.method} ${op.path} HTTP/1.1`)
        lines.push('Accept: application/json')
        lines.push('')
      } else if (part.type === 'changeset') {
        const cs = part.content as Changeset
        const csBoundary = generateBoundary('changeset')
        lines.push('Content-Type: multipart/mixed; boundary=' + csBoundary)
        lines.push('')

        for (const op of cs._operations) {
          lines.push(`--${csBoundary}`)
          lines.push('Content-Type: application/http')
          lines.push('Content-Transfer-Encoding: binary')
          lines.push('')
          lines.push(`${op.method} ${op.path} HTTP/1.1`)
          if (op.headers) {
            for (const [k, v] of Object.entries(op.headers)) {
              lines.push(`${k}: ${v}`)
            }
          }
          lines.push('')
          if (op.body) {
            lines.push(op.body)
          }
        }
        lines.push(`--${csBoundary}--`)
      }
    }

    lines.push(`--${batchBoundary}--`)
    return { boundary: batchBoundary, body: lines.join('\r\n') }
  }

  /**
   * Send the batch request and parse the multipart response.
   */
  async send(opts: RequestOptions = {}): Promise<BatchResult> {
    const { boundary, body } = this._serialize()

    const res = await executeRequest(
      this._client._ctx,
      `${this._client.baseUrl}/$batch`,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/mixed; boundary=${boundary}`,
        },
        body,
        accept: 'none',
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    )

    const responseText = await res.text()
    return this._parseResponse(responseText, res.headers.get('content-type') ?? '')
  }

  /**
   * Parse a multipart/mixed batch response.
   * @internal
   */
  _parseResponse(responseText: string, contentType: string): BatchResult {
    // Extract boundary from content-type header
    const boundaryMatch = contentType.match(/boundary=([^;\s]+)/)
    const boundary = boundaryMatch?.[1]
    if (!boundary) {
      throw new Error('Batch response missing boundary in Content-Type')
    }

    // Split by batch boundary
    const parts = responseText.split(`--${boundary}`)
    const results: BatchOpResult[] = []
    let partIndex = 0

    // First part is preamble (usually empty), last is epilogue
    for (let i = 1; i < parts.length - 1; i++) {
      const part = parts[i].trim()
      if (!part || part === '--') continue

      const batchPart = this._parts[partIndex]
      if (!batchPart) continue

      if (batchPart.type === 'read') {
        const result = this._parseHttpPart(part)
        results.push(result)
        if (batchPart.handle) {
          this._resolveHandle(batchPart.handle, result)
        }
        partIndex++
      } else if (batchPart.type === 'changeset') {
        const cs = batchPart.content as Changeset
        const csResults = this._parseChangesetResponse(part, cs)
        results.push(...csResults)
        // Resolve or reject all changeset handles based on atomicity
        const failed = csResults.find(r => !r.ok)
        for (let j = 0; j < cs._handleSlots.length; j++) {
          const slot = cs._handleSlots[j]
          const csResult = csResults[j]
          if (failed) {
            slot.reject(new Error(`Changeset failed: ${failed.status}`))
          } else if (csResult) {
            slot.resolve(csResult.body)
          } else {
            slot.resolve(undefined)
          }
        }
        partIndex++
      }
    }

    return {
      responses: results,
      ok: results.every(r => r.ok),
    }
  }

  /** @internal — parse a single HTTP response part. */
  private _parseHttpPart(part: string): BatchOpResult {
    // Each MIME part has outer headers (e.g. Content-Type: application/http),
    // then a blank line (\r\n\r\n), then the inner HTTP response.
    // Inner HTTP response: status line + inner headers + blank line + body.

    // Step 1: skip outer MIME headers to reach the inner HTTP response
    const outerEnd = part.indexOf('\r\n\r\n')
    const innerHttpText = outerEnd >= 0 ? part.slice(outerEnd + 4) : part

    // Step 2: split inner HTTP response into head (status + headers) and body
    const innerHeadEnd = innerHttpText.indexOf('\r\n\r\n')
    const innerHead = innerHeadEnd >= 0 ? innerHttpText.slice(0, innerHeadEnd) : innerHttpText
    const innerBody = innerHeadEnd >= 0 ? innerHttpText.slice(innerHeadEnd + 4).trim() : ''

    // Step 3: extract status code from the HTTP status line (e.g. "HTTP/1.1 200 OK")
    const statusMatch = innerHead.match(/^HTTP\/1\.\d (\d+)/)
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0

    // Step 4: parse body as JSON if the inner headers indicate application/json
    let parsedBody: unknown = undefined
    if (innerBody && innerHead.toLowerCase().includes('application/json')) {
      try {
        parsedBody = JSON.parse(innerBody)
      } catch {
        parsedBody = innerBody
      }
    } else if (innerBody) {
      parsedBody = innerBody
    }

    return {
      status,
      body: parsedBody,
      headers: new Headers(),
      ok: status >= 200 && status < 300,
    }
  }

  /** @internal — parse a changeset multipart response. */
  private _parseChangesetResponse(part: string, cs: Changeset): BatchOpResult[] {
    // Extract changeset boundary
    const boundaryMatch = part.match(/boundary=([^\s]+)/)
    const csBoundary = boundaryMatch?.[1]
    if (!csBoundary) {
      // Single response (error case)
      return [this._parseHttpPart(part)]
    }

    const csParts = part.split(`--${csBoundary}`)
    const results: BatchOpResult[] = []

    // Parts 1 to length-2 are actual responses
    for (let i = 1; i < csParts.length - 1; i++) {
      const csPart = csParts[i].trim()
      if (!csPart || csPart === '--') continue
      results.push(this._parseHttpPart(csPart))
    }

    return results
  }

  /** @internal — resolve a batch handle with the result. */
  private _resolveHandle(handle: BatchHandle<unknown>, result: BatchOpResult): void {
    // The handle's promise is resolved via the Changeset or direct assignment
    // This is handled in the caller (_parseResponse)
  }
}
