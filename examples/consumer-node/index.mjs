// fms-odata-js comprehensive consumer example (v0.4.0)
//
// Demonstrates all major features:
// - Basic CRUD queries (M1-M2)
// - Script execution (M3)
// - Container field I/O (M4)
// - Metadata introspection (M5)
// - Batch operations (M6)
// - Version detection & feature gating (v0.2.0)
// - $apply aggregation (v0.2.0)
// - Navigation properties / $ref (v0.2.0)
// - Schema editing / DDL (v0.4.0)
// - Webhook management (v0.4.0)
//
// Environment (standardized names preferred, legacy FM_ODATA_* accepted as fallback):
//   FM_SERVER                  e.g. https://192.168.0.24
//   FM_DATABASE                e.g. Contacts
//   FM_USER                    FMS account with OData privileges
//   FM_PASSWORD                matching password
//   FM_VERIFY_SSL=0            optional, for self-signed LAN certs
//   FM_ODATA_PING_SCRIPT       optional, script name (default: "Ping")
//   FM_ODATA_DEMO_RECORD_ID    optional, record ID for container demo (default: finds first)
//
// Run:
//   npm install
//   node --env-file=../../.env index.mjs     # Node 20.6+
//   # or: export the vars yourself and: node index.mjs

import { FMSOData, basicAuth, FMSODataError, FMScriptError } from 'fms-odata-js'

const {
  // Standardized env var names (preferred)
  FM_SERVER,
  FM_DATABASE,
  FM_USER,
  FM_PASSWORD,
  FM_VERIFY_SSL,
  // Legacy fallbacks
  FM_ODATA_HOST,
  FM_ODATA_DATABASE,
  FM_ODATA_USER,
  FM_ODATA_PASSWORD,
  FM_ODATA_INSECURE_TLS,
  // Optional config
  FM_ODATA_PING_SCRIPT,
  FM_ODATA_DEMO_RECORD_ID,
  FM_ODATA_CONTAINER_FIELD,
} = process.env

// Resolve standardized names with legacy fallbacks
const host = FM_SERVER || FM_ODATA_HOST
const database = FM_DATABASE || FM_ODATA_DATABASE
const user = FM_USER || FM_ODATA_USER
const password = FM_PASSWORD || FM_ODATA_PASSWORD

// Validate required env vars
for (const [name, val] of Object.entries({ FM_SERVER: host, FM_DATABASE: database, FM_USER: user, FM_PASSWORD: password })) {
  if (!val) {
    console.error(`Missing env var: ${name} (or legacy FM_ODATA_* equivalent)`)
    process.exit(1)
  }
}

// For self-signed certs on LAN FMS boxes. DEV ONLY.
// FM_VERIFY_SSL=0 (standardized) or FM_ODATA_INSECURE_TLS=1 (legacy, inverted logic)
if (FM_VERIFY_SSL === '0' || FM_ODATA_INSECURE_TLS === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  console.warn('[example] TLS verification disabled (dev only).\n')
}

const db = new FMSOData({
  host,
  database,
  token: basicAuth(user, password),
  timeoutMs: 15_000,
})

console.log(`[example] Connected to ${host}/${database}\n`)
console.log('='.repeat(60))
console.log('1. BASIC QUERIES (M1-M2)')
console.log('='.repeat(60))

// Also demonstrate version detection (v0.2.0)
try {
  const version = await db.version()
  console.log(`[version] FileMaker Server major version: ${version ?? 'unknown'}`)
  if (version) {
    const info = await db.versionInfo()
    console.log(`[version] Features: applyAggregation=${info?.features.applyAggregation}, scriptsByFMSID=${info?.features.scriptsByFMSID}`)
  }
} catch (err) {
  console.log(`[version] detection failed: ${err.message}`)
}
console.log()

// Query all tables
for (const table of ['contact', 'address', 'email', 'phone']) {
  try {
    const { value, count } = await db.from(table).top(3).count().get()
    console.log(`${table.padEnd(8)}  total=${count ?? '?'}  first ${value.length} row(s):`)
    for (const row of value) {
      const keys = Object.keys(row).slice(0, 4).join(', ')
      console.log(`  {${keys}${Object.keys(row).length > 4 ? ', ...' : ''}}`)
    }
  } catch (err) {
    if (err instanceof FMSODataError) {
      console.log(`${table.padEnd(8)}  ERROR ${err.status} ${err.code ?? ''} ${err.message}`)
    } else {
      throw err
    }
  }
  console.log()
}

console.log('='.repeat(60))
console.log('2. SCRIPT EXECUTION (M3)')
console.log('='.repeat(60))

const scriptName = FM_ODATA_PING_SCRIPT ?? 'Ping'
try {
  const { scriptResult, scriptError } = await db.script(scriptName, {
    parameter: 'hello-from-fms-odata-js',
  })
  console.log(`script    ${scriptName} => result=${JSON.stringify(scriptResult)} error=${scriptError}`)
} catch (err) {
  if (err instanceof FMScriptError && err.scriptError === '104') {
    console.log(`script    ${scriptName} not present (FM error 104) — skipping`)
  } else if (err instanceof FMSODataError) {
    console.log(`script    ${scriptName} HTTP ${err.status} ${err.code ?? ''} ${err.message}`)
  } else {
    throw err
  }
}

console.log()
console.log('='.repeat(60))
console.log('3. METADATA INTROSPECTION (M5)')
console.log('='.repeat(60))

try {
  const meta = await db.metadata()

  console.log(`namespace: ${meta.namespace}`)
  console.log(`entitySets: ${meta.entitySets.length} table(s)`)
  for (const es of meta.entitySets.slice(0, 4)) {
    console.log(`  - ${es.name} (${es.entityType})`)
  }
  if (meta.entitySets.length > 4) {
    console.log(`  ... and ${meta.entitySets.length - 4} more`)
  }

  console.log(`\nentityTypes: ${meta.entityTypes.length} type(s)`)
  const contactType = meta.entityTypes.find(et => et.name === 'contact')
  if (contactType) {
    console.log(`  contact entity keys: [${contactType.keys.join(', ')}]`)
    console.log(`  contact fields: ${contactType.properties.length}`)
    const sampleFields = contactType.properties.slice(0, 5).map(p => p.name).join(', ')
    console.log(`    sample: ${sampleFields}...`)
  }

  if (meta.actions.length > 0) {
    console.log(`\nactions: ${meta.actions.length} script(s) exposed`)
    for (const action of meta.actions.slice(0, 3)) {
      console.log(`  - ${action.name}${action.boundTo ? ` (bound to ${action.boundTo})` : ''}`)
    }
  }
} catch (err) {
  console.log(`metadata  ERROR: ${err.message}`)
}

console.log()
console.log('='.repeat(60))
console.log('4. BATCH OPERATIONS (M6)')
console.log('='.repeat(60))

// NOTE: FMS OData batch has known limitations (see src/batch.ts):
// - Changesets must come BEFORE read operations
// - At most one read op reliably returns a response
try {
  const batch = db.batch()

  // Changeset FIRST (FMS requires writes before reads)
  batch.changeset(cs => {
    cs.create('contact', { first_name: 'Batch', last_name: 'Test' })
  })

  // Single read AFTER the changeset
  const readHandle = batch.add({
    op: 'list',
    entitySet: 'contact',
    query: { $top: 2 }
  })

  console.log(`batch     queued: 1 changeset (create) + 1 read`)

  const result = await batch.send()
  console.log(`batch     result: ${result.ok ? 'ALL OK' : 'SOME FAILED'}`)
  console.log(`batch     responses: ${result.responses.length}`)

  for (let i = 0; i < result.responses.length; i++) {
    const r = result.responses[i]
    console.log(`  [${i}] status=${r.status} ok=${r.ok}`)
  }

} catch (err) {
  console.log(`batch     ERROR: ${err.message}`)
}

console.log()
console.log('='.repeat(60))
console.log('5. CONTAINER FIELDS (M4)')
console.log('='.repeat(60))

// Container demo - tries to find a record with a container field
// For the Contacts demo, we'll demonstrate with a photo field if it exists
try {
  // First, get a sample record ID
  let demoRecordId = FM_ODATA_DEMO_RECORD_ID ? parseInt(FM_ODATA_DEMO_RECORD_ID) : null

  if (!demoRecordId) {
    const { value: contacts } = await db.from('contact').top(1).get()
    if (contacts.length > 0) {
      demoRecordId = contacts[0].id
    }
  }

  if (!demoRecordId) {
    console.log('container no contact records found — skipping container demo')
  } else {
    console.log(`container using record id=${demoRecordId}`)

    // Try to access a container field (common names: photo, image, file, attachment)
    // Use FM_ODATA_CONTAINER_FIELD env var or default to 'photo'
    const containerField = FM_ODATA_CONTAINER_FIELD || 'photo'
    const containerRef = db.from('contact').byKey(demoRecordId).container(containerField)

    console.log(`container field URL: ${containerRef.url()}`)

    // Try to get the container content
    try {
      const download = await containerRef.get()
      console.log(`container downloaded: ${download.size} bytes`)
      console.log(`container content-type: ${download.contentType}`)
      if (download.filename) {
        console.log(`container filename: ${download.filename}`)
      }
    } catch (containerErr) {
      if (containerErr instanceof FMSODataError) {
        // 404 or 400 usually means empty container or field doesn't exist
        if (containerErr.status === 404 || containerErr.code === '102') {
          console.log(`container field "${containerField}" is empty or doesn't exist (this is OK)`)
        } else {
          console.log(`container download: HTTP ${containerErr.status} ${containerErr.message}`)
        }
      } else {
        throw containerErr
      }
    }

    // Demo: Create a small test blob and upload (uncomment to test)
    // const testBlob = new Blob(['test content'], { type: 'text/plain' })
    // await containerRef.upload({ data: testBlob, filename: 'test.txt', encoding: 'base64' })
    // console.log(`container uploaded test file`)
  }
} catch (err) {
  console.log(`container ERROR: ${err.message}`)
}

console.log()
console.log('='.repeat(60))
console.log('6. AGGREGATION / $apply (v0.2.0)')
console.log('='.repeat(60))

// Requires FMS 2024+ (v22). Use db.hasFeature('applyAggregation') to check.
// Note: FMS v26 has a parser bug that rejects aggregate(...) syntax with
// "parse failure in URL at: ')'". groupby((fields)) works correctly.
try {
  const canAggregate = await db.hasFeature('applyAggregation')
  if (!canAggregate) {
    console.log('$apply    server does not support aggregation (needs FMS 2024+) — skipping')
  } else {
    // groupby: distinct first_name/last_name combos (works on FMS v26)
    const { value: groupResult } = await db
      .from('contact')
      .groupBy(['first_name', 'last_name'])
      .get()
    console.log(`$apply    groupby first_name,last_name: ${groupResult.length} distinct combo(s)`)
    for (const row of groupResult.slice(0, 5)) {
      console.log(`  -> ${row.first_name} ${row.last_name}`)
    }
    if (groupResult.length > 5) console.log(`  ... and ${groupResult.length - 5} more`)
  }
} catch (err) {
  console.log(`$apply    ERROR: ${err.message}`)
}

console.log()
console.log('='.repeat(60))
console.log('7. NAVIGATION PROPERTIES / $ref (v0.2.0)')
console.log('='.repeat(60))

// Demonstrate $ref for relationship traversal
try {
  const { value: contacts } = await db.from('contact').top(1).get()
  if (contacts.length > 0) {
    const contactId = contacts[0].id
    console.log(`$ref      using contact id=${contactId}`)

    // Try to get related address references
    try {
      const refs = await db.from('contact').byKey(contactId).getRefs('address')
      console.log(`$ref      found ${refs.length} related address(es)`)
      for (const ref of refs.slice(0, 3)) {
        console.log(`  -> ${ref['@odata.id']}`)
      }
    } catch (refErr) {
      if (refErr instanceof FMSODataError) {
        console.log(`$ref      address navigation not available (${refErr.status} ${refErr.message})`)
      } else {
        throw refErr
      }
    }
  } else {
    console.log('$ref      no contacts found — skipping')
  }
} catch (err) {
  console.log(`$ref      ERROR: ${err.message}`)
}

console.log()
console.log('='.repeat(60))
console.log('8. SCHEMA EDITING / DDL (v0.4.0)')
console.log('='.repeat(60))

// DDL requires FMS 2023+ (v20). These operations modify the database schema.
// We create a throwaway table, add fields, create an index, then clean up.
const ddlTable = `ddl_test_${Date.now().toString(36)}`
try {
  const canDdl = await db.hasFeature('schemaModification')
  if (!canDdl) {
    console.log('ddl       server does not support schema editing (needs FMS 2023+) — skipping')
  } else {
    // Create a throwaway table
    await db.schema().createTable({
      tableName: ddlTable,
      fields: [
        { name: 'id', type: 'int', primary: true },
        { name: 'name', type: 'varchar(100)', nullable: false },
        { name: 'note', type: 'varchar(255)', nullable: true },
      ],
    })
    console.log(`ddl       created table "${ddlTable}"`)

    // Add fields
    await db.schema().addFields({
      tableName: ddlTable,
      fields: [{ name: 'email', type: 'varchar(200)', nullable: true }],
    })
    console.log(`ddl       added field "email" to "${ddlTable}"`)

    // Create an index
    await db.schema().createIndex(ddlTable, 'name')
    console.log(`ddl       created index on "name"`)

    // Delete a field
    await db.schema().deleteField(ddlTable, 'note', { confirm: true })
    console.log(`ddl       deleted field "note" from "${ddlTable}"`)

    // Clean up: delete the throwaway table
    await db.schema().deleteTable(ddlTable, { confirm: true })
    console.log(`ddl       deleted throwaway table "${ddlTable}" (cleanup)`)
  }
} catch (err) {
  console.log(`ddl       ERROR: ${err.message}`)
  // Best-effort cleanup
  try { await db.schema().deleteTable(ddlTable, { confirm: true }) } catch {}
}

console.log()
console.log('='.repeat(60))
console.log('9. WEBHOOK MANAGEMENT (v0.4.0)')
console.log('='.repeat(60))

// Webhooks require FMS 2025+ (v22). We create a throwaway webhook, list all,
// get it by ID, invoke it, then clean up.
const whTable = `wh_test_${Date.now().toString(36)}`
let whId = null
try {
  const canWebhooks = await db.hasFeature('webhooks')
  if (!canWebhooks) {
    console.log('webhook   server does not support webhooks (needs FMS 2025+) — skipping')
  } else {
    // Create a throwaway table for the webhook (webhooks need a table)
    await db.schema().createTable({
      tableName: whTable,
      fields: [
        { name: 'id', type: 'int', primary: true },
        { name: 'name', type: 'varchar(100)', nullable: true },
      ],
    })

    // Create a webhook pointing to a non-routable endpoint (we're testing
    // the management API, not actual payload delivery)
    const { id } = await db.webhooks().create({
      webhook: 'https://localhost:9999/fms-test-webhook',
      tableName: whTable,
    })
    whId = id
    console.log(`webhook   created webhook id=${id} on table "${whTable}"`)

    // List all webhooks
    const allResult = await db.webhooks().getAll()
    const allWebhooks = allResult?.webhooks ?? allResult
    console.log(`webhook   getAll: ${Array.isArray(allWebhooks) ? allWebhooks.length : '?'} webhook(s) total`)

    // Get specific webhook
    const whData = await db.webhooks().get(id)
    console.log(`webhook   get(${id}): ${JSON.stringify(whData).slice(0, 80)}...`)

    // Invoke (trigger) the webhook — will fail to deliver since endpoint is
    // non-routable, but the management API call itself succeeds
    try {
      await db.webhooks().invoke(id)
      console.log(`webhook   invoke(${id}): triggered`)
    } catch (invokeErr) {
      // "Connection failed" (1631) is expected — endpoint is non-routable
      if (invokeErr instanceof FMSODataError && (invokeErr.code === '1631' || /connection failed/i.test(invokeErr.message))) {
        console.log(`webhook   invoke(${id}): API call OK (delivery failed as expected — endpoint is non-routable)`)
      } else {
        throw invokeErr
      }
    }

    // Clean up: delete the webhook
    await db.webhooks().remove(id)
    console.log(`webhook   deleted webhook id=${id} (cleanup)`)

    // Clean up: delete the throwaway table
    await db.schema().deleteTable(whTable, { confirm: true })
    console.log(`webhook   deleted throwaway table "${whTable}" (cleanup)`)
  }
} catch (err) {
  console.log(`webhook   ERROR: ${err.message}`)
  // Best-effort cleanup
  try { if (whId) await db.webhooks().remove(whId) } catch {}
  try { await db.schema().deleteTable(whTable, { confirm: true }) } catch {}
}

console.log()
console.log('='.repeat(60))
console.log('Example complete!')
console.log('='.repeat(60))
