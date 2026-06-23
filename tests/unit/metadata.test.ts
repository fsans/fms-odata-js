import { describe, expect, it, vi } from 'vitest'
import { FMSOData } from '../../src/client.js'
import { parseMetadata } from '../../src/metadata.js'
import type { FMSODataOptions } from '../../src/types.js'

const BASE = 'https://fms.example.com/fmi/odata/v4/Invoices'

function xmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/xml' },
  })
}

function makeClient(
  fetchMock: ReturnType<typeof vi.fn>,
  overrides: Partial<FMSODataOptions> = {},
): FMSOData {
  return new FMSOData({
    host: 'https://fms.example.com',
    database: 'Invoices',
    token: 'abc',
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    ...overrides,
  })
}

const SAMPLE_METADATA = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="FMI" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="contact">
        <Key>
          <PropertyRef Name="id" />
        </Key>
        <Property Name="id" Type="Edm.Int64" Nullable="false" />
        <Property Name="firstName" Type="Edm.String" MaxLength="100" />
        <Property Name="lastName" Type="Edm.String" MaxLength="100" />
        <Property Name="email" Type="Edm.String" MaxLength="255" />
        <Property Name="createdAt" Type="Edm.DateTimeOffset" />
        <Property Name="isActive" Type="Edm.Boolean" />
        <NavigationProperty Name="addresses" Type="Collection(FMI.address)" />
      </EntityType>
      <EntityType Name="address">
        <Key>
          <PropertyRef Name="id" />
        </Key>
        <Property Name="id" Type="Edm.Int64" Nullable="false" />
        <Property Name="street" Type="Edm.String" MaxLength="200" />
        <Property Name="city" Type="Edm.String" MaxLength="100" />
        <Property Name="postalCode" Type="Edm.String" MaxLength="20" />
        <NavigationProperty Name="contact" Type="FMI.contact" />
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="contact" EntityType="FMI.contact" />
        <EntitySet Name="address" EntityType="FMI.address" />
      </EntityContainer>
      <Action Name="Ping">
        <Parameter Name="scriptParameterValue" Type="Edm.String" />
        <ReturnType Type="Edm.String" />
      </Action>
      <Action Name="SendWelcomeEmail" IsBound="true" EntityType="FMI.contact">
        <Parameter Name="bindingParameter" Type="FMI.contact" />
        <Parameter Name="templateName" Type="Edm.String" />
        <ReturnType Type="Edm.Boolean" />
      </Action>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`

describe('parseMetadata', () => {
  it('parses namespace from Schema', () => {
    const meta = parseMetadata(SAMPLE_METADATA)
    expect(meta.namespace).toBe('FMI')
  })

  it('parses entity types with keys', () => {
    const meta = parseMetadata(SAMPLE_METADATA)
    expect(meta.entityTypes).toHaveLength(2)

    const contact = meta.entityTypes.find(et => et.name === 'contact')!
    expect(contact.keys).toEqual(['id'])
    expect(contact.properties).toHaveLength(6)
  })

  it('parses properties with types and nullability', () => {
    const meta = parseMetadata(SAMPLE_METADATA)
    const contact = meta.entityTypes.find(et => et.name === 'contact')!

    const idProp = contact.properties.find(p => p.name === 'id')!
    expect(idProp.type).toBe('Edm.Int64')
    expect(idProp.nullable).toBe(false)

    const firstNameProp = contact.properties.find(p => p.name === 'firstName')!
    expect(firstNameProp.type).toBe('Edm.String')
    expect(firstNameProp.nullable).toBe(true) // default
    expect(firstNameProp.maxLength).toBe(100)
  })

  it('parses navigation properties', () => {
    const meta = parseMetadata(SAMPLE_METADATA)
    const contact = meta.entityTypes.find(et => et.name === 'contact')!

    expect(contact.navigationProperties).toHaveLength(1)
    expect(contact.navigationProperties[0]).toEqual({
      name: 'addresses',
      target: 'FMI.address',
      collection: true,
    })
  })

  it('parses entity sets', () => {
    const meta = parseMetadata(SAMPLE_METADATA)
    expect(meta.entitySets).toHaveLength(2)
    expect(meta.entitySets).toContainEqual({
      name: 'contact',
      entityType: 'FMI.contact',
    })
    expect(meta.entitySets).toContainEqual({
      name: 'address',
      entityType: 'FMI.address',
    })
  })

  it('parses actions (FileMaker scripts)', () => {
    const meta = parseMetadata(SAMPLE_METADATA)
    expect(meta.actions).toHaveLength(2)

    const ping = meta.actions.find(a => a.name === 'Ping')!
    expect(ping.boundTo).toBeUndefined()
    expect(ping.parameters).toHaveLength(1)
    expect(ping.parameters[0]).toEqual({ name: 'scriptParameterValue', type: 'Edm.String' })

    const sendEmail = meta.actions.find(a => a.name === 'SendWelcomeEmail')!
    expect(sendEmail.boundTo).toBe('FMI.contact')
    expect(sendEmail.parameters).toHaveLength(2)
  })

  it('preserves raw XML', () => {
    const meta = parseMetadata(SAMPLE_METADATA)
    expect(meta.raw).toBe(SAMPLE_METADATA)
  })

  it('throws FMSODataError for malformed XML', () => {
    expect(() => parseMetadata('<invalid')).toThrow('Failed to parse')
  })
})

describe('FMSOData#metadataXml', () => {
  it('GETs $metadata endpoint as XML', async () => {
    const fetchMock = vi.fn().mockResolvedValue(xmlResponse(SAMPLE_METADATA))
    const db = makeClient(fetchMock)

    const xml = await db.metadataXml()

    expect(xml).toBe(SAMPLE_METADATA)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/$metadata`)
    expect((init as RequestInit).method).toBe('GET')
    const headers = (init as RequestInit).headers as Headers
    expect(headers.get('accept')).toBe('application/xml')
  })
})

describe('FMSOData#metadata', () => {
  it('fetches and parses metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(xmlResponse(SAMPLE_METADATA))
    const db = makeClient(fetchMock)

    const meta = await db.metadata()

    expect(meta.namespace).toBe('FMI')
    expect(meta.entityTypes).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caches metadata by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(xmlResponse(SAMPLE_METADATA))
    const db = makeClient(fetchMock)

    const meta1 = await db.metadata()
    const meta2 = await db.metadata()

    expect(meta1).toBe(meta2) // Same object reference
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refetches when refresh: true', async () => {
    // Return a fresh Response each call since Response bodies can only be read once
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(xmlResponse(SAMPLE_METADATA))
    })
    const db = makeClient(fetchMock)

    await db.metadata()
    await db.metadata({ refresh: true })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('respects AbortSignal', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Aborted')), 10)
      })
    })
    const db = makeClient(fetchMock)
    const ctrl = new AbortController()
    ctrl.abort()

    await expect(db.metadata({ signal: ctrl.signal })).rejects.toThrow()
  })
})

describe('Metadata with no EntityContainer', () => {
  it('handles missing entity sets gracefully', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="Test" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="item">
        <Key><PropertyRef Name="id" /></Key>
        <Property Name="id" Type="Edm.Int64" Nullable="false" />
      </EntityType>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`
    const meta = parseMetadata(xml)
    expect(meta.entitySets).toEqual([])
    expect(meta.entityTypes).toHaveLength(1)
  })
})

describe('Metadata with empty elements', () => {
  it('handles self-closing Property tags', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="Test" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="item">
        <Key><PropertyRef Name="id" /></Key>
        <Property Name="id" Type="Edm.Int64" Nullable="false" />
        <Property Name="name" Type="Edm.String" MaxLength="50" />
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="item" EntityType="Test.item" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`
    const meta = parseMetadata(xml)
    expect(meta.entityTypes[0].properties).toHaveLength(2)
  })
})
