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
 *
 * ⚠️  KNOWN FMS LIMITATIONS (pending investigation — tested against FMS 21.x):
 *
 * 1. GET operations must NOT appear before a changeset.
 *    Placing a read op before a changeset causes FMS to return HTTP 400:
 *    "Expected batch boundary at 'Content-Type: applic...'".
 *    FMS's parser appears to misread the changeset's nested boundary as a
 *    batch-level boundary when GETs precede it.
 *    → Workaround: always add changesets before reads in the batch.
 *
 * 2. Multiple consecutive GET operations return only one fewer response than
 *    expected — the last GET in a sequence is silently dropped by FMS.
 *    E.g. three GETs → only two responses.
 *    → Workaround: limit batches to one read op at the end, or accept the loss.
 *
 * 3. POST/PATCH within a changeset requires an explicit Content-Length header
 *    on the inner HTTP request (FMS cannot determine body length from multipart
 *    structure alone). This is handled by utf8ByteLength() during serialisation.
 *
 * These constraints differ from the OData 4.01 spec and the official Claris
 * documentation examples. They were discovered empirically. Batch support in
 * this library is functional but limited to: changeset (optional) followed by
 * at most one read operation per batch call.
 */
import type { FMSOData } from './client.js';
import type { ODataLiteral } from './url.js';
import type { RequestOptions } from './types.js';
/** Handle returned when adding an operation to a batch. Resolves to the operation result. */
export interface BatchHandle<T> {
    readonly __brand: 'BatchHandle';
    /** @internal */ readonly _promise: Promise<T>;
    /** @internal */ readonly _index: number;
}
/** Input for a read operation (GET) in a batch. */
export interface BatchReadOp {
    /** Entity set name (layout/table). */
    entitySet: string;
    /** Operation type. */
    op: 'list';
    /** Query options: $top, $skip, $filter, etc. */
    query?: {
        $top?: number;
        $skip?: number;
        $filter?: string;
        $select?: string;
    };
}
/** Result of a batch operation. */
export interface BatchOpResult<T = unknown> {
    status: number;
    body?: T;
    headers: Headers;
    ok: boolean;
}
/** Result of executing a batch. */
export interface BatchResult {
    /** All responses in request order. */
    responses: BatchOpResult[];
    /** True if all responses have status < 400. */
    ok: boolean;
}
/** Represents an operation within a changeset. */
interface ChangesetOp {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
}
/** Changeset builder for atomic write operations. */
export declare class Changeset {
    private _ops;
    private _handles;
    private _baseUrl;
    constructor(baseUrl: string);
    /** @internal */
    get _operations(): ChangesetOp[];
    /** @internal */
    get _handleSlots(): Array<{
        resolve: (v: unknown) => void;
        reject: (e: unknown) => void;
    }>;
    /**
     * Create a new entity within this changeset.
     */
    create<T = unknown>(entitySet: string, body: Record<string, unknown>): BatchHandle<T>;
    /**
     * Patch an existing entity within this changeset.
     */
    patch<T = unknown>(entitySet: string, key: ODataLiteral, body: Record<string, unknown>, opts?: {
        ifMatch?: string;
    }): BatchHandle<T>;
    /**
     * Delete an entity within this changeset.
     */
    delete(entitySet: string, key: ODataLiteral, opts?: {
        ifMatch?: string;
    }): BatchHandle<void>;
}
/** Batch builder for composing multipart/mixed requests. */
export declare class Batch {
    private _client;
    private _parts;
    private _changesets;
    constructor(client: FMSOData);
    /**
     * Add a read operation (GET) to the batch.
     * Read operations are not part of a changeset and execute independently.
     */
    add<T = unknown>(op: BatchReadOp): BatchHandle<T>;
    /**
     * Create an atomic changeset (group of write operations).
     * All operations in a changeset succeed or fail together.
     */
    changeset(build: (cs: Changeset) => void): void;
    /**
     * Serialize the batch into a multipart/mixed body.
     * @internal
     */
    _serialize(): {
        boundary: string;
        body: string;
    };
    /**
     * Send the batch request and parse the multipart response.
     */
    send(opts?: RequestOptions): Promise<BatchResult>;
    /**
     * Parse a multipart/mixed batch response.
     * @internal
     */
    _parseResponse(responseText: string, contentType: string): BatchResult;
    /** @internal — parse a single HTTP response part. */
    private _parseHttpPart;
    /** @internal — parse a changeset multipart response. */
    private _parseChangesetResponse;
    /** @internal — resolve a batch handle with the result. */
    private _resolveHandle;
}
export {};
//# sourceMappingURL=batch.d.ts.map