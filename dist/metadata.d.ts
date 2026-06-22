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
import { type HttpClientContext } from './http.js';
import type { RequestOptions } from './types.js';
/** Property on an entity type (field in FileMaker). */
export interface EdmProperty {
    name: string;
    type: string;
    nullable: boolean;
    maxLength?: number;
}
/** Entity type (FileMaker table occurrence). */
export interface EdmEntityType {
    name: string;
    keys: string[];
    properties: EdmProperty[];
    navigationProperties: {
        name: string;
        target: string;
        collection: boolean;
    }[];
}
/** Entity set (exposed layout/table in OData). */
export interface EdmEntitySet {
    name: string;
    entityType: string;
}
/** Action (FileMaker script exposed as OData Action). */
export interface EdmAction {
    name: string;
    boundTo?: string;
    parameters: {
        name: string;
        type: string;
    }[];
}
/** Parsed OData metadata document. */
export interface ODataMetadata {
    namespace: string;
    entityTypes: EdmEntityType[];
    entitySets: EdmEntitySet[];
    actions: EdmAction[];
    /** Product version string extracted from Org.OData.Core.V1.ProductVersion annotation (if present). */
    productVersion?: string;
    /** Original XML, for debugging and forward compatibility. */
    raw: string;
}
/** Options for metadata fetch. */
export interface MetadataOptions extends RequestOptions {
    /** Force refetch, bypassing the internal cache. */
    refresh?: boolean;
}
/**
 * @internal — parse raw CSDL XML into ODataMetadata.
 * Throws FMODataError for malformed XML.
 */
export declare function parseMetadata(xml: string): ODataMetadata;
/**
 * @internal — fetch raw $metadata XML.
 */
export declare function fetchMetadataXml(ctx: HttpClientContext, baseUrl: string, opts?: RequestOptions): Promise<string>;
/**
 * Metadata fetcher bound to a client. Caches by default; pass `refresh: true` to bypass.
 * @internal — exported for testing; use via `FMOData#metadata()`.
 */
export declare class MetadataFetcher {
    private _ctx;
    private _baseUrl;
    private _cache;
    constructor(_ctx: HttpClientContext, _baseUrl: string);
    fetchXml(opts?: RequestOptions): Promise<string>;
    fetch(opts?: MetadataOptions): Promise<ODataMetadata>;
}
//# sourceMappingURL=metadata.d.ts.map