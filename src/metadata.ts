/**
 * $metadata (EDMX/CSDL) fetch and lightweight parser.
 *
 * FMS returns a subset of the full OData CSDL spec. This module parses just
 * what FMS emits: EntityTypes, EntitySets, and Actions (FileMaker scripts).
 * No inheritance, complex types, or enums are expected.
 *
 * The parser is intentionally dependency-free and uses simple regex-based
 * extraction to stay within the bundle budget (~1 KB gzipped).
 */

import { FMODataError } from './errors.js'
import { executeRequest } from './http.js'
import type { HttpClientContext, RequestOptions } from './types.js'

/** Property on an entity type (field in FileMaker). */
export interface EdmProperty {
  name: string
  type: string
  nullable: boolean
  maxLength?: number
}

/** Entity type (FileMaker table occurrence). */
export interface EdmEntityType {
  name: string
  keys: string[]
  properties: EdmProperty[]
  navigationProperties: { name: string; target: string; collection: boolean }[]
}

/** Entity set (exposed layout/table in OData). */
export interface EdmEntitySet {
  name: string
  entityType: string
}

/** Action (FileMaker script exposed as OData Action). */
export interface EdmAction {
  name: string
  boundTo?: string
  parameters: { name: string; type: string }[]
}

/** Parsed OData metadata document. */
export interface ODataMetadata {
  namespace: string
  entityTypes: EdmEntityType[]
  entitySets: EdmEntitySet[]
  actions: EdmAction[]
  /** Original XML, for debugging and forward compatibility. */
  raw: string
}

/** Options for metadata fetch. */
export interface MetadataOptions extends RequestOptions {
  /** Force refetch, bypassing the internal cache. */
  refresh?: boolean
}

/** @internal — parse a boolean XML attribute value. */
function parseBoolAttr(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue
  return value === 'true'
}

/** @internal — extract the value of an XML attribute by name from a tag string. */
function getAttr(text: string, name: string): string | undefined {
  const re = new RegExp(`${name}="([^"]*)"`, 'i')
  const m = text.match(re)
  return m?.[1]
}

/** @internal — extract all attributes as a record from a tag open. */
function getAttrs(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /(\w+)="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out[m[1]] = m[2]
  }
  return out
}

/** @internal — find all top-level elements with the given tag name, handling namespace prefixes. */
function findElements(xml: string, tagName: string): string[] {
  const results: string[] = []
  // Match both <Tag ...> and <prefix:Tag ...> (self-closing or with content)
  // [\\w]+ matches word characters (properly escaped for RegExp string)
  const openRe = new RegExp(`<([\\w]+:)?${tagName}\\b[^>]*>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = openRe.exec(xml)) !== null) {
    const openTag = m[0]
    // Self-closing tag: <... />
    if (/\/>\s*$/.test(openTag)) {
      results.push(openTag)
      continue
    }
    // Find matching close tag; naive but adequate for FMS CSDL which isn't deeply nested.
    const startIdx = m.index
    const closeRe = new RegExp(`</([\\w]+:)?${tagName}>`, 'gi')
    closeRe.lastIndex = openRe.lastIndex
    const closeM = closeRe.exec(xml)
    if (closeM) {
      results.push(xml.slice(startIdx, closeM.index + closeM[0].length))
    }
  }
  return results
}

/** @internal — extract inner XML between the outermost matching open/close tags (handles namespace prefixes). */
function elementContent(xml: string, tagName: string): string | undefined {
  // Match tag with optional namespace prefix: <tag>, <prefix:tag>
  const openRe = new RegExp(`<(?:[\\w]+:)?${tagName}\\b[^>]*>`, 'i')
  const openM = openRe.exec(xml)
  if (!openM) return undefined
  const startIdx = openM.index + openM[0].length
  // Match closing tag with optional namespace prefix
  const closeRe = new RegExp(`</(?:[\\w]+:)?${tagName}>`, 'i')
  closeRe.lastIndex = startIdx
  const closeM = closeRe.exec(xml)
  if (!closeM) return undefined
  return xml.slice(startIdx, closeM.index)
}

/** @internal — parse <Property Name="..." Type="..." Nullable="..." [MaxLength="..."] /> */
function parseProperty(xml: string): EdmProperty {
  const attrs = getAttrs(xml)
  const nullable = parseBoolAttr(attrs.Nullable, true)
  const out: EdmProperty = {
    name: attrs.Name ?? '',
    type: attrs.Type ?? '',
    nullable,
  }
  if (attrs.MaxLength !== undefined) {
    const n = parseInt(attrs.MaxLength, 10)
    if (!Number.isNaN(n)) out.maxLength = n
  }
  return out
}

/** @internal — parse <NavigationProperty Name="..." Type="..." /> */
function parseNavigationProperty(xml: string): { name: string; target: string; collection: boolean } {
  const attrs = getAttrs(xml)
  const type = attrs.Type ?? ''
  const collection = type.startsWith('Collection(')
  const target = collection ? type.slice(11, -1) : type
  return {
    name: attrs.Name ?? '',
    target,
    collection,
  }
}

/** @internal — parse <Key><PropertyRef Name="..." /></Key> */
function parseKey(xml: string): string[] {
  const keys: string[] = []
  const refs = findElements(xml, 'PropertyRef')
  for (const ref of refs) {
    const name = getAttr(ref, 'Name')
    if (name) keys.push(name)
  }
  return keys
}

/** @internal — parse <EntityType Name="...">...</EntityType> */
function parseEntityType(xml: string): EdmEntityType {
  const name = getAttr(xml, 'Name') ?? ''
  const keys: string[] = []
  const properties: EdmProperty[] = []
  const navigationProperties: EdmEntityType['navigationProperties'] = []

  const inner = elementContent(xml, 'EntityType') ?? xml

  // Key
  const keyEl = findElements(inner, 'Key')[0]
  if (keyEl) {
    keys.push(...parseKey(keyEl))
  }

  // Properties
  for (const prop of findElements(inner, 'Property')) {
    properties.push(parseProperty(prop))
  }

  // Navigation Properties
  for (const nav of findElements(inner, 'NavigationProperty')) {
    navigationProperties.push(parseNavigationProperty(nav))
  }

  return { name, keys, properties, navigationProperties }
}

/** @internal — parse <EntitySet Name="..." EntityType="..." /> */
function parseEntitySet(xml: string): EdmEntitySet {
  const attrs = getAttrs(xml)
  return {
    name: attrs.Name ?? '',
    entityType: attrs.EntityType ?? '',
  }
}

/** @internal — parse <Action Name="...">[...parameters...]</Action> */
function parseAction(xml: string): EdmAction {
  const name = getAttr(xml, 'Name') ?? ''
  const attrs = getAttrs(xml)
  const boundTo = attrs['IsBound'] === 'true' ? attrs['EntityType'] : undefined

  const parameters: EdmAction['parameters'] = []
  const inner = elementContent(xml, 'Action') ?? xml
  for (const p of findElements(inner, 'Parameter')) {
    const pAttrs = getAttrs(p)
    parameters.push({
      name: pAttrs.Name ?? '',
      type: pAttrs.Type ?? '',
    })
  }

  return { name, boundTo, parameters }
}

/**
 * @internal — parse raw CSDL XML into ODataMetadata.
 * Throws FMODataError for malformed XML.
 */
export function parseMetadata(xml: string): ODataMetadata {
  try {
    // Extract Edmx/DataServices/Schema
    const dataServices = elementContent(xml, 'DataServices')
    if (!dataServices) {
      throw new Error('Missing <edmx:DataServices> in metadata')
    }

    const schema = findElements(dataServices, 'Schema')[0]
    if (!schema) {
      throw new Error('Missing <Schema> in metadata')
    }

    const namespace = getAttr(schema, 'Namespace') ?? ''
    const schemaInner = elementContent(schema, 'Schema') ?? schema

    // Parse EntityTypes
    const entityTypes: EdmEntityType[] = []
    for (const et of findElements(schemaInner, 'EntityType')) {
      entityTypes.push(parseEntityType(et))
    }

    // Parse EntitySets (inside EntityContainer)
    const entitySets: EdmEntitySet[] = []
    const container = findElements(schemaInner, 'EntityContainer')[0]
    if (container) {
      const containerInner = elementContent(container, 'EntityContainer') ?? container
      for (const es of findElements(containerInner, 'EntitySet')) {
        entitySets.push(parseEntitySet(es))
      }
    }

    // Parse Actions (FileMaker scripts surface here)
    const actions: EdmAction[] = []
    for (const a of findElements(schemaInner, 'Action')) {
      actions.push(parseAction(a))
    }

    return {
      namespace,
      entityTypes,
      entitySets,
      actions,
      raw: xml,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new FMODataError(`Failed to parse $metadata: ${message}`, {
      status: 0,
      odataError: xml.slice(0, 500),
    })
  }
}

/**
 * @internal — fetch raw $metadata XML.
 */
export async function fetchMetadataXml(
  ctx: HttpClientContext,
  baseUrl: string,
  opts: RequestOptions = {},
): Promise<string> {
  const res = await executeRequest(ctx, `${baseUrl}/$metadata`, {
    method: 'GET',
    accept: 'xml',
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
  return res.text()
}

/**
 * Metadata fetcher bound to a client. Caches by default; pass `refresh: true` to bypass.
 * @internal — exported for testing; use via `FMOData#metadata()`.
 */
export class MetadataFetcher {
  private _cache: Promise<ODataMetadata> | undefined

  constructor(
    private _ctx: HttpClientContext,
    private _baseUrl: string,
  ) {}

  async fetchXml(opts: RequestOptions = {}): Promise<string> {
    return fetchMetadataXml(this._ctx, this._baseUrl, opts)
  }

  async fetch(opts: MetadataOptions = {}): Promise<ODataMetadata> {
    if (!opts.refresh && this._cache) {
      return this._cache
    }
    const promise = this.fetchXml(opts).then(parseMetadata)
    this._cache = promise
    return promise
  }
}
