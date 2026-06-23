# M4 Plan — fms-odata-js

Status of milestone **M4** (post v0.1.2). Order chosen for risk-adjusted value:

1. Script execution (smallest, ships value first)
2. Containers (binary I/O, self-contained)
3. `$metadata` (schema introspection; unlocks future codegen)
4. `$batch` (largest; multipart, changesets, atomicity)

Each part is independently shippable as a minor release. Targets a roughly
1-KB-gzipped budget per part to stay within the README's "~3 KB" promise
(currently ~3.2 KB per CHANGELOG).

---

## Part 1 — Script execution

### Goal

Invoke FileMaker scripts exposed by FMS as OData **Actions** and return the
parsed result envelope.

### FMS endpoint shape

```
POST /fmi/odata/v4/{db}/Script.{ScriptName}
POST /fmi/odata/v4/{db}/{EntitySet}/Script.{ScriptName}
POST /fmi/odata/v4/{db}/{EntitySet}({key})/Script.{ScriptName}
Content-Type: application/json
Body: { "scriptParameter": "<string>" }      // optional
Response: { "scriptResult": "...", "scriptError": "0" }
```

The two non-database forms run a script *in the context of* the entity set or
row (FMS sets the script's "current record" accordingly).

### Public API

`@/Volumes/DATA00/HOME/Documents/WORK/GITHUB/fms-odata-js/src/scripts.ts` (currently a stub) becomes:

```ts
export interface ScriptOptions extends RequestOptions {
  parameter?: string                  // becomes scriptParameter
}

export interface ScriptResult {
  scriptResult?: string               // raw string returned by Exit Script
  scriptError: string                 // "0" on success
  raw: unknown                        // full parsed body (forward-compat)
}

export class ScriptInvoker {
  constructor(client, scope: { entitySet?: string; key?: ODataLiteral })
  run(name: string, opts?: ScriptOptions): Promise<ScriptResult>
}
```

Surface added to existing classes:

- `FMSOData#script(name, opts?)` — database-level.
- `Query#script(name, opts?)` — entity-set-level (uses the query's entitySet,
  ignores filters/select; documented).
- `EntityRef#script(name, opts?)` — row-level.

### Implementation steps

1. Replace `@/Volumes/DATA00/HOME/Documents/WORK/GITHUB/fms-odata-js/src/scripts.ts:1` stub with `ScriptInvoker` + `runScript()` helper using `executeJson` from `@/Volumes/DATA00/HOME/Documents/WORK/GITHUB/fms-odata-js/src/http.ts`.
2. URL building: reuse `encodePathSegment` from `@/Volumes/DATA00/HOME/Documents/WORK/GITHUB/fms-odata-js/src/url.ts`. Validate script name is non-empty; do not URL-encode the dot in `Script.<name>` but do encode the name segment after the dot.
3. Wire `script()` methods on `FMSOData`, `Query`, `EntityRef`.
4. Map non-zero `scriptError` to a typed `FMSODataError` subclass (`FMScriptError`) carrying `{ scriptError, scriptResult }`. Keep HTTP-layer errors as-is.
5. Re-export `ScriptResult`, `ScriptOptions`, `FMScriptError` from `@/Volumes/DATA00/HOME/Documents/WORK/GITHUB/fms-odata-js/src/index.ts`.

### Tests

- **Unit** (mocked fetch, ~10 cases):
  - DB-level POST URL correctness, no body when `parameter` omitted.
  - Body shape `{ scriptParameter }` when provided.
  - Entity-set + entity-key URL forms.
  - Non-zero `scriptError` raises `FMScriptError` with original payload preserved.
  - 401 retry path still works (delegates to `executeRequest`).
  - `AbortSignal` + `timeoutMs` honored.
- **Integration** (`tests/integration`, opt-in via `FM_ODATA_LIVE=1`):
  - Requires a `Ping` script in `Contacts.fmp12` returning `"pong"` — add to the demo file and document.
  - Round-trip: pass parameter, assert `scriptResult === "pong:<param>"`.

### Docs

- README "Scripts" section with one example.
- `@/Volumes/DATA00/HOME/Documents/WORK/GITHUB/fms-odata-js/docs/filemaker-quirks.md` entry: scripts run server-side, `scriptResult` is **always a string** even if the script returns a number/boolean.

### Acceptance

- All unit tests green; live test green against Contacts demo.
- Bundle delta ≤ ~0.4 KB gzipped.
- Tag `v0.2.0`.

---

## Part 2 — Containers

### Goal

Read, upload, and delete the binary contents of FileMaker container fields.

### FMS endpoint shape

```
GET    /{EntitySet}({key})/{containerField}/$value          → binary stream
PUT    /{EntitySet}({key})/{containerField}/$value          → upload (Content-Type required)
DELETE /{EntitySet}({key})/{containerField}/$value          → clear container
```

Notes:

- Response from `GET` carries `Content-Type` and (for inline-stored containers) `Content-Disposition` with the stored filename.
- FMS may return `Content-Length: 0` for empty containers — treat as null.
- Large files: must not buffer in memory unnecessarily.

### Public API

`@/Volumes/DATA00/HOME/Documents/WORK/GITHUB/fms-odata-js/src/containers.ts` (stub) becomes:

```ts
export interface ContainerDownload {
  blob: Blob                 // browser/Node 18+ both have global Blob
  contentType: string
  filename?: string          // parsed from Content-Disposition
  size: number
}

export interface ContainerUploadInput {
  data: Blob | ArrayBuffer | Uint8Array
  contentType: string
  filename?: string          // becomes Content-Disposition: attachment; filename="…"
}

export class ContainerRef {
  constructor(entity: EntityRef, fieldName: string)
  url(): string
  get(opts?: RequestOptions): Promise<ContainerDownload>
  getStream(opts?: RequestOptions): Promise<ReadableStream<Uint8Array>>
  upload(input: ContainerUploadInput, opts?: RequestOptions): Promise<void>
  delete(opts?: RequestOptions): Promise<void>
}
```

Surface added: `EntityRef#container(fieldName) → ContainerRef`.

### Implementation steps

1. Replace `@/Volumes/DATA00/HOME/Documents/WORK/GITHUB/fms-odata-js/src/containers.ts:1` stub.
2. URL: `entity.toURL() + '/' + encodePathSegment(field) + '/$value'`.
3. `get()` uses `executeRequest` (not `executeJson`) with `accept: 'binary'`; assemble `ContainerDownload` from `await res.blob()` + headers; parse `Content-Disposition` filename (RFC 5987 + simple `filename="x"`).
4. `getStream()` returns `res.body` directly; throws if `null`.
5. `upload()` sends `PUT` with `Content-Type` from input, optional `Content-Disposition`. Body passes through `Blob | ArrayBuffer | Uint8Array` unchanged (fetch handles all three).
6. `delete()` sends `DELETE`; expects `204`.
7. Extend `accept` types in `@/Volumes/DATA00/HOME/Documents/WORK/GITHUB/fms-odata-js/src/http.ts:69` if needed (already has `'binary'`).
8. Re-export `ContainerRef`, `ContainerDownload`, `ContainerUploadInput` from index.

### Tests

- **Unit** (~12 cases, mocked fetch with synthesized `Response` objects carrying `Blob` bodies):
  - URL construction (simple field, field needing percent-encoding).
  - `get()` returns blob + headers + parsed filename (quoted, unquoted, RFC 5987 `filename*=UTF-8''…`).
  - Empty container (`Content-Length: 0`) → `size: 0`, blob has zero bytes.
  - `getStream()` exposes the underlying body; null body throws.
  - `upload()` sets `Content-Type` exactly; `Content-Disposition` only when filename given.
  - `upload()` accepts `Blob`, `ArrayBuffer`, `Uint8Array`.
  - `delete()` resolves on 204.
  - Error envelope on 4xx still flows through `parseErrorResponse`.
- **Integration**:
  - Upload a tiny PNG (committed under `tests/fixtures/`), GET it back, assert byte equality and content-type.
  - Delete and re-GET; expect documented "empty container" shape.

### Docs

- README "Containers" subsection with upload + download example.
- `filemaker-quirks.md`: any FMS-specific empty-container or `Content-Disposition` quirk discovered during integration.

### Acceptance

- Unit + live tests green.
- Bundle delta ≤ ~0.6 KB gzipped.
- Tag `v0.3.0`.

---

## Part 3 — `$metadata`

### Goal

Fetch the OData CSDL XML schema and parse it into a typed JS structure
suitable for runtime introspection. Codegen is **out of scope** here — keep
that for a separate tool/milestone so this part stays bundle-cheap.

### FMS endpoint shape

```
GET /fmi/odata/v4/{db}/$metadata
Accept: application/xml
```

Returns CSDL XML: `<edmx:Edmx>` → `<edmx:DataServices>` →
`<Schema Namespace="…">` → `<EntityType>`, `<EntitySet>`, `<Action>`,
`<Function>`.

### Public API

`@/Volumes/DATA00/HOME/Documents/WORK/GITHUB/fms-odata-js/src/metadata.ts` (stub) becomes:

```ts
export interface EdmProperty {
  name: string
  type: string                 // raw EDM type, e.g. "Edm.String"
  nullable: boolean
  maxLength?: number
}

export interface EdmEntityType {
  name: string
  keys: string[]
  properties: EdmProperty[]
  navigationProperties: { name: string; target: string; collection: boolean }[]
}

export interface EdmEntitySet {
  name: string
  entityType: string           // qualified name
}

export interface EdmAction {       // FileMaker scripts surface here
  name: string
  boundTo?: string               // entity-set qualified name if bound
  parameters: { name: string; type: string }[]
}

export interface ODataMetadata {
  namespace: string
  entityTypes: EdmEntityType[]
  entitySets: EdmEntitySet[]
  actions: EdmAction[]
  raw: string                    // original XML, for debugging
}

// On FMSOData:
db.metadata(opts?): Promise<ODataMetadata>
db.metadataXml(opts?): Promise<string>     // escape hatch
```

### Parser strategy

- **No external deps.** Use a tiny hand-rolled XML walker, or `DOMParser` in browsers + a minimal Node fallback.
- Plan: ship a small dependency-free parser that only understands the subset of CSDL FMS emits (no inheritance, no complex types, no enums in v22). Approx 150–200 LoC.
- Cache the parsed result on the `FMSOData` instance with explicit `db.metadata({ refresh: true })` to refetch.

### Implementation steps

1. Replace `@/Volumes/DATA00/HOME/Documents/WORK/GITHUB/fms-odata-js/src/metadata.ts:1` stub with parser + `fetchMetadata(ctx, baseUrl, opts)`.
2. Add `metadataXml()` (raw text, useful for debugging quirks) and `metadata()` (parsed) on `FMSOData`.
3. Internal cache: `private _metadataCache?: Promise<ODataMetadata>` — never hold stale results across `refresh: true`.
4. Re-export public types from index.

### Tests

- **Unit** (~10 cases):
  - Parse a captured `$metadata` fixture from FMS Contacts (commit under `tests/fixtures/contacts-metadata.xml`).
  - Assert entity sets, keys, property types, nullability for `contact` and `address`.
  - Actions list contains expected scripts (after Part 1 is in place).
  - `metadata()` caches; `metadata({ refresh: true })` refetches.
  - Malformed XML → `FMSODataError` with helpful message.
- **Integration**:
  - Live `db.metadata()` against Contacts FMS; smoke-assert at least 1 entity set + 1 key.

### Docs

- `docs/metadata.md` covering shape of `ODataMetadata` and one introspection example (e.g. "list every entity set's primary key").
- Note in README that codegen is on the roadmap but not part of this release.

### Acceptance

- Parser handles the live Contacts schema without errors.
- Bundle delta ≤ ~1.0 KB gzipped (XML parser dominates).
- Tag `v0.4.0`.

---

## Part 4 — `$batch`

### Goal

Send multiple OData operations in a single HTTP round-trip, with optional
**changesets** giving atomic (all-or-nothing) semantics for groups of writes.

### FMS endpoint shape

```
POST /fmi/odata/v4/{db}/$batch
Content-Type: multipart/mixed; boundary=batch_<uuid>
```

Body is a multipart envelope where each part is either:

- a single GET (read-only, parallelizable on the server), or
- a `changeset` sub-multipart (`Content-Type: multipart/mixed; boundary=changeset_…`)
  containing one or more writes (POST/PATCH/DELETE) executed atomically.

Response mirrors the structure with per-part HTTP responses.

### Public API

```ts
export class Batch {
  constructor(client: FMSOData)
  // Read-only operations (top-level parts):
  add(op: BatchReadOp): BatchHandle<unknown>
  // Atomic group of writes:
  changeset(build: (cs: Changeset) => void): BatchChangesetHandle

  send(opts?: RequestOptions): Promise<BatchResult>
}

export interface Changeset {
  create(entitySet, body): BatchHandle<unknown>
  patch(entitySet, key, body, opts?): BatchHandle<unknown>
  delete(entitySet, key, opts?): BatchHandle<void>
}

export interface BatchResult {
  responses: { status: number; body?: unknown; headers: Headers }[]
  ok: boolean
}

// Surface:
db.batch(): Batch
```

Handles returned from `add` / `changeset.create` etc. resolve when `send()`
completes — letting callers do:

```ts
const batch = db.batch()
const created = batch.changeset(cs => cs.create('contact', { ... }))
const list    = batch.add({ entitySet: 'contact', op: 'list', query: { top: 5 } })
await batch.send()
const row     = await created   // resolves to the parsed body
const rows    = await list
```

### Implementation steps

1. New module `@/Volumes/DATA00/HOME/Documents/WORK/GITHUB/fms-odata-js/src/batch.ts` (replace stub).
2. Multipart **encoder**:
   - Generate boundaries with `crypto.randomUUID()` (Node 18+ + browsers).
   - Emit `Content-Type: application/http`, `Content-Transfer-Encoding: binary`, request line, headers, blank line, body.
   - Reuse `Query#toURL`, `EntityRef#toURL`, etc., but extract just the path+query portion (helper needed).
3. Multipart **decoder**:
   - Split by boundary; for each part, parse headers, locate inner HTTP response, parse status line + headers + body.
   - JSON-parse bodies whose `Content-Type` includes `json`; preserve raw text otherwise.
4. Map sub-responses back to handle promises in declaration order. Per OData spec, on changeset failure all writes in that changeset roll back; mark all of its handles as rejected with the same `FMSODataError`.
5. Wire `FMSOData#batch()`.
6. Document and surface limits (FMS may cap batch size — discover during integration, record in `filemaker-quirks.md`).

### Tests

- **Unit** (~20 cases — this is the bulk of M4 testing):
  - Encoder: snapshot test against a hand-written expected multipart body (read-only single GET; mixed read + changeset; nested changeset with 3 writes).
  - Boundary uniqueness; CRLF correctness; header casing.
  - Decoder: parse fixture multipart responses (success, partial, all-fail-changeset).
  - Handle promise resolution order matches request order.
  - Changeset atomicity: when one write fails, every handle in that changeset rejects.
  - Read-only ops outside changesets resolve independently.
  - 401 retry: whole batch retried once via `onUnauthorized`.
  - `AbortSignal` cancels the in-flight POST.
- **Integration**:
  - Mixed batch: read 5 contacts + create 1 + patch 1 + delete 1, all in a single round-trip; verify state.
  - Atomicity: changeset with one bad PATCH; verify the good operations also rolled back.

### Docs

- `docs/batch.md` with two diagrams (request structure, response mapping) and one full example.
- README mention with link.

### Acceptance

- Unit + live tests green.
- Bundle delta ≤ ~1.2 KB gzipped (encoder + decoder).
- Tag `v0.5.0` and bump README status table to "M4 Done".

---

## Cross-cutting items (do once, before Part 1)

- Add a `tests/fixtures/` directory; commit Contacts `$metadata` XML and a tiny PNG ahead of time so Parts 2 and 3 don't block on fixture capture.
- Decide release cadence: ship one tag per part (recommended) so consumers can adopt incrementally.
- Each part adds a CHANGELOG entry under `[Unreleased]` and graduates it on tag.
