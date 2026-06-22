# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Spec alignment with @fm-odata/spec-ts

This release aligns fm-odata-js with the [FM-ODATA_SPEC](https://github.com/fsans/FM-ODATA_SPEC) reference specification. The library now depends on `@fm-odata/spec-ts` (as a devDependency — bundled at build time, zero runtime deps) for shared type definitions and the version feature matrix.

- **Version detection & feature gating.** `FMOData#version()` lazily fetches `$metadata`, extracts the `Org.OData.Core.V1.ProductVersion` annotation, and caches the detected FileMaker Server major version (`'19'`, `'21'`, `'22'`, `'26'`, or `'future'`). `FMOData#versionInfo()` returns the full version descriptor with feature flags. `FMOData#hasFeature(feature)` checks if the server supports a specific feature (e.g., `applyAggregation`, `scriptsByFMSID`, `webhooks`). 12 unit tests.
- **`$apply` aggregation support.** `Query#apply(expr)` sets a raw `$apply` expression. `Query#aggregate(expressions)` builds `aggregate(field with function as alias)`. `Query#groupBy(fields, aggregateExpressions?)` builds `groupby((fields),aggregate(...))`. Requires FMS 2024+ (v22). 7 unit tests.
- **FMSID-based script invocation.** `FMOData#scriptById(fmsid, opts)` invokes a script by its immutable FMSID via `Script.FMSID:<id>` URL. `ScriptInvoker#runById(fmsid, opts)` and `ScriptInvoker#urlById(fmsid)` provide the low-level API. Requires FMS 2026+ (v26). 7 unit tests.
- **Record references (`$ref`).** `EntityRef#getRefs(navProperty)`, `addRef(navProperty, relatedKey)`, `setRef(navProperty, relatedKey)`, and `removeRef(navProperty, relatedKey?)` provide full OData `$ref` CRUD for navigation properties. 9 unit tests.
- **FMID auth support.** `fmidAuth(token)` helper builds an `FMID <token>` Authorization header for FileMaker Cloud. The HTTP client now recognizes the `FMID` auth scheme prefix.
- **Spec type re-exports.** Version types (`FMVersionMajor`, `FMVersionInfo`, `FMFeatureFlags`, `FMQueryOptionFlags`), auth types (`FMAuthScheme`, `FMAuthToken`, `FMAuthTokenProvider`), aggregate types (`AggregateFunction`), and error types (`ODataErrorBody`) are re-exported from `@fm-odata/spec-ts`.
- **Error helpers.** `isFMODataError(err)` and `isFMScriptError(err)` type guards.
- **Standardized env var names.** The test harness and probe script now accept standardized env var names (`FM_SERVER`, `FM_DATABASE`, `FM_USER`, `FM_PASSWORD`, `FM_VERIFY_SSL`, `FM_TIMEOUT`, `FM_LIVE`) alongside the legacy `FM_ODATA_*` names. Standardized names take precedence. `.env.sample` updated with both forms documented.

### Fixed

- **Query parameter encoding now preserves OData-special characters.** `odataEncode()` (used by `buildQueryString`, `Query#toURL()`, and batch operations) keeps commas (`,`), dollar signs (`$`), equals (`=`), and semicolons (`;`) as literal characters instead of percent-encoding them. FileMaker Server rejects `%2C`, `%24`, `%3D`, and `%3B` in `$select`, `$orderby`, `$expand`, and other system query options—now these parameters work correctly with multiple field names and nested expand options (e.g., `$expand=Orders($select=id,total;$top=5)`). (Ported from FMS-ODATA-MCP fix.)

### Added

- M6 — OData `$batch` multipart request/response:
  - `FMOData#batch()` returns a `Batch` builder for composing multi-operation requests in a single HTTP round-trip.
  - `Batch#add(op)` queues a read operation (GET entity-set with optional `$top`, `$skip`, `$filter`, `$select`). Returns a `BatchHandle<T>`.
  - `Batch#changeset(build)` defines an atomic group of write operations (POST / PATCH / DELETE). All operations in a changeset succeed or fail together.
  - `Changeset#create(entitySet, body)`, `Changeset#patch(entitySet, key, body, opts?)`, `Changeset#delete(entitySet, key, opts?)` add write operations. Each accepts an optional `If-Match` header.
  - `Batch#send(opts?)` serialises the multipart/mixed body, POSTs to `/<db>/$batch`, and parses the multipart response back into per-operation `BatchOpResult` objects.
  - `BatchResult` aggregates all responses in request order with an `ok` boolean (true when all statuses < 400).
  - `BatchHandle<T>` carries a `_promise` that resolves/rejects individually when the batch settles.
  - Exported types: `Batch`, `Changeset`, `BatchHandle`, `BatchReadOp`, `BatchOpResult`, `BatchResult`.
  - OData `$`-prefixed query parameters (`$top`, `$filter`, etc.) are serialised without percent-encoding the `$` sign, which is required by FMS.
  - Multipart MIME parser correctly strips outer `application/http` MIME headers before extracting the inner HTTP status line and body.
  - 14 unit tests covering serialisation (read, changeset, PATCH/DELETE, string-key escaping), response parsing (single/multi, error, mixed read+changeset), header forwarding, `$batch` URL, and `AbortSignal`.
  - Live integration test: sends a batch with a read and a single-create changeset, asserts both responses are successful, and cleans up any created rows.

- M5 — OData `$metadata` parser:
  - `FMOData#metadata(opts?)` fetches and parses the CSDL XML into a typed `ODataMetadata` object.
  - `FMOData#metadataXml(opts?)` returns the raw XML (escape hatch for debugging).
  - New exported types: `ODataMetadata`, `EdmEntityType`, `EdmEntitySet`, `EdmProperty`, `EdmAction`.
  - Metadata results are cached by default; pass `refresh: true` to force a refetch.
  - Lightweight ~200 LoC XML parser with zero external dependencies (bundle budget ~1 KB gzipped).
  - 15 unit tests covering entity types, keys, properties, navigation properties, entity sets, and actions.
  - Live integration test fetches metadata from the configured FMS instance.

## [0.1.5] - 2026-04-29

### Added

- M4 Part 2 — FileMaker container field I/O:
  - `EntityRef#container(fieldName) → ContainerRef` handle for per-field binary operations.
  - `ContainerRef.get()` / `getStream()` download via `GET …/<field>/$value` as a `Blob` or `ReadableStream<Uint8Array>` (with parsed `Content-Type`, `size`, and RFC 6266 `filename`).
  - `ContainerRef.upload(input)` supports two FMS-documented wire formats, selectable via `input.encoding`:
    - `'binary'` (default): `PATCH …/<field>` with raw bytes plus `Content-Type` and (optionally) `Content-Disposition: inline; filename="…"`. Restricted to PNG, JPEG, GIF, TIFF, and PDF.
    - `'base64'`: `PATCH …/<EntitySet>(<key>)` with `{ "<field>": "<base64>", "<field>@com.filemaker.odata.ContentType": "…", "<field>@com.filemaker.odata.Filename": "…" }`. Useful for updating multiple containers (or container + regular fields) in one round-trip.
  - `ContainerRef.delete()` clears the value via `PATCH …/<EntitySet>(<key>)` with `{ "<field>": null }` (no per-field DELETE endpoint exists on FMS).
  - `ContainerDownload` / `ContainerUploadInput` types exported (`encoding` and `contentType` are optional).
- `ContainerUploadInput.contentType` is now optional. When omitted, the library sniffs the MIME from the payload's magic bytes (PNG, JPEG, GIF, TIFF, PDF) and rejects unrecognised payloads up-front. New exported helper `sniffContainerMime(bytes)`.
- `image/tiff` added to `FM_CONTAINER_SUPPORTED_MIME_TYPES`. Round-trips correctly through the OData container endpoints.
- `EntityRef#fieldValue<V>(fieldName)` — `GET /<EntitySet>(<key>)/<fieldName>` and unwrap the OData `{ value: … }` envelope. Useful for fetching a single scalar column without composing a `$select` query.
- `keepalive: true` on every fetch for HTTP connection reuse.
- 35 container unit tests + 16 entity unit tests (was 23 + 13). Coverage includes TIFF acceptance, PNG/PDF magic-byte sniffing on upload, every `sniffContainerMime` branch, and `fieldValue` (basic / percent-encoded field name / null value).
- Live integration test: uploads a 68-byte PNG fixture (`tests/fixtures/pixel.png`) to a `photo_content` container on a throw-away contact row, reads it back, asserts byte equality, and clears. Soft-skips when the field is missing in the solution.
- `docs/filemaker-quirks.md`: new sections documenting (a) FMS rejects `PUT` on the OData endpoint and has no per-field DELETE for record data, (b) the `Accept: application/octet-stream` quirk on `$value`, (c) the `Untitled.png` auto-generated filename, and (d) field-tested observations on `/$count` URL FMS vs FMC, `OData-Version` enforcement, `Edm.Stream` vs `Edm.Binary`, and single-quote escaping in keys.
- `docs/container-download-problem.md`: investigation log for the Accept-header quirk, marked Resolved.
- `docs/filemaker-odata-container-guide.md`: full Claris OData container-operations reference vendored into the repo.

### Fixed

- **Container downloads now return binary, not the stored filename string.** `ContainerRef.get()` and `getStream()` now send `Accept: */*` (was `application/octet-stream`). FMS 22 returns the field's stored reference value as `text/plain;charset=utf-8` for the `octet-stream` Accept header — every other Accept value returns the actual binary with the correct `Content-Type`. See [`docs/filemaker-quirks.md`](docs/filemaker-quirks.md). The previous "filename causes file reference" hypothesis was a misdiagnosis; filenames round-trip correctly via `Content-Disposition: attachment; filename="…"`.
- Live integration test for scripts now soft-skips on FMS's actual "Script not found" HTTP response (a plain `FMODataError` with that message), in addition to the originally-anticipated `scriptError: "104"` envelope path.

## [0.1.4] - 2026-04-28

### Added

- M4 Part 1 — FileMaker script execution:
  - `FMOData#script(name, opts?)`, `Query#script(name, opts?)`, `EntityRef#script(name, opts?)` POST to the FMS `Script.<name>` action endpoint at database, entity-set, or single-record scope.
  - `ScriptOptions` (`parameter`, `signal`) maps to the FMS `{ "scriptParameter": "..." }` body when provided.
  - `ScriptResult` envelope (`scriptResult`, `scriptError`, `raw`).
  - `FMScriptError` (subclass of `FMODataError`) thrown when a script returns a non-zero `scriptError`; HTTP-level failures still surface as plain `FMODataError`.
  - Public `ScriptInvoker` for advanced callers that need to build invocation paths manually.
  - 15 new unit tests covering URL construction at all three scopes, parameter encoding, error promotion, envelope unwrapping, 401 retry, and `AbortSignal` propagation.
  - Optional live integration test: define a `Ping` script in the Contacts demo (or set `FM_ODATA_PING_SCRIPT`) and the live suite will exercise it.

## [0.1.2] - 2026-04-22

### Added

- `examples/webviewer/`: standalone HTML demo for the `Contacts` solution, in two variants:
  - `index.html` — loads the library from jsDelivr (`/gh/fsans/fm-odata-js@v0.1.1`).
  - `index-inline.html` — fully inlined bundle; zero runtime network dependencies.
- `examples/Contacts.fmp12` referenced from the docs as a ready-to-host demo database.

### Changed

- README overhaul: centered hero, badges, feature bullets, status table, production testimonial blockquote, Docs/Contributing/License sections.
- `examples/consumer-node/README.md`: added a "Test database" section and sanitized placeholder credentials.
- `LICENSE`: corrected copyright holder name to `Francesc Sans`.

## [0.1.1] - 2026-04-22

### Added

- M1 scaffold: repo layout, TypeScript/Vitest/Playwright/esbuild configs, empty `FMOData` class, placeholder failing unit test.
- M2 query + URL layer:
  - `src/url.ts`: `escapeStringLiteral`, `formatDateTime`, `parseDateTime`, `formatLiteral`, `encodePathSegment`, `buildQueryString`.
  - `src/query.ts`: `Query` fluent builder (`select`, `filter`, `or`, `expand`, `orderby`, `top`, `skip`, `count`, `search`, `toURL`), `Filter` class, `filterFactory`.
  - `FMOData#from(entitySet)` returns a `Query`.
  - Public exports: `Query`, `Filter`, `filterFactory`, `FilterFactory`, `FilterInput`, `OrderDir`, `ODataLiteral`.
  - 62 passing unit tests covering every builder path and URL edge case.
  - Minified bundle ~4.2 KB raw / ~1.55 KB gzipped.
- Dev tooling:
  - `.env.sample` / `.env` for local FMS config; `.env` is git-ignored.
  - `scripts/env.mjs`, `scripts/insecure-fetch.mjs`, `scripts/probe.mjs`.
  - `npm run probe` validates connectivity, auth, and the `Contacts` schema against a live FMS.
  - `FM_ODATA_INSECURE_TLS=1` toggles `NODE_TLS_REJECT_UNAUTHORIZED=0` for dev use with self-signed certs.
- `docs/filemaker-quirks.md` documenting: Basic-auth-only on OData, `/$count` returning 400, self-signed cert handling.
- M3 CRUD + auth + errors:
  - `src/http.ts`: shared request executor — `resolveAuthHeader` (Basic/Bearer auto-detect), `basicAuth(user, pass)` helper, `combineSignals`, `executeRequest`, `executeJson`.
  - `src/errors.ts`: `parseErrorResponse` handling OData JSON envelope + FileMaker XML envelope.
  - `src/entity.ts`: `EntityRef` with `.get()`, `.patch()` (with `ifMatch`, `returnRepresentation`), `.delete()`.
  - `Query#create()` (POST), `Query#get()` returning `{ value, count?, nextLink? }`, `Query#byKey(key)` returning `EntityRef`.
  - `FMOData#request()` / `FMOData#rawRequest()` low-level escape hatches.
  - 401 retry via `onUnauthorized` (once), `AbortSignal` + `timeoutMs` composition.
  - 100 passing unit tests (mocked fetch); 3 passing live-integration tests against the `Contacts` DB covering read, full CRUD round-trip, and error handling.
  - Opt-in live suite: `FM_ODATA_LIVE=1 npm test -- tests/integration`.
  - Bundle now ~8.8 KB raw / ~3.2 KB gzipped.
