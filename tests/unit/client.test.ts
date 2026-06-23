import { describe, it, expect, vi } from 'vitest'
import { FMSOData } from '../../src/client.js'

describe('FMSOData (M1 scaffold)', () => {
  it('constructs with minimal options and derives the OData base URL', () => {
    const db = new FMSOData({
      host: 'https://fms.example.com',
      database: 'Invoices',
      token: 'xxx',
    })
    expect(db.baseUrl).toBe('https://fms.example.com/fmi/odata/v4/Invoices')
  })

  it('strips trailing slashes from host', () => {
    const db = new FMSOData({
      host: 'https://fms.example.com/',
      database: 'Invoices',
      token: 'xxx',
    })
    expect(db.baseUrl).toBe('https://fms.example.com/fmi/odata/v4/Invoices')
  })

  it('throws when required options are missing', () => {
    expect(
      // @ts-expect-error - intentionally invalid
      () => new FMSOData({ database: 'X', token: 't' }),
    ).toThrow(/host/)
  })

  it('exposes a .from(entitySet) entry point returning a Query', async () => {
    const { Query } = await import('../../src/query.js')
    const db = new FMSOData({
      host: 'https://fms.example.com',
      database: 'Invoices',
      token: 'xxx',
    })
    const q = db.from('Customer')
    expect(q).toBeInstanceOf(Query)
    expect(q.toURL()).toBe('https://fms.example.com/fmi/odata/v4/Invoices/Customer')
  })

  it('throws when .from() is called without an entity set', () => {
    const db = new FMSOData({
      host: 'https://fms.example.com',
      database: 'Invoices',
      token: 'xxx',
    })
    expect(() => db.from('')).toThrow(/entitySet/)
  })

  it('URL-encodes the database name in the base URL', () => {
    const db = new FMSOData({
      host: 'https://fms.example.com',
      database: 'My Invoices',
      token: 'xxx',
    })
    expect(db.baseUrl).toBe('https://fms.example.com/fmi/odata/v4/My%20Invoices')
  })
})

// ---------------------------------------------------------------------------
// Version detection & feature gating (Phase 2 — spec alignment)
// ---------------------------------------------------------------------------

/** Minimal $metadata XML with a ProductVersion annotation. */
function metadataWithVersion(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="FMI" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityContainer Name="Container">
        <Annotation Term="Org.OData.Core.V1.ProductVersion" String="${version}" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`
}

/** Minimal $metadata XML without a ProductVersion annotation. */
const METADATA_NO_VERSION = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="FMI" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityContainer Name="Container" />
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`

function makeClientWithMetadata(xml: string): FMSOData {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(xml, { status: 200, headers: { 'content-type': 'application/xml' } }),
  )
  return new FMSOData({
    host: 'https://fms.example.com',
    database: 'Test',
    token: 'xxx',
    fetch: fetchMock as unknown as typeof globalThis.fetch,
  })
}

describe('FMSOData version detection', () => {
  it('detects version 19 from ProductVersion annotation', async () => {
    const db = makeClientWithMetadata(metadataWithVersion('19.0.1'))
    expect(await db.version()).toBe('19')
  })

  it('detects version 21 (FileMaker 2023)', async () => {
    const db = makeClientWithMetadata(metadataWithVersion('21.1.2'))
    expect(await db.version()).toBe('21')
  })

  it('detects version 22 (FileMaker 2024)', async () => {
    const db = makeClientWithMetadata(metadataWithVersion('22.0.1'))
    expect(await db.version()).toBe('22')
  })

  it('detects version 26 (FileMaker 2026)', async () => {
    const db = makeClientWithMetadata(metadataWithVersion('26.0.0'))
    expect(await db.version()).toBe('26')
  })

  it('returns "future" for unknown newer versions', async () => {
    const db = makeClientWithMetadata(metadataWithVersion('99.0.0'))
    expect(await db.version()).toBe('future')
  })

  it('returns null when ProductVersion annotation is absent', async () => {
    const db = makeClientWithMetadata(METADATA_NO_VERSION)
    expect(await db.version()).toBeNull()
  })

  it('caches the detected version across calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(metadataWithVersion('22.0.1'), {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      }),
    )
    const db = new FMSOData({
      host: 'https://fms.example.com',
      database: 'Test',
      token: 'xxx',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    })

    await db.version()
    await db.version()
    await db.version()

    // $metadata should only be fetched once (cached)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('FMSOData versionInfo', () => {
  it('returns full version info for detected version', async () => {
    const db = makeClientWithMetadata(metadataWithVersion('26.0.0'))
    const info = await db.versionInfo()
    expect(info).not.toBeNull()
    expect(info!.major).toBe('26')
    expect(info!.name).toBe('Claris FileMaker 2026')
    expect(info!.features.scriptsByFMSID).toBe(true)
    expect(info!.features.applyAggregation).toBe(true)
  })

  it('returns null when version cannot be determined', async () => {
    const db = makeClientWithMetadata(METADATA_NO_VERSION)
    expect(await db.versionInfo()).toBeNull()
  })
})

describe('FMSOData hasFeature', () => {
  it('returns true for features supported by the detected version', async () => {
    const db = makeClientWithMetadata(metadataWithVersion('22.0.1'))
    expect(await db.hasFeature('applyAggregation')).toBe(true)
    expect(await db.hasFeature('webhooks')).toBe(true)
  })

  it('returns false for features not supported by the detected version', async () => {
    const db = makeClientWithMetadata(metadataWithVersion('19.0.1'))
    expect(await db.hasFeature('applyAggregation')).toBe(false)
    expect(await db.hasFeature('webhooks')).toBe(false)
    expect(await db.hasFeature('scriptsByFMSID')).toBe(false)
  })

  it('returns false when version cannot be determined', async () => {
    const db = makeClientWithMetadata(METADATA_NO_VERSION)
    expect(await db.hasFeature('applyAggregation')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Multi-strategy version detection (aligned with FMS-ODATA-MCP fm-version.ts)
// ---------------------------------------------------------------------------

/** Metadata with reversed attribute order (String before Term). */
function metadataWithReversedVersion(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="FMI" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityContainer Name="Container">
        <Annotation String="${version}" Term="Org.OData.Core.V1.ProductVersion" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`
}

/** Metadata with ServerVersion annotation (FM 26+ format). */
function metadataWithServerVersion(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="FMI" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityContainer Name="Container">
        <Annotation Term="ServerVersion" String="OData Engine ${version}" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`
}

/** Metadata with ServerVersion annotation and reversed attribute order. */
function metadataWithServerVersionReversed(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="FMI" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityContainer Name="Container">
        <Annotation String="OData Engine ${version}" Term="ServerVersion" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`
}

describe('FMSOData multi-strategy version detection', () => {
  it('detects version from reversed attribute order (String before Term)', async () => {
    const db = makeClientWithMetadata(metadataWithReversedVersion('21.1.2.500'))
    expect(await db.version()).toBe('21')
  })

  it('detects version from ServerVersion annotation (FM 26+)', async () => {
    const db = makeClientWithMetadata(metadataWithServerVersion('26.0.1'))
    expect(await db.version()).toBe('26')
  })

  it('detects version from ServerVersion with reversed attribute order', async () => {
    const db = makeClientWithMetadata(metadataWithServerVersionReversed('26.0.1'))
    expect(await db.version()).toBe('26')
  })

  it('detects version with build suffix (e.g. 21.1.2.500)', async () => {
    const db = makeClientWithMetadata(metadataWithVersion('21.1.2.500'))
    expect(await db.version()).toBe('21')
  })

  it('serverVersion() returns full parsed version object', async () => {
    const db = makeClientWithMetadata(metadataWithVersion('22.0.1.100'))
    const sv = await db.serverVersion()
    expect(sv).not.toBeNull()
    expect(sv!.major).toBe(22)
    expect(sv!.minor).toBe(0)
    expect(sv!.patch).toBe(1)
    expect(sv!.raw).toBe('22.0.1.100')
  })

  it('serverVersion() returns full version from ServerVersion annotation', async () => {
    const db = makeClientWithMetadata(metadataWithServerVersion('26.0.1'))
    const sv = await db.serverVersion()
    expect(sv).not.toBeNull()
    expect(sv!.major).toBe(26)
    expect(sv!.minor).toBe(0)
    expect(sv!.patch).toBe(1)
  })

  it('serverVersion() returns null when no version annotation is present', async () => {
    const db = makeClientWithMetadata(METADATA_NO_VERSION)
    expect(await db.serverVersion()).toBeNull()
  })

  it('metadata.serverVersion is populated and productVersion is backward-compatible', async () => {
    const db = makeClientWithMetadata(metadataWithVersion('19.6.0.123'))
    const meta = await db.metadata()
    expect(meta.serverVersion).toBeDefined()
    expect(meta.serverVersion!.major).toBe(19)
    expect(meta.serverVersion!.raw).toBe('19.6.0.123')
    // productVersion should still be set for backward compat
    expect(meta.productVersion).toBe('19.6.0.123')
  })

  it('caches serverVersion across calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(metadataWithServerVersion('26.0.1'), {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      }),
    )
    const db = new FMSOData({
      host: 'https://fms.example.com',
      database: 'Test',
      token: 'xxx',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    })

    await db.serverVersion()
    await db.serverVersion()
    await db.version()

    // $metadata should only be fetched once (cached)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
