<div align="center">

# fms-odata-js

**A tiny, type-safe OData v4 client built for FileMaker Server.**

Zero runtime dependencies · ~10.6 KB gzipped · ESM + IIFE · Web Viewer / Browser / Node 18+

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![OData](https://img.shields.io/badge/OData-v4-0078D4?logo=data&logoColor=white)](https://www.odata.org/)
[![FileMaker](https://img.shields.io/badge/FileMaker-19.0--26.0-FF6B00?logo=filemaker&logoColor=white)](https://www.claris.com/filemaker/)
[![Bundle](https://img.shields.io/badge/gzip-~10.6%20KB-brightgreen)](#)
[![Deps](https://img.shields.io/badge/runtime%20deps-0-blue)](#)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](#)
[![License](https://img.shields.io/badge/license-MIT-black)](./LICENSE)
[![Spec](https://img.shields.io/badge/spec-fms--odata--spec-FF6B00?logo=filemaker&logoColor=white)](https://github.com/fsans/fms-odata-spec)

</div>

---

## Why fms-odata-js?

FileMaker Server speaks OData v4, but the spec has sharp corners and FMS has quirks. `fms-odata-js` smooths both — so you can forget about URL-encoding `$filter` predicates and focus on your data.

> **Battle-tested in production.** I've been using this library heavily to let FileMaker Web Viewer instances talk to the *same* hosted database they live in — and the performance has been genuinely impressive. Queries that used to require round-tripping through scripts and set-field loops now resolve in a single OData call, with noticeably lower latency and a much cleaner code path. If you're building rich Web Viewer UIs backed by FMS, this is the fastest route I've found.

- **Tiny.** ESM and IIFE bundles, zero runtime dependencies, ~10.6 KB gzipped.
- **Type-safe.** Fluent, chainable query builder with full TS inference.
- **Runs anywhere.** Drop it into a FileMaker Web Viewer, a browser, or Node 18+.
- **FMS-aware.** Handles the documented FMS OData deviations for you.
- **Version-aware.** Detects the FileMaker Server major version (19, 21, 22, 26) from `$metadata` and gates features accordingly.
- **Scripts built in.** Invoke FileMaker scripts at database, entity-set, or record scope — by name or by immutable FMSID (v26+).
- **Containers built in.** Upload, download, stream, or clear container fields with typed helpers — `Blob`, `ArrayBuffer`, and `Uint8Array` all accepted.
- **Aggregations.** `$apply` builder for `aggregate()` and `groupBy()` — server-side sum, average, min, max, count (FMS 2024+).
- **Navigation properties.** Full `$ref` CRUD — `getRefs`, `addRef`, `setRef`, `removeRef` for OData relationship links.
- **Schema introspection.** `$metadata` parsed into typed `ODataMetadata` with entity types, keys, properties, and actions. Cached by default.
- **Schema editing (DDL).** Create/delete tables, add/delete fields, create/delete indexes via the `FileMaker_Tables` and `FileMaker_Indexes` system endpoints. Field types validated against the spec; destructive ops guarded by `confirm: true`.
- **Webhooks.** Create, remove, get, list, and manually invoke webhooks (FMS 2023+ / v21) with typed params and `endpointHeaders` / `queryHeaders` support.
- **Batch requests.** `$batch` builder composes multiple reads and atomic changesets (POST / PATCH / DELETE) into a single HTTP round-trip.
- **Multi-auth.** Basic, Bearer, and FMID (FileMaker Cloud / Claris ID) auth with 401 retry, `AbortSignal`, and timeouts built in.
- **Honest errors.** Every failure becomes a normalized `FMSODataError` (or `FMScriptError` for script failures) with `isFMSODataError` / `isFMScriptError` type guards.

## Status

Full roadmap and changes live in [`CHANGELOG.md`](./CHANGELOG.md).

## Spec alignment

This library follows the [`fms-odata-spec`](https://github.com/fsans/fms-odata-spec) reference specification and depends on [`@fms-odata/spec-ts`](https://www.npmjs.com/package/@fms-odata/spec-ts) (as a devDependency, bundled at build time — zero runtime deps) for shared type definitions and the FileMaker Server version feature matrix. Version detection, feature gating, auth schemes, aggregate functions, and error shapes are all sourced from the spec contract so every implementation in the ecosystem stays in lockstep.

See [`docs/14-reconciliation.md`](https://github.com/fsans/fms-odata-spec/blob/main/docs/14-reconciliation.md) in the spec repo for the full alignment plan.

## Install

```bash
npm install fms-odata-js
```

From GitHub (latest `main`):

```bash
npm install github:fsans/fms-odata-js
```

From a local clone:

```bash
npm install /path/to/fms-odata-js
```

Local dev:

```bash
npm install
npm test          # 227 unit tests, offline
```

## Quick start

```ts
import { FMSOData, basicAuth } from 'fms-odata-js'

const db = new FMSOData({
  host: 'https://fms.example.com',
  database: 'Contacts',
  token: basicAuth('admin', 'secret'), // FMS OData requires Basic auth
  timeoutMs: 15_000,
})

// For FileMaker Cloud, use FMID auth instead:
// import { fmidAuth } from 'fms-odata-js'
// token: fmidAuth(clarisIdToken)

// Collection read
const { value, count } = await db
  .from('contact')
  .select('id', 'first_name', 'last_name')
  .filter((f) => f.eq('last_name', 'Smith'))
  .orderby('last_name')
  .top(50)
  .count()
  .get()

// Create
const created = await db.from('contact').create({
  first_name: 'Alice',
  last_name: 'Liddell',
})

// Read / update / delete a single row
const row = await db.from('contact').byKey(created.id).get()
await db.from('contact').byKey(row.id).patch({ first_name: 'A.' })
await db.from('contact').byKey(row.id).delete()
```

## FileMaker scripts

Invoke FMS-side FileMaker scripts at three scopes. The optional `parameter`
becomes `Get(ScriptParameter)` inside the script; the script's text result is
returned as `scriptResult`.

```ts
// Database scope
const { scriptResult } = await db.script('Ping', { parameter: 'hello' })

// Entity-set scope (script runs with the table as context)
await db.from('contact').script('RebuildIndex')

// Single-record scope (script's current record is set to this row)
await db.from('contact').byKey(42).script('Archive')
```

A non-zero `scriptError` becomes an `FMScriptError` (subclass of
`FMSODataError`), so existing error handlers keep working:

```ts
import { FMScriptError } from 'fms-odata-js'

try {
  await db.script('Risky')
} catch (err) {
  if (err instanceof FMScriptError) {
    console.error(`FM script error ${err.scriptError}: ${err.scriptResult}`)
  } else {
    throw err
  }
}
```

### FMSID-based invocation (v26+)

On FileMaker Server 2026+, scripts can be invoked by their immutable FMSID
instead of name. This survives script renames and database migrations:

```ts
const result = await db.scriptById(42, { parameter: 'hello' })
```

Use `await db.hasFeature('scriptsByFMSID')` to check before calling.

## Container fields

Container fields expose their bytes through `EntityRef#container(fieldName)`.
The handle gives you three I/O shapes plus a clear operation:

```ts
const photo = db.from('contact').byKey(42).container('photo')

// Upload (default: binary mode — image / PDF only per FMS)
await photo.upload({
  data: new Uint8Array(await file.arrayBuffer()),
  contentType: 'image/png',
  filename: 'profile.png',
})

// Upload any file type (zip, docx, …) via base64 encoding
await photo.upload({
  data: zipBytes,
  contentType: 'application/zip',
  filename: 'archive.zip',
  encoding: 'base64',
})

// Download into memory (good for thumbnails, small assets)
const { blob, contentType, filename, size } = await photo.get()

// Or stream it (good for large files — no buffering)
const stream = await photo.getStream()
await stream.pipeTo(someWritable)

// Clear the container
await photo.delete()
```

Under the hood the library uses the two FMS-documented wire formats:
binary mode `PATCH`es `…/<field>` with raw bytes; base64 mode `PATCH`es the
parent record with `<field>@com.filemaker.odata.ContentType` /
`…Filename` annotations. `delete()` clears the value via `PATCH` with
`{ <field>: null }` (FMS has no per-field DELETE for record data).

The `Content-Disposition` filename is parsed for you on download, including
RFC 5987 `filename*=UTF-8''…` for non-ASCII names. On upload, non-ASCII
filenames are emitted in both plain and RFC 5987 form automatically.

## Schema introspection (`$metadata`)

Fetch and inspect the OData CSDL schema emitted by FileMaker Server:

```ts
const meta = await db.metadata()

console.log(meta.namespace)       // e.g. "FileMaker"
console.log(meta.entitySets)      // [{ name: "contact", entityType: "FileMaker.contact" }, …]
console.log(meta.entityTypes)     // [{ name: "contact", keys: ["id"], properties: […] }, …]
console.log(meta.actions)         // FileMaker scripts exposed as OData Actions
```

Results are cached by default. Pass `refresh: true` to force a refetch:

```ts
const fresh = await db.metadata({ refresh: true })
```

Use `metadataXml()` to get the raw CSDL XML for debugging or forward-compat parsing:

```ts
const xml = await db.metadataXml()
```

## Batch requests (`$batch`)

Send multiple operations in a single HTTP round-trip. Reads and atomic changesets
can be freely mixed:

```ts
const batch = db.batch()

// Queue a read (GET)
const contactsHandle = batch.add({
  op: 'list',
  entitySet: 'contact',
  query: { $top: 10, $filter: "status eq 'active'" },
})

// Queue an atomic write group — all succeed or all fail together
batch.changeset(cs => {
  cs.create('contact', { first_name: 'Alice', last_name: 'Liddell' })
  cs.patch('contact', 42, { status: 'archived' })
  cs.delete('invoice', 99)
})

const result = await batch.send()

if (result.ok) {
  console.log('All operations succeeded')
}

// Per-operation status and body are in result.responses (in request order)
for (const r of result.responses) {
  console.log(r.status, r.ok, r.body)
}
```

Changeset operations also expose `If-Match` for optimistic concurrency:

```ts
batch.changeset(cs => {
  cs.patch('contact', 42, { status: 'closed' }, { ifMatch: '"abc123"' })
})
```

## Version detection & feature gating

The library detects the FileMaker Server major version from the
`Org.OData.Core.V1.ProductVersion` annotation in `$metadata` and caches it
for the lifetime of the `FMSOData` instance:

```ts
const v = await db.version()        // '19' | '21' | '22' | '26' | 'future' | null
const info = await db.versionInfo() // full descriptor with feature flags
const ok = await db.hasFeature('applyAggregation') // boolean
```

Feature flags include `applyAggregation`, `scriptsByFMSID`, `webhooks`, and
more — see `FMFeatureFlags` in the type exports. This lets you write
conditional code that adapts to the server's capabilities at runtime.

## Aggregation (`$apply`)

Server-side aggregation via OData `$apply` — requires FileMaker Server 2024+
(v22). Use `hasFeature('applyAggregation')` to check before calling.

```ts
// Aggregate: sum, average, min, max, countdistinct
const { value } = await db
  .from('orders')
  .aggregate([{ field: 'total', function: 'sum', alias: 'totalSum' }])
  .get()
// $apply=aggregate(total with sum as totalSum)

// Group by with aggregation
const { value } = await db
  .from('orders')
  .groupBy(['customerId'], [
    { field: 'total', function: 'sum', alias: 'totalSum' },
    { field: 'total', function: 'average', alias: 'avgTotal' },
  ])
  .get()
// $apply=groupby((customerId),aggregate(total with sum as totalSum,total with average as avgTotal))

// Raw $apply for advanced transformations
const { value } = await db.from('orders').apply('aggregate(total with max as maxTotal)').get()
```

## Navigation properties (`$ref`)

Manage OData relationship links between entities via `$ref`:

```ts
// List related references
const refs = await db.from('contact').byKey(7).getRefs('addresses')
// [{ '@odata.id': 'https://fms.example.com/fmi/odata/v4/DB/address(1)' }, ...]

// Add a reference (POST — for collection-valued navigation properties)
await db.from('contact').byKey(7).addRef('addresses', 42)

// Set a reference (PATCH — for single-valued navigation properties)
await db.from('order').byKey(100).setRef('customer', 7)

// Remove a reference
await db.from('contact').byKey(7).removeRef('addresses', 42)
await db.from('order').byKey(100).removeRef('customer') // clears single-valued
```

## Schema editing (DDL)

Create and delete tables, fields, and indexes via the `FileMaker_Tables` and
`FileMaker_Indexes` system endpoints. Requires a FileMaker account with full
access (schema modification) privileges.

```ts
// Create a table with typed field definitions
await db.createTable({
  tableName: 'Company',
  fields: [
    { name: 'Company ID', type: 'int', primary: true },
    { name: 'Company Name', type: 'varchar(100)', nullable: false },
    { name: 'Notes', type: 'varchar(2000)', global: true },
    { name: 'Signed Contract', type: 'blob', externalSecurePath: 'ContactMgmt/' },
  ],
})

// Add fields to an existing table
await db.addFields({
  tableName: 'Company',
  fields: [{ name: 'Phone', type: 'varchar(30)' }],
})

// Create an index on a field
await db.createIndex('Company', 'Company Name')

// Delete an index
await db.deleteIndex('Company', 'Company Name')

// Delete a field (requires confirm: true — irreversible)
await db.deleteField('Company', 'OldField', { confirm: true })

// Delete a table and all its records (requires confirm: true — irreversible)
await db.deleteTable('OldTable', { confirm: true })
```

Field types follow the spec: `NUMERIC`, `DECIMAL`, `INT`, `DATE`, `TIME`,
`TIMESTAMP`, `VARCHAR(n)`, `CHARACTER VARYING`, `BLOB`, `VARBINARY`,
`LONGVARBINARY`, `BINARY VARYING`. Repetitions in brackets (`INT[4]`), text
length in parentheses (`VARCHAR(200)`). Destructive operations (`deleteTable`,
`deleteField`) require an explicit `{ confirm: true }` guard.

## Webhooks

Manage FileMaker Server webhooks — requires FMS 2023+ (v21). Use
`hasFeature('webhooks')` to check before calling.

```ts
// Create a webhook that fires on record changes in the contact table
const result = await db.createWebhook({
  webhook: 'https://my.example.com:8080/webhook',
  tableName: 'contact',
  select: 'id,first_name,last_name',
  filter: "status eq 'active'",
  notifySchemaChanges: true,
  maxFailedAttempts: 10,
})

// List all webhooks
const all = await db.getAllWebhooks()

// Get a specific webhook's data
const data = await db.getWebhook('wh-id')

// Manually invoke a webhook (useful for testing)
await db.invokeWebhook('wh-id')

// Remove a webhook
await db.removeWebhook('wh-id')
```

The `endpointHeaders` / `queryHeaders` split is supported: `endpointHeaders`
are sent to the webhook URL without affecting processing, while `queryHeaders`
control how the payload is generated. The legacy `headers` alias for
`endpointHeaders` is accepted for backward compatibility.

## Live integration tests

Copy `.env.sample` to `.env` and fill in real FMS credentials:

```bash
npm run probe                                  # quick connectivity check
FM_LIVE=1 npm test -- tests/integration        # full CRUD against real FMS
```

> Using self-signed certs on a LAN box? Set `FM_VERIFY_SSL=0` in `.env`.
>
> Standardized env var names (`FM_SERVER`, `FM_DATABASE`, `FM_USER`,
> `FM_PASSWORD`, `FM_VERIFY_SSL`, `FM_TIMEOUT`, `FM_LIVE`) are preferred.
> Legacy `FM_ODATA_*` names are still accepted as fallbacks.

## Docs

- [`docs/README.md`](./docs/README.md) — API reference and deeper guides
- [`docs/filemaker-quirks.md`](./docs/filemaker-quirks.md) — FMS OData deviations and how this library works around them
- [`docs/filemaker-odata-container-guide.md`](./docs/filemaker-odata-container-guide.md) — full Claris OData container-operations reference
- [`CHANGELOG.md`](./CHANGELOG.md) — full release history
- [fms-odata-spec](https://github.com/fsans/fms-odata-spec) — reference specification this library aligns to
- [`examples/`](./examples) — runnable sample projects
  - [`consumer-node/`](./examples/consumer-node) — Node CLI consuming the library
  - [`webviewer/`](./examples/webviewer) — **standalone HTML page** ready to drop into a FileMaker Web Viewer (uses the IIFE bundle)
- [`examples/Contacts.fmp12`](./examples/Contacts.fmp12) — ready-to-host FileMaker test database matching the examples. **Credentials: `admin` / `admin`** (dev use only — change before exposing to any network).

### Build formats

The library ships three bundle formats:

- **ESM** (`dist/fms-odata.esm.js`) — for Node, bundlers, and modern browsers
- **ESM minified** (`dist/fms-odata.esm.min.js`) — ~10.6 KB gzipped, production use
- **IIFE** (`dist/fms-odata.iife.min.js`) — global `FMSODataLib`, for FileMaker Web Viewer and `<script>` tag inclusion without a bundler

## Contributing

Issues and PRs are welcome. Please run `npm test` and `npm run typecheck` before opening a PR.

## License

[MIT](./LICENSE) © 2026 Francesc Sans, nBCN Software, Barcelona — <http://www.ntwk.es>
