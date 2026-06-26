export { FMSOData } from './client.js';
export { Batch, Changeset } from './batch.js';
export type { BatchHandle, BatchOpResult, BatchReadOp, BatchResult, } from './batch.js';
export { buildContainerJsonBody, ContainerRef, FM_CONTAINER_SUPPORTED_MIME_TYPES, sniffContainerMime, toBase64, } from './containers.js';
export type { ContainerDownload, ContainerJsonValue, ContainerUploadInput, FMContainerMimeType, } from './containers.js';
export { EntityRef } from './entity.js';
export type { EntityWriteOptions, EntityRefInfo } from './entity.js';
export { FMSODataError, FMScriptError, isFMSODataError, isFMScriptError } from './errors.js';
export type { ODataErrorBody } from './errors.js';
export { basicAuth, fmidAuth } from './http.js';
export type { FMAuthScheme, FMAuthToken, FMAuthTokenProvider } from './http.js';
export { MetadataFetcher } from './metadata.js';
export type { EdmAction, EdmEntitySet, EdmEntityType, EdmProperty, MetadataOptions, ODataMetadata, } from './metadata.js';
export { Filter, Query, filterFactory } from './query.js';
export type { FilterFactory, FilterInput, OrderDir, QueryResult } from './query.js';
export type { AggregateFunction } from '@fms-odata/spec-ts';
export { ScriptInvoker } from './scripts.js';
export type { ScriptOptions, ScriptResult, ScriptScope, ScriptIdentifier } from './scripts.js';
export { SchemaEditor } from './schema.js';
export type { SchemaOptions, DeleteSchemaOptions } from './schema.js';
export type { FMSODataOptions, TokenProvider, RequestOptions } from './types.js';
export type { ODataLiteral } from './url.js';
export { FM_VERSION_NAMES, FM_VERSION_MATRIX, ODATA_PROTOCOL_VERSION, hasFeature, hasQueryOption, minVersionForFeature, parseServerVersion, parseVersionString, } from '@fms-odata/spec-ts';
export type { FMVersionMajor, FMVersionStatus, FMFeatureFlags, FMQueryOptionFlags, FMVersionInfo, FMServerVersion, } from '@fms-odata/spec-ts';
export { FIELD_TYPES, FIELD_DEFAULTS, parseFieldType } from '@fms-odata/spec-ts';
export type { FMFieldType, FMFieldDefault, FMFieldDefinition, CreateTableParams, AddFieldsParams, } from '@fms-odata/spec-ts';
/** @deprecated Use `FMSOData` instead. */
export { FMSOData as FMOData } from './client.js';
/** @deprecated Use `FMSODataError` instead. */
export { FMSODataError as FMODataError } from './errors.js';
/** @deprecated Use `isFMSODataError` instead. */
export { isFMSODataError as isFMODataError } from './errors.js';
/** @deprecated Use `FMSODataOptions` instead. */
export type { FMSODataOptions as FMODataOptions } from './types.js';
//# sourceMappingURL=index.d.ts.map