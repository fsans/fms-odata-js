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
import { type CreateTableParams, type AddFieldsParams } from '@fms-odata/spec-ts';
import type { FMSOData } from './client.js';
import type { RequestOptions } from './types.js';
/** Options accepted by schema operations. */
export interface SchemaOptions extends RequestOptions {
}
/** Options for destructive schema operations (deleteTable, deleteField). */
export interface DeleteSchemaOptions extends SchemaOptions {
    /**
     * Must be `true` to proceed. Destructive DDL operations permanently destroy
     * data with no undo. This guard prevents accidental invocation.
     */
    confirm: true;
}
/**
 * Schema editor for FileMaker DDL operations.
 *
 * Obtain an instance via `db.schema()` or use the convenience methods on
 * `FMSOData` (`db.createTable`, `db.addFields`, etc.).
 */
export declare class SchemaEditor {
    /** @internal */ readonly _client: FMSOData;
    constructor(client: FMSOData);
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
    createTable(params: CreateTableParams, opts?: SchemaOptions): Promise<unknown>;
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
    addFields(params: AddFieldsParams, opts?: SchemaOptions): Promise<unknown>;
    /**
     * Delete a table and ALL its records. Irreversible.
     *
     * Requires `opts.confirm === true` as a safety guard.
     *
     * ```ts
     * await db.schema().deleteTable('OldTable', { confirm: true })
     * ```
     */
    deleteTable(tableName: string, opts: DeleteSchemaOptions): Promise<void>;
    /**
     * Delete a field from a table. Irreversible.
     *
     * Requires `opts.confirm === true` as a safety guard.
     *
     * ```ts
     * await db.schema().deleteField('Company', 'OldField', { confirm: true })
     * ```
     */
    deleteField(tableName: string, fieldName: string, opts: DeleteSchemaOptions): Promise<void>;
    /**
     * Create an index on a field.
     *
     * ```ts
     * await db.schema().createIndex('Company', 'Company Name')
     * ```
     */
    createIndex(tableName: string, fieldName: string, opts?: SchemaOptions): Promise<unknown>;
    /**
     * Delete an index from a field.
     *
     * ```ts
     * await db.schema().deleteIndex('Company', 'Company Name')
     * ```
     */
    deleteIndex(tableName: string, fieldName: string, opts?: SchemaOptions): Promise<void>;
}
//# sourceMappingURL=schema.d.ts.map