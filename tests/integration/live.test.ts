/**
 * Opt-in live-integration suite. Runs only when `FM_ODATA_LIVE=1` in `.env`.
 *
 * Exercises collection GET + single-entity CRUD against a real FMS instance.
 * Reads connection info from `.env` (see `.env.sample`).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadFmConfig } from '../../scripts/env.mjs'
import { createFetch } from '../../scripts/insecure-fetch.mjs'
import { FMOData, basicAuth, FMODataError, FMScriptError } from '../../src/index.js'

const cfg = loadFmConfig()
const live = cfg.live

// Entire suite is skipped unless FM_ODATA_LIVE=1. This lets `npm test` stay
// fast and offline; developers opt in when working against a real FMS.
describe.skipIf(!live)('live FMS integration', () => {
  const fetch = createFetch({ insecureTls: cfg.insecureTls })
  const db = new FMOData({
    host: cfg.host,
    database: cfg.database,
    token: basicAuth(cfg.user, cfg.password),
    fetch,
    timeoutMs: 15_000,
  })

  // Track rows created by this run so we can clean up even on failure.
  const createdContactKeys: Array<string | number> = []

  afterAll(async () => {
    for (const key of createdContactKeys) {
      try {
        await db.from(cfg.tables.contact).byKey(key).delete()
      } catch {
        // Best-effort cleanup.
      }
    }
  })

  it('reads the contact collection', async () => {
    const { value, count } = await db.from(cfg.tables.contact).top(3).count().get()
    expect(Array.isArray(value)).toBe(true)
    expect(typeof count === 'number' || count === undefined).toBe(true)
  })

  it('round-trips a full CRUD lifecycle on contact', async () => {
    // 1. CREATE
    const created = await db
      .from<Record<string, unknown>>(cfg.tables.contact)
      .create({
        first_name: 'fm-odata-js',
        last_name: `live-test-${Date.now()}`,
      })

    // FMS returns the new row with its generated key. We don't know the key
    // field name a priori, so discover it from the response.
    const pkField = findPrimaryKey(created)
    expect(pkField, 'created row must include a primary key').not.toBeNull()
    const key = created[pkField!] as string | number
    createdContactKeys.push(key)

    // 2. READ
    const readBack = await db.from(cfg.tables.contact).byKey(key).get()
    expect(readBack[pkField!]).toEqual(key)

    // 3. UPDATE
    await db.from(cfg.tables.contact).byKey(key).patch({
      first_name: 'fm-odata-js-updated',
    })
    const readAfterPatch = await db
      .from<Record<string, unknown>>(cfg.tables.contact)
      .byKey(key)
      .get()
    expect(readAfterPatch.first_name).toBe('fm-odata-js-updated')

    // 4. DELETE
    await db.from(cfg.tables.contact).byKey(key).delete()
    createdContactKeys.pop()

    // 5. VERIFY DELETE: follow-up GET should 404
    const err = await db
      .from(cfg.tables.contact)
      .byKey(key)
      .get()
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FMODataError)
    expect((err as FMODataError).status).toBeGreaterThanOrEqual(400)
  })

  it('runs a database-scope script and echoes its parameter', async () => {
    // Requires a `Ping` script in the demo solution that returns its parameter
    // (or `"pong"` when no parameter is supplied) via `Exit Script [Text Result]`.
    // The script name is overridable via FM_ODATA_PING_SCRIPT for solutions
    // that name it differently; the test skips silently if FMS reports the
    // script does not exist (FM error 104).
    const scriptName = process.env.FM_ODATA_PING_SCRIPT ?? 'Ping'
    let result
    try {
      result = await db.script(scriptName, { parameter: 'hello' })
    } catch (err) {
      // Two soft-skip paths: FMS may surface "missing script" either as a
      // 200-with-`scriptError: "104"` (→ FMScriptError) or as an HTTP-level
      // 4xx with a "Script '<name>' not found" message (→ plain FMODataError).
      const isMissingScript =
        (err instanceof FMScriptError && err.scriptError === '104') ||
        (err instanceof FMODataError && /not found/i.test(err.message))
      if (isMissingScript) {
        // eslint-disable-next-line no-console
        console.warn(`[live] skipping script test — script "${scriptName}" missing in solution`)
        return
      }
      throw err
    }
    expect(result.scriptError).toBe('0')
    expect(typeof result.scriptResult === 'string' || result.scriptResult === undefined).toBe(true)
  })

  it('uploads, reads and clears a container field', async () => {
    // Requires a container field on the contact table. Its name is overridable
    // via FM_ODATA_CONTAINER_FIELD (defaults to 'photo'). Soft-skips when the
    // field is missing (FM error 102) so the test stays usable against any
    // stock Contacts demo.
    const fieldName = process.env.FM_ODATA_CONTAINER_FIELD ?? 'photo'
    const here = dirname(fileURLToPath(import.meta.url))
    const pngBytes = new Uint8Array(readFileSync(resolve(here, '../fixtures/pixel.png')))

    // Create a fresh row to own the container.
    const created = await db
      .from<Record<string, unknown>>(cfg.tables.contact)
      .create({
        first_name: 'fm-odata-js',
        last_name: `container-test-${Date.now()}`,
      })
    const pkField = findPrimaryKey(created)
    expect(pkField, 'created row must include a primary key').not.toBeNull()
    const key = created[pkField!] as string | number
    createdContactKeys.push(key)

    const container = db.from(cfg.tables.contact).byKey(key).container(fieldName)

    // UPLOAD — no filename so FMS stores embedded binary (not a file reference).
    // On FMS 22, providing a filename causes $value to return the filename string
    // instead of the bytes. See docs/filemaker-quirks.md.
    try {
      await container.upload({
        data: pngBytes,
        contentType: 'image/png',
      })
    } catch (err) {
      // Soft-skip when the field is missing in the solution.
      // FMS surfaces this as either FM error 102 (Field is missing), error 7
      // ("does not exist in any table"), or a 404 status — match all three.
      const isMissingField =
        err instanceof FMODataError &&
        (err.code === '102' ||
          err.status === 404 ||
          /does not exist|not found/i.test(err.message))
      if (isMissingField) {
        console.warn(`[live] skipping container test — field "${fieldName}" missing in solution`)
        return
      }
      throw err
    }

    // READ BACK
    const dl = await container.get()
    expect(dl.contentType.toLowerCase()).toContain('image/')
    expect(dl.size).toBe(pngBytes.byteLength)
    const roundTripped = new Uint8Array(await dl.blob.arrayBuffer())
    expect(Array.from(roundTripped)).toEqual(Array.from(pngBytes))

    // CLEAR
    await container.delete()
  })

  it('surfaces FMS error envelopes as FMODataError', async () => {
    const err = await db
      .from('definitely_not_a_table_xyz')
      .get()
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FMODataError)
    expect((err as FMODataError).status).toBeGreaterThanOrEqual(400)
  })

  it('fetches and parses $metadata', async () => {
    const meta = await db.metadata()
    expect(meta.namespace).toBeTruthy()
    expect(meta.entitySets.length).toBeGreaterThan(0)
    expect(meta.entityTypes.length).toBeGreaterThan(0)

    // Verify at least one entity type has a key (primary key)
    const withKeys = meta.entityTypes.filter(et => et.keys.length > 0)
    expect(withKeys.length).toBeGreaterThan(0)

    // Verify metadata() is cached
    const meta2 = await db.metadata()
    expect(meta2).toBe(meta) // Same object reference

    // Verify refresh: true fetches new data
    const meta3 = await db.metadata({ refresh: true })
    expect(meta3).not.toBe(meta)
    expect(meta3.entitySets.length).toBeGreaterThan(0)
  })

  it('fetches raw $metadata XML', async () => {
    const xml = await db.metadataXml()
    expect(xml).toContain('<?xml')
    expect(xml).toContain('<edmx:Edmx')
    expect(xml).toContain('</edmx:Edmx>')
  })

  it('executes a $batch with a read and a changeset create', async () => {
    // 1. Send a batch containing:
    //    - a read (GET contact top 1)
    //    - a changeset with a single create
    const batch = db.batch()

    batch.add({ op: 'list', entitySet: cfg.tables.contact, query: { $top: 1 } })

    let createdKey: string | number | undefined
    batch.changeset(cs => {
      cs.create(cfg.tables.contact, {
        first_name: 'fm-odata-js',
        last_name: `batch-test-${Date.now()}`,
      })
    })

    const result = await batch.send()

    // 2. Batch outer response must be ok
    expect(result.ok).toBe(true)
    expect(result.responses.length).toBeGreaterThanOrEqual(1)

    // 3. Read response has status 200
    const readResp = result.responses[0]
    expect(readResp.status).toBe(200)
    expect(readResp.ok).toBe(true)

    // 4. Changeset create response has status 201 (or 200)
    if (result.responses.length > 1) {
      const createResp = result.responses[1]
      expect(createResp.ok).toBe(true)
      expect(createResp.status).toBeGreaterThanOrEqual(200)
      expect(createResp.status).toBeLessThan(300)

      // Track the new row for cleanup
      const body = createResp.body as Record<string, unknown> | undefined
      if (body) {
        const pkField = findPrimaryKey(body)
        if (pkField) {
          createdKey = body[pkField] as string | number
          createdContactKeys.push(createdKey)
        }
      }
    }
  })
})

// Emit a single advisory line so developers know why the suite didn't run.
if (!live) {
  // eslint-disable-next-line no-console
  console.log('[live] FM_ODATA_LIVE != 1 — skipping live FMS integration suite')
}

/**
 * Heuristically find the primary-key field in a newly-created row. FileMaker
 * solutions vary (`id`, `ID`, `contact_id`, `pk_contact`, …); pick whichever
 * scalar looks most like a key, preferring exact `id` / `ID` matches.
 */
function findPrimaryKey(row: Record<string, unknown>): string | null {
  const keys = Object.keys(row)
  const scalar = (k: string) => ['string', 'number'].includes(typeof row[k])
  for (const candidate of ['id', 'ID', 'pk', 'PK']) {
    if (candidate in row && scalar(candidate)) return candidate
  }
  const idLike = keys.find((k) => /^(id|pk(_|$))/i.test(k) && scalar(k))
  if (idLike) return idLike
  // Last resort: first scalar field.
  return keys.find(scalar) ?? null
}
