/**
 * Opt-in live-integration suite for DDL (schema editing) and webhook management.
 * Runs only when `FM_LIVE=1` (or legacy `FM_ODATA_LIVE=1`) in `.env`.
 *
 * Safety: DDL tests create and destroy THROWAWAY tables only (unique names with
 * a timestamp prefix). The production tables (contact, phone, address, email)
 * are NEVER touched by this suite. All created resources are cleaned up in
 * `afterAll` even on failure.
 *
 * Webhook tests create throwaway webhooks on the throwaway table and delete
 * them in cleanup. The webhook endpoint URL points to a non-routable address
 * since we're testing the management API, not actual payload delivery.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadFmConfig } from '../../scripts/env.mjs'
import { createFetch } from '../../scripts/insecure-fetch.mjs'
import { FMSOData, basicAuth, FMSODataError } from '../../src/index.js'

const cfg = loadFmConfig()
const live = cfg.live

// Unique prefix so throwaway tables/webhooks don't collide with real ones or
// parallel test runs. FileMaker table names have a 100-char limit.
const RUN_ID = Date.now().toString(36)
const throwawayTable = `fms_test_${RUN_ID}`

describe.skipIf(!live)('live FMS DDL (schema editing)', () => {
  const fetch = createFetch({ insecureTls: cfg.insecureTls })
  const db = new FMSOData({
    host: cfg.host,
    database: cfg.database,
    token: basicAuth(cfg.user, cfg.password),
    fetch,
    timeoutMs: 30_000,
  })

  // Track resources for cleanup. Tables are deleted with confirm:true.
  const createdTables: string[] = []

  afterAll(async () => {
    for (const table of createdTables) {
      try {
        await db.schema().deleteTable(table, { confirm: true })
      } catch {
        // Best-effort cleanup.
      }
    }
  })

  it('creates a throwaway table with field definitions', async () => {
    await db.schema().createTable({
      tableName: throwawayTable,
      fields: [
        { name: 'id', type: 'int', primary: true },
        { name: 'name', type: 'varchar(100)', nullable: false },
        { name: 'note', type: 'varchar(255)', nullable: true },
      ],
    })
    createdTables.push(throwawayTable)

    // Verify the table appears in the metadata entity sets.
    const meta = await db.metadata({ refresh: true })
    const found = meta.entitySets.find((t) => t.name === throwawayTable)
    expect(found, `throwaway table "${throwawayTable}" should appear in metadata`).toBeTruthy()
  })

  it('adds fields to the throwaway table', async () => {
    await db.schema().addFields({
      tableName: throwawayTable,
      fields: [
        { name: 'email', type: 'varchar(200)', nullable: true },
        { name: 'active', type: 'int', nullable: true },
      ],
    })

    // Verify via metadata that the new fields exist. FMS names entity types
    // with a trailing underscore (e.g. "contact_"), so resolve via entity set.
    const meta = await db.metadata({ refresh: true })
    const es = meta.entitySets.find((s) => s.name === throwawayTable)
    expect(es, `entity set for "${throwawayTable}" in metadata`).toBeTruthy()
    const etName = es!.entityType.replace(/^.*\./, '') // strip namespace
    const et = meta.entityTypes.find((e) => e.name === etName)
    expect(et, `entity type "${etName}" in metadata`).toBeTruthy()
    const fieldNames = et!.properties.map((p) => p.name)
    expect(fieldNames).toContain('email')
    expect(fieldNames).toContain('active')
  })

  it('creates and deletes an index on a field', async () => {
    // createIndex should not throw on a valid field.
    await db.schema().createIndex(throwawayTable, 'name')

    // deleteIndex should not throw.
    await db.schema().deleteIndex(throwawayTable, 'name')
  })

  it('deletes a field from the throwaway table', async () => {
    await db.schema().deleteField(throwawayTable, 'note', { confirm: true })

    // Verify the field is gone via metadata.
    const meta = await db.metadata({ refresh: true })
    const es = meta.entitySets.find((s) => s.name === throwawayTable)
    expect(es, `entity set for "${throwawayTable}" in metadata`).toBeTruthy()
    const etName = es!.entityType.replace(/^.*\./, '')
    const et = meta.entityTypes.find((e) => e.name === etName)
    expect(et, `entity type "${etName}" in metadata`).toBeTruthy()
    const fieldNames = et!.properties.map((p) => p.name)
    expect(fieldNames).not.toContain('note')
  })

  it('rejects deleteTable without confirm: true', async () => {
    await expect(
      db.schema().deleteTable(throwawayTable, { confirm: false } as never),
    ).rejects.toThrow(/confirm/)
  })

  it('deletes the throwaway table with confirm: true', async () => {
    await db.schema().deleteTable(throwawayTable, { confirm: true })
    createdTables.pop() // already deleted, don't double-delete in afterAll

    // Verify the table is gone from metadata.
    const meta = await db.metadata({ refresh: true })
    const found = meta.entitySets.find((t) => t.name === throwawayTable)
    expect(found).toBeUndefined()
  })
})

describe.skipIf(!live)('live FMS webhook management', () => {
  const fetch = createFetch({ insecureTls: cfg.insecureTls })
  const db = new FMSOData({
    host: cfg.host,
    database: cfg.database,
    token: basicAuth(cfg.user, cfg.password),
    fetch,
    timeoutMs: 30_000,
  })

  // Use a throwaway table for webhook tests so we don't attach webhooks to
  // production tables. Create it in beforeAll, delete in afterAll.
  const whTable = `fms_wh_${RUN_ID}`
  const createdWebhookIds: string[] = []
  let tableCreated = false

  beforeAll(async () => {
    // Webhooks require v22+. Skip the table setup if webhooks aren't supported.
    const version = await db.version()
    if (version && (version === 'future' || ['22', '26'].includes(version))) {
      try {
        await db.schema().createTable({
          tableName: whTable,
          fields: [
            { name: 'id', type: 'int', primary: true },
            { name: 'name', type: 'varchar(100)', nullable: true },
          ],
        })
        tableCreated = true
      } catch {
        // If table creation fails, webhook tests will soft-skip.
      }
    }
  })

  afterAll(async () => {
    // Clean up webhooks first (can't delete table while webhooks reference it).
    for (const id of createdWebhookIds) {
      try {
        await db.webhooks().remove(id)
      } catch {
        // Best-effort.
      }
    }
    if (tableCreated) {
      try {
        await db.schema().deleteTable(whTable, { confirm: true })
      } catch {
        // Best-effort.
      }
    }
  })

  it('creates a webhook on the throwaway table', async () => {
    if (!tableCreated) {
      console.warn('[live] skipping webhook tests — throwaway table could not be created or webhooks not supported')
      return
    }
    const result = await db.webhooks().create({
      webhook: 'https://localhost:9999/fms-test-webhook',
      tableName: whTable,
    })

    expect(result.id, 'webhook creation must return an id').toBeTruthy()
    createdWebhookIds.push(result.id)
  })

  it('lists all webhooks via getAll', async () => {
    if (!tableCreated || createdWebhookIds.length === 0) return
    const result = await db.webhooks().getAll() as Record<string, unknown>
    expect(result).toBeTruthy()
    // FMS returns { webhooks: [...] }
    const webhooks = (result.webhooks as unknown[]) ?? result
    expect(Array.isArray(webhooks)).toBe(true)
  })

  it('gets a specific webhook by id', async () => {
    if (!tableCreated || createdWebhookIds.length === 0) return
    const id = createdWebhookIds[0]!
    const result = await db.webhooks().get(id) as Record<string, unknown>
    expect(result).toBeTruthy()
    // FMS returns { webhook: { webhookID, tableName, ... } }
    const wh = (result.webhook as Record<string, unknown>) ?? result
    const tableName = wh.tableName as string | undefined
    if (tableName) expect(tableName).toBe(whTable)
  })

  it('invokes (triggers) a webhook for testing', async () => {
    if (!tableCreated || createdWebhookIds.length === 0) return
    const id = createdWebhookIds[0]!
    // The webhook endpoint is non-routable (https://localhost:9999), so FMS
    // will accept the invoke request but fail to deliver the payload and
    // return a "Connection failed" (1631) error. That's expected — we're
    // verifying the management API call reaches FMS, not actual delivery.
    try {
      const result = await db.webhooks().invoke(id)
      expect(result).toBeDefined()
    } catch (e) {
      // Accept the expected delivery-failure error; the API call itself
      // was correct (FMS received and processed it).
      expect(e).toBeInstanceOf(FMSODataError)
      const err = e as FMSODataError
      expect(err.code === '1631' || /connection failed/i.test(err.message)).toBe(true)
    }
  })

  it('removes a webhook by id', async () => {
    if (!tableCreated || createdWebhookIds.length === 0) return
    const id = createdWebhookIds.shift()!
    await db.webhooks().remove(id)
    // Verify: getting the removed webhook should fail.
    const err = await db.webhooks().get(id).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FMSODataError)
  })
})
