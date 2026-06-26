/**
 * Schema modification (DDL) for FileMaker Server via the OData system tables.
 *
 * FMS exposes DDL through two system tables:
 *
 *   FileMaker_Tables   — create tables, add fields, delete tables/fields
 *   FileMaker_Indexes  — create and delete field indexes
 *
 * All operations require a FileMaker account with full access (schema
 * modification) privileges in the target file.
 *
 * Destructive operations (`deleteTable`, `deleteField`) require an explicit
 * `confirm: true` option to prevent accidental data loss, per the spec's
 * security guidance (docs/10-schema-modification.md).
 *
 * @see https://github.com/fsans/fms-odata-spec/blob/main/docs/10-schema-modification.md
 */

import {
  FIELD_TYPES,
  parseFieldType,
  type CreateTableParams,
  type AddFieldsParams,
  type FMFieldDefinition,
} from '@fms-odata/spec-ts'
import type { FMSOData } from './client.js'
import { executeJson } from './http.js'
import type { RequestOptions } from './types.js'
import { encodePathSegment } from './url.js'

/** Options accepted by schema operations. */
export interface SchemaOptions extends RequestOptions {}

/** Options for destructive schema operations (deleteTable, deleteField). */
export interface DeleteSchemaOptions extends SchemaOptions {
  /**
   * Must be `true` to proceed. Destructive DDL operations permanently destroy
   * data with no undo. This guard prevents accidental invocation.
   */
  confirm: true
}

/** Validate that every field definition uses a supported base type. */
function validateFieldDefinitions(fields: FMFieldDefinition[]): void {
  for (const f of fields) {
    if (!f.name) throw new TypeError('SchemaEditor: field `name` is required')
    if (!f.type) throw new TypeError('SchemaEditor: field `type` is required')
    const { baseType } = parseFieldType(f.type)
    const upper = baseType.toUpperCase()
    if (!FIELD_TYPES.includes(upper as (typeof FIELD_TYPES)[number])) {
      throw new TypeError(
        `SchemaEditor: unsupported field type "${f.type}" (base: "${baseType}"). ` +
          `Supported: ${FIELD_TYPES.join(', ')}`,
      )
    }
  }
}

/**
 * Schema editor for FileMaker DDL operations.
 *
 * Obtain an instance via `db.schema()` or use the convenience methods on
 * `FMSOData` (`db.createTable`, `db.addFields`, etc.).
 */
export class SchemaEditor {
  /** @internal */ readonly _client: FMSOData

  constructor(client: FMSOData) {
    this._client = client
  }

  /**
   * Create a new table with the given field definitions.
   *
   * ```ts
   * await db.schema().createTable({
   *   tableName: 'Company',
   *   fields: [
   *     { name: 'Company ID', type: 'int', primary: true },
   *     { name: 'Company Name', type: 'varchar(100)', nullable: false },
   *   ],
   * })
   * ```
   */
  async createTable(
    params: CreateTableParams,
    opts: SchemaOptions = {},
  ): Promise<unknown> {
    if (!params.tableName) throw new TypeError('SchemaEditor: `tableName` is required')
    if (!params.fields?.length) throw new TypeError('SchemaEditor: `fields` must be a non-empty array')
    validateFieldDefinitions(params.fields)

    const url = `${this._client.baseUrl}/FileMaker_Tables`
    return executeJson<unknown>(this._client._ctx, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  /**
   * Add fields to an existing table.
   *
   * ```ts
   * await db.schema().addFields({
   *   tableName: 'Company',
   *   fields: [{ name: 'Phone', type: 'varchar(30)' }],
   * })
   * ```
   */
  async addFields(
    params: AddFieldsParams,
    opts: SchemaOptions = {},
  ): Promise<unknown> {
    if (!params.tableName) throw new TypeError('SchemaEditor: `tableName` is required')
    if (!params.fields?.length) throw new TypeError('SchemaEditor: `fields` must be a non-empty array')
    validateFieldDefinitions(params.fields)

    const url = `${this._client.baseUrl}/FileMaker_Tables('${encodePathSegment(params.tableName)}')`
    return executeJson<unknown>(this._client._ctx, url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: params.fields }),
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  /**
   * Delete a table and ALL its records. Irreversible.
   *
   * Requires `opts.confirm === true` as a safety guard.
   *
   * ```ts
   * await db.schema().deleteTable('OldTable', { confirm: true })
   * ```
   */
  async deleteTable(
    tableName: string,
    opts: DeleteSchemaOptions,
  ): Promise<void> {
    if (!tableName) throw new TypeError('SchemaEditor: `tableName` is required')
    if (opts.confirm !== true) {
      throw new TypeError(
        `SchemaEditor: deleteTable("${tableName}") requires { confirm: true } — ` +
          'this operation permanently destroys the table and all its records.',
      )
    }
    const url = `${this._client.baseUrl}/FileMaker_Tables('${encodePathSegment(tableName)}')`
    await executeJson<void>(this._client._ctx, url, {
      method: 'DELETE',
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  /**
   * Delete a field from a table. Irreversible.
   *
   * Requires `opts.confirm === true` as a safety guard.
   *
   * ```ts
   * await db.schema().deleteField('Company', 'OldField', { confirm: true })
   * ```
   */
  async deleteField(
    tableName: string,
    fieldName: string,
    opts: DeleteSchemaOptions,
  ): Promise<void> {
    if (!tableName) throw new TypeError('SchemaEditor: `tableName` is required')
    if (!fieldName) throw new TypeError('SchemaEditor: `fieldName` is required')
    if (opts.confirm !== true) {
      throw new TypeError(
        `SchemaEditor: deleteField("${tableName}", "${fieldName}") requires { confirm: true } — ` +
          'this operation permanently destroys the field and all its data.',
      )
    }
    const url = `${this._client.baseUrl}/FileMaker_Tables('${encodePathSegment(tableName)}')/${encodePathSegment(fieldName)}`
    await executeJson<void>(this._client._ctx, url, {
      method: 'DELETE',
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  /**
   * Create an index on a field.
   *
   * ```ts
   * await db.schema().createIndex('Company', 'Company Name')
   * ```
   */
  async createIndex(
    tableName: string,
    fieldName: string,
    opts: SchemaOptions = {},
  ): Promise<unknown> {
    if (!tableName) throw new TypeError('SchemaEditor: `tableName` is required')
    if (!fieldName) throw new TypeError('SchemaEditor: `fieldName` is required')

    const url = `${this._client.baseUrl}/FileMaker_Indexes/${encodePathSegment(tableName)}`
    return executeJson<unknown>(this._client._ctx, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ indexName: fieldName }),
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  /**
   * Delete an index from a field.
   *
   * ```ts
   * await db.schema().deleteIndex('Company', 'Company Name')
   * ```
   */
  async deleteIndex(
    tableName: string,
    fieldName: string,
    opts: SchemaOptions = {},
  ): Promise<void> {
    if (!tableName) throw new TypeError('SchemaEditor: `tableName` is required')
    if (!fieldName) throw new TypeError('SchemaEditor: `fieldName` is required')

    const url = `${this._client.baseUrl}/FileMaker_Indexes/${encodePathSegment(tableName)}/${encodePathSegment(fieldName)}`
    await executeJson<void>(this._client._ctx, url, {
      method: 'DELETE',
      accept: 'json',
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }
}
