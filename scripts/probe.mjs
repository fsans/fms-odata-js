#!/usr/bin/env node
// Connectivity probe: mint an FMS Data API bearer token with the credentials
// in `.env`, then hit the OData `$metadata` endpoint to confirm the connection
// works. Respects FM_VERIFY_SSL=0 (or legacy FM_ODATA_INSECURE_TLS=1) for
// self-signed certs.
//
// Usage: npm run probe

import { loadFmConfig } from './env.mjs'
import { createFetch } from './insecure-fetch.mjs'

const cfg = loadFmConfig()
const fetch = createFetch({ insecureTls: cfg.insecureTls })

const dbPath = encodeURIComponent(cfg.database)
const odataBase = `${cfg.host}/fmi/odata/v4/${dbPath}`

console.log(`[probe] host             = ${cfg.host}`)
console.log(`[probe] database         = ${cfg.database}`)
console.log(`[probe] user             = ${cfg.user}`)
console.log(`[probe] insecureTls      = ${cfg.insecureTls}`)
console.log()

// FileMaker Server's OData endpoint uses HTTP Basic auth directly (the Data
// API bearer token is NOT accepted). See docs/filemaker-quirks.md.
const basic = `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64')}`

// --- Step 1: fetch OData $metadata ---------------------------------------
const metaUrl = `${odataBase}/$metadata`
console.log(`[probe] GET  ${metaUrl}`)
const metaRes = await fetch(metaUrl, {
  headers: { Authorization: basic, Accept: 'application/xml' },
})

if (!metaRes.ok) {
  const body = await metaRes.text()
  console.error(`[probe] metadata fetch failed: ${metaRes.status} ${metaRes.statusText}`)
  console.error(body.slice(0, 500))
  process.exit(1)
}
const metaXml = await metaRes.text()
const entitySets = [...metaXml.matchAll(/<EntitySet\s+Name="([^"]+)"/g)].map((m) => m[1])
console.log(`[probe] metadata OK      = ${metaXml.length} bytes`)
console.log(`[probe] entity sets      = ${entitySets.join(', ') || '(none found)'}`)

// --- Step 2: count rows in the expected tables --------------------------
// Note: FMS's OData endpoint does NOT support the `/EntitySet/$count` URL,
// but it does support the inline `?$count=true&$top=0` form. Documented in
// docs/filemaker-quirks.md.
for (const [label, table] of Object.entries(cfg.tables)) {
  const url = `${odataBase}/${encodeURIComponent(table)}?$count=true&$top=0`
  const r = await fetch(url, { headers: { Authorization: basic, Accept: 'application/json' } })
  if (!r.ok) {
    console.warn(`[probe] ${label.padEnd(8)} (${table}) count FAILED: ${r.status} ${r.statusText}`)
    continue
  }
  const json = await r.json()
  const count = json['@odata.count'] ?? json['@count'] ?? '?'
  console.log(`[probe] ${label.padEnd(8)} (${table}) count = ${count}`)
}

console.log('\n[probe] OK')
