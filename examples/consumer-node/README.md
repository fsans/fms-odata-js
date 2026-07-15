# fms-odata-js Consumer Example

A comprehensive demonstration of using `fms-odata-js` (v0.4.0) in a Node.js environment via a local `file:` dependency. This example showcases all major features:

| Feature | Demo in this example |
|---------|----------------------|
| M1-M2: CRUD Queries | List rows from each table with `$top` and `$count` |
| M3: Script Execution | Call the `Ping` script with a parameter |
| M4: Container I/O | Download container field content |
| M5: Metadata | Introspect the OData schema (`$metadata`) |
| M6: Batch Operations | Atomic changeset + read in one request |
| v0.2.0: Version Detection | Detect FMS major version and feature flags |
| v0.2.0: Aggregation (`$apply`) | Server-side countdistinct via `aggregate()` |
| v0.2.0: Navigation (`$ref`) | List related records via `getRefs()` |
| v0.4.0: Schema Editing (DDL) | Create/delete tables, fields, indexes |
| v0.4.0: Webhook Management | Create, list, get, invoke, delete webhooks |

## Test Database

A ready-to-host FileMaker file is bundled at [`../Contacts.fmp12`](../Contacts.fmp12).
Host it on an FMS instance with the OData API enabled, then point the example
at it using the env vars below.

> **Default credentials:** `admin` / `admin`
>
> These exist purely for local testing. **Change them before hosting the file
> on any network you do not fully control.**

## Setup

```bash
cd examples/consumer-node
npm install
```

`npm install` symlinks the parent `fms-odata-js` package into
`node_modules/fms-odata-js`, so any rebuild of the library (`npm run build` in
the repo root) is immediately visible to this example.

## Run

The example reads FMS connection settings from environment variables:

```bash
# Node 20.6+ can load .env natively
node --env-file=../../.env index.mjs

# Older Node: export the vars manually
export FM_SERVER=https://fms.example.com
export FM_DATABASE=Contacts
export FM_USER=your-fms-user
export FM_PASSWORD=your-fms-password
export FM_VERIFY_SSL=0   # only for self-signed LAN certs
node index.mjs
```

> Standardized env var names (`FM_SERVER`, `FM_DATABASE`, `FM_USER`, `FM_PASSWORD`,
> `FM_VERIFY_SSL`) are preferred. Legacy `FM_ODATA_*` names are still accepted as
> fallbacks.

## Example Output

```text
[example] Connected to https://fms.example.com/Contacts

============================================================
1. BASIC QUERIES (M1-M2)
============================================================
[version] FileMaker Server major version: 22
[version] Features: applyAggregation=true, scriptsByFMSID=false

contact   total=5  first 3 row(s):
  {id, first_name, last_name, email}
  {id, first_name, last_name, email}
  {id, first_name, last_name, email}

address   total=3  first 3 row(s):
  ...

============================================================
2. SCRIPT EXECUTION (M3)
============================================================
script    Ping => result="hello-from-fms-odata-js" error=0

============================================================
3. METADATA INTROSPECTION (M5)
============================================================
namespace: FileMaker
entitySets: 4 table(s)
  - contact (FileMaker.contact)
  - address (FileMaker.address)
  - email (FileMaker.email)
  - phone (FileMaker.phone)

entityTypes: 4 type(s)
  contact entity keys: [id]
  contact fields: 12
    sample: id, first_name, last_name, email, company...

============================================================
4. BATCH OPERATIONS (M6)
============================================================
batch     queued: 1 changeset (create) + 1 read
batch     result: ALL OK
batch     responses: 2
  [0] status=201 ok=true
  [1] status=200 ok=true

============================================================
5. CONTAINER FIELDS (M4)
============================================================
container using record id=42
container field URL: https://fms.example.com/fmi/odata/v4/Contacts/contact(42)/photo/$value
container field "photo" is empty or doesn't exist (this is OK)

============================================================
6. AGGREGATION / $apply (v0.2.0)
============================================================
$apply    groupby first_name,last_name: 239 distinct combo(s)
  -> Barbara Anderson
  -> Barbara Brown
  -> Barbara Davis
  -> Barbara Garcia
  ... and 234 more

============================================================
7. NAVIGATION PROPERTIES / $ref (v0.2.0)
============================================================
$ref      using contact id=1
$ref      found 2 related address(es)
  -> https://fms.example.com/fmi/odata/v4/Contacts/address(1)
  -> https://fms.example.com/fmi/odata/v4/Contacts/address(2)

============================================================
Example complete!
============================================================
```

## Feature Details

### M1-M2: Basic Queries

```ts
const { value, count } = await db.from('contact').top(3).count().get()
```

### M3: Script Execution

```ts
const { scriptResult, scriptError } = await db.script('Ping', {
  parameter: 'hello-from-fms-odata-js',
})
```

### M4: Container Fields

```ts
// Get a container reference
const container = db.from('contact').byKey(42).container('photo')

// Download
const { blob, filename, contentType, size } = await container.get()

// Upload (binary or base64 encoding)
await container.upload({
  data: fileBlob,
  filename: 'avatar.png',
  encoding: 'binary' // or 'base64' for arbitrary file types
})

// Clear
await container.delete()
```

### M5: Metadata

```ts
const meta = await db.metadata()

console.log(meta.namespace)        // "FileMaker"
console.log(meta.entitySets)       // All tables
console.log(meta.entityTypes)      // Field definitions
console.log(meta.actions)          // Exposed scripts

// Force refresh
const fresh = await db.metadata({ refresh: true })

// Raw XML only
const xml = await db.metadataXml()
```

### v0.2.0: Version Detection & Feature Gating

```ts
const version = await db.version()        // '19' | '21' | '22' | '26' | 'future' | null
const info = await db.versionInfo()       // full descriptor with feature flags
const ok = await db.hasFeature('applyAggregation') // boolean
```

### v0.2.0: Aggregation (`$apply`)

```ts
// Group by fields (works on FMS v22+ and v26)
const { value: grouped } = await db
  .from('contact')
  .groupBy(['first_name', 'last_name'])
  .get()

// Aggregate (requires FMS 2024+; note: FMS v26 has a parser bug
// that rejects aggregate(...) syntax — use groupby where possible)
const { value } = await db
  .from('contact')
  .aggregate([{ field: 'id', function: 'countdistinct', alias: 'total' }])
  .get()

// Group by with aggregation
const { value: grouped2 } = await db
  .from('orders')
  .groupBy(['customerId'], [
    { field: 'total', function: 'sum', alias: 'totalSum' },
  ])
  .get()
```

### v0.2.0: Navigation Properties (`$ref`)

```ts
// List related references
const refs = await db.from('contact').byKey(7).getRefs('address')

// Add a reference (POST)
await db.from('contact').byKey(7).addRef('address', 42)

// Set a reference (PATCH — single-valued)
await db.from('order').byKey(100).setRef('customer', 7)

// Remove a reference
await db.from('contact').byKey(7).removeRef('address', 42)
```

### v0.4.0: Schema Editing (DDL)

Create, modify, and delete tables, fields, and indexes. Requires FMS 2023+ (v20).

```ts
// Create a table
await db.schema().createTable({
  tableName: 'Company',
  fields: [
    { name: 'id', type: 'int', primary: true },
    { name: 'name', type: 'varchar(100)', nullable: false },
  ],
})

// Add fields to an existing table
await db.schema().addFields({
  tableName: 'Company',
  fields: [{ name: 'phone', type: 'varchar(30)' }],
})

// Create an index on a field
await db.schema().createIndex('Company', 'name')

// Delete a field (requires confirm: true)
await db.schema().deleteField('Company', 'oldField', { confirm: true })

// Delete a table (requires confirm: true)
await db.schema().deleteTable('Company', { confirm: true })
```

### v0.4.0: Webhook Management

Create, list, get, invoke, and delete webhooks. Requires FMS 2025+ (v22).

```ts
// Create a webhook
const { id } = await db.webhooks().create({
  webhook: 'https://my.example.com:8080/wh',
  tableName: 'contact',
  select: 'id,first_name',
  filter: "status eq 'active'",
  notifySchemaChanges: true,
})

// List all webhooks
const result = await db.webhooks().getAll()

// Get a specific webhook
const data = await db.webhooks().get(id)

// Invoke (trigger) a webhook for testing
await db.webhooks().invoke(id)
await db.webhooks().invoke(id, { rowIDs: [10, 20] })

// Delete a webhook
await db.webhooks().remove(id)
```

### M6: Batch Operations

```ts
const batch = db.batch()

// Queue reads
const contactsHandle = batch.add({
  op: 'list',
  entitySet: 'contact',
  query: { $top: 10, $filter: "status eq 'active'" }
})

// Queue atomic writes (changeset)
batch.changeset(cs => {
  cs.create('contact', { first_name: 'Alice', last_name: 'Liddell' })
  cs.patch('contact', 42, { status: 'archived' })
  cs.delete('invoice', 99)
})

// Send all at once
const result = await batch.send()

// Per-operation results
for (const r of result.responses) {
  console.log(r.status, r.ok, r.body)
}

// Or await individual handles
const contacts = await contactsHandle._promise
```

## TypeScript Variant

If your consumer project uses TypeScript, the same code works verbatim — the
library ships `.d.ts` files alongside the bundle. Simply:

```ts
import { FMSOData, basicAuth, bearerAuth, type QueryResult, type ODataMetadata } from 'fms-odata-js'

interface Contact {
  id: number
  first_name: string
  last_name: string
}

const db = new FMSOData({ /* ... */ })
const result: QueryResult<Contact> = await db.from<Contact>('contact').top(5).get()
const meta: ODataMetadata = await db.metadata()
```

Autocomplete, type-checking, and go-to-definition all work out of the box.

## Script Setup

To exercise the script demo, add a script to the `Contacts` solution that simply
echoes its parameter:

```filemaker
# Script: "Ping"
Exit Script [Text Result: Get(ScriptParameter)]
```

If the script is missing the example detects FileMaker error `104` and prints
a "skipping" line instead of failing. Override the name via
`FM_ODATA_PING_SCRIPT` if your script is called something else.

## Container Field Setup

The container demo attempts to access a `photo` field on the `contact` table.
To test upload/download:

1. Add a container field named `photo` to the `contact` table
2. Set `FM_ODATA_DEMO_RECORD_ID` to a specific record ID, or let it auto-find one
3. Uncomment the upload section in `index.mjs` to test binary uploads
