# Testing and Developer Tooling

The `fms-odata-js` library maintains a robust testing infrastructure designed to ensure reliability across both simulated and live FileMaker environments. The tooling suite includes a high-coverage unit test suite, an opt-in live integration suite, and specialized developer scripts for environment management and connectivity probing.

### Test Infrastructure Overview

The project utilizes `vitest` as its primary test runner and `playwright` for end-to-end (e2e) verification. The testing strategy is split into three distinct layers to balance speed with real-world accuracy.

| Layer | Location | Purpose |
| :--- | :--- | :--- |
| **Unit Tests** | `tests/unit/` | Exercises individual modules (URL formatting, Error parsing, Query building) using mocks. |
| **Integration Tests** | `tests/integration/` | Validates full request/response lifecycles, including an opt-in live suite for real FMS instances. |
| **E2E Tests** | `tests/e2e/` | Browser-based testing via Playwright to ensure compatibility in Web Viewer environments. |

For a deep dive into running and writing tests, see [Unit and Integration Tests](#7.1).

### Developer Scripts and Utilities

The `scripts/` directory contains Node.js utilities that assist in local development and troubleshooting. These tools handle environment configuration, SSL/TLS workarounds for local FileMaker Servers, and a "probe" utility to verify OData connectivity and schema visibility.

**Key Developer Commands:**
*   `npm run probe`: Executes a connectivity check against the configured FMS.
*   `npm run lint` / `npm run format`: Maintains code quality and style consistency.
*   `npm run size`: Tracks the minified bundle size to ensure the library remains lightweight.

For details on utilizing these utilities, see [Developer Scripts and Probe Utility](#7.2).

### Relationship of Tooling Entities

The following diagram illustrates how the developer scripts and test suites interact with the library source and external FileMaker environments.

**Developer Tooling Flow**
```mermaid
graph TD
  subgraph "Local Environment"
    [".env"] -- "loads via" --> ["scripts/env.mjs"]
    ["scripts/env.mjs"] -- "configures" --> ["scripts/probe.mjs"]
    ["scripts/env.mjs"] -- "configures" --> ["tests/integration/live.test.ts"]
    ["scripts/insecure-fetch.mjs"] -- "enables TLS bypass" --> ["FMSOData Client"]
  end

  subgraph "Test Suites"
    ["vitest.config.ts"] -- "runs" --> ["Unit Tests"]
    ["vitest.config.ts"] -- "runs" --> ["Integration Tests"]
    ["playwright.config.ts"] -- "runs" --> ["E2E Tests"]
  end

  ["FMSOData Client"] -- "OData API" --> ["FileMaker Server"]
  ["scripts/probe.mjs"] -- "validates" --> ["FileMaker Server"]
  ["Integration Tests"] -- "exercises" --> ["FileMaker Server"]
```
Sources: [scripts/env.mjs:1-13](), [tests/integration/live.test.ts:1-26](), [vitest.config.ts:1-13](), [playwright.config.ts:1-11]()

### Testing and Entity Space Mapping

The test infrastructure maps directly to the core library components, ensuring that every layer of the `src/` directory is exercised.

**Code Coverage Mapping**
```mermaid
graph LR
  subgraph "Test Suite"
    ["tests/unit/client.test.ts"]
    ["tests/unit/query.test.ts"]
    ["tests/unit/url.test.ts"]
    ["tests/integration/live.test.ts"]
  end

  subgraph "Source Entities"
    ["src/index.ts"]
    ["src/query.ts"]
    ["src/url.ts"]
    ["src/http.ts"]
  end

  ["tests/unit/client.test.ts"] -.-> ["src/index.ts"]
  ["tests/unit/query.test.ts"] -.-> ["src/query.ts"]
  ["tests/unit/url.test.ts"] -.-> ["src/url.ts"]
  ["tests/integration/live.test.ts"] -- "Full Stack" --> ["src/http.ts"]
```
Sources: [vitest.config.ts:4-11](), [tests/integration/live.test.ts:11-26]()

### Live Integration Workflow

The live integration suite in `tests/integration/live.test.ts` is skipped by default to allow for fast, offline development. It is activated by setting `FM_ODATA_LIVE=1` in the environment.

*   **Lifecycle Testing**: It performs a full CRUD cycle (Create, Read, Update, Delete) on a target table [tests/integration/live.test.ts:47-89]().
*   **Script Verification**: It attempts to run a "Ping" script to verify Action/Script execution [tests/integration/live.test.ts:91-112]().
*   **Cleanup**: An `afterAll` hook ensures that any records created during the test are removed from the FileMaker database, even if assertions fail [tests/integration/live.test.ts:31-39]().

Sources: [tests/integration/live.test.ts:1-128]()
