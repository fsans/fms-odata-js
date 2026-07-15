# Core Architecture

The `fms-odata-js` library is designed with a layered, modular architecture that separates the high-level fluent API from the low-level HTTP and URL serialization concerns. This design ensures that the library remains lightweight (~23.9 KB raw / ~7.9 KB gzipped) while providing robust handling for FileMaker Server (FMS) specific behaviors.

## System Layering

The library follows a strict hierarchical flow where each layer depends only on the layers below it. This structure facilitates testability and allows developers to drop down to lower-level primitives when necessary.

### Module Dependency Graph

The following diagram illustrates how the core modules interact, from the public entry point down to the utility layers.

**Module Architecture and Data Flow**

```mermaid
graph TD
    subgraph "Public API Layer"
        ["FMSOData Class"] -- "creates" --> ["Query Builder"]
        ["FMSOData Class"] -- "manages" --> ["HttpClientContext"]
    end

    subgraph "Operation Layer"
        ["Query Builder"] -- "returns" --> ["EntityRef"]
        ["Query Builder"] -- "uses" --> ["ScriptInvoker"]
        ["EntityRef"] -- "uses" --> ["ScriptInvoker"]
    end

    subgraph "Execution Layer"
        ["HttpClientContext"] -- "flows into" --> ["HTTP Layer"]
        ["HTTP Layer"] -- "normalizes" --> ["Error Handling"]
    end

    subgraph "Utility Layer"
        ["Query Builder"] -- "serializes via" --> ["URL Utilities"]
        ["EntityRef"] -- "serializes via" --> ["URL Utilities"]
    end

    ["FMSOData Class"]:::code
    ["Query Builder"]:::code
    ["EntityRef"]:::code
    ["ScriptInvoker"]:::code
    ["HTTP Layer"]:::code
    ["URL Utilities"]:::code
    ["Error Handling"]:::code

    classDef code font-family:monospace,font-weight:bold;
```

Sources: [src/index.ts:1-11](), [src/client.ts:1-118](), [src/query.ts:1-255](), [src/http.ts:1-150]()

## Key Components

### FMSOData Client

The `FMSOData` class is the primary entry point. It holds the configuration (host, database, and credentials) and manages the `HttpClientContext`. This context is passed internally to every request to ensure consistent authentication and timeout handling. It provides the `.from(entitySet)` method to initiate queries.

For details, see [FMSOData Client](#2.1).
Sources: [src/client.ts:18-35](), [src/types.ts:12-25]()

### Query & Entity Operations

The library provides two primary ways to interact with data:

1.  **`Query<T>`**: A fluent builder for collection-level operations (filtering, sorting, paging). It culminates in terminal actions like `.get()` or `.create()`.
2.  **`EntityRef<T>`**: A reference to a specific record via its primary key, used for targeted operations like `.patch()` or `.delete()`.

For details, see [Query Builder](#2.2) and [EntityRef — Single-Record Operations](#2.3).
Sources: [src/query.ts:100-115](), [src/entity.ts:14-25]()

### HTTP & URL Infrastructure

The library abstracts the complexities of OData URL construction and FMS authentication.

*   **HTTP Layer**: Handles the `fetch` execution, 401-retry logic via `onUnauthorized`, and credential resolution (Basic vs Bearer).
*   **URL Utilities**: Manages OData-specific formatting, such as escaping string literals and formatting FileMaker-compatible ISO-8601 dates.

For details, see [HTTP Layer](#2.4) and [URL Utilities](#2.5).
Sources: [src/http.ts:45-60](), [src/url.ts:1-50]()

## Code Entity Mapping

The following diagram bridges natural language concepts to the specific TypeScript classes and functions used in the codebase.

**Code Entity Mapping**

```mermaid
graph LR
    subgraph "Natural Language"
        A["Authentication"]
        B["Data Fetching"]
        C["URL Building"]
        D["Error State"]
    end

    subgraph "Code Entity Space"
        A --> ["resolveAuthHeader()"]
        A --> ["basicAuth()"]
        B --> ["FMSOData.from()"]
        B --> ["Query.get()"]
        C --> ["formatLiteral()"]
        C --> ["buildQueryString()"]
        D --> ["FMSODataError"]
        D --> ["FMScriptError"]
    end

    ["resolveAuthHeader()"]:::code
    ["basicAuth()"]:::code
    ["FMSOData.from()"]:::code
    ["Query.get()"]:::code
    ["formatLiteral()"]:::code
    ["buildQueryString()"]:::code
    ["FMSODataError"]:::code
    ["FMScriptError"]:::code

    classDef code font-family:monospace,font-weight:bold;
```

Sources: [src/http.ts:25-30](), [src/client.ts:74-78](), [src/url.ts:70-85](), [src/errors.ts:10-30]()

## Internal Subsystems

| Subsystem | Primary Responsibility | Key Files |
| :--- | :--- | :--- |
| **Client** | Configuration and context propagation | `client.ts`, `types.ts` |
| **Query** | Fluent OData query string construction | `query.ts` |
| **Entity** | Single-record CRUD and key formatting | `entity.ts` |
| **HTTP** | Request execution, auth, and retries | `http.ts` |
| **Scripts** | FileMaker Script action invocation | `scripts.ts` |
| **Errors** | Parsing FMS XML and JSON error responses | `errors.ts` |
| **Utilities** | OData literal and URL encoding | `url.ts` |

### Error Hierarchy

The library uses a specialized error hierarchy to distinguish between transport-level failures and FileMaker-specific logic failures (like script errors). All errors inherit from `FMSODataError`, which captures the HTTP status and the OData error payload.

For details, see [Error Handling](#2.6).
Sources: [src/errors.ts:7-45](), [CHANGELOG.md:18-18]()
