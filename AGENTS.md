# AGENTS.md — fms-odata-js

## Overview

Zero-runtime-dependency TypeScript client for the FileMaker Server OData v4 API.
Works in Node 18+, browsers, and the FileMaker Web Viewer.

## Spec alignment

This library is aligned with the [fms-odata-spec](https://github.com/fsans/fms-odata-spec)
reference specification and depends on `@fms-odata/spec-ts` (as a devDependency)
for shared type definitions and the version feature matrix. The spec package
is bundled at build time via esbuild — end users do not need to install it.

See `docs/14-reconciliation.md` in the spec repo for the full alignment plan.

## Build commands

- `npm run build` — build all output formats (types, ESM, minified ESM, IIFE)
- `npm test` — run unit tests (vitest, no server needed)
- `npm run probe` — connectivity probe against a real FMS (needs `.env`)
- `npx tsc --noEmit` — typecheck only

## Test commands

- `npx vitest run tests/unit` — unit tests only (227 tests, offline)
- `npx vitest run tests/integration` — live integration tests (needs real FMS + `.env`)

## Env vars

Standardized names (preferred): `FM_SERVER`, `FM_DATABASE`, `FM_USER`, `FM_PASSWORD`, `FM_VERIFY_SSL`, `FM_TIMEOUT`, `FM_LIVE`
Legacy names (still accepted): `FM_ODATA_HOST`, `FM_ODATA_DATABASE`, `FM_ODATA_USER`, `FM_ODATA_PASSWORD`, `FM_ODATA_INSECURE_TLS`, `FM_ODATA_LIVE`

## Key files

- `src/client.ts` — `FMSOData` entrypoint, version detection, feature gating
- `src/query.ts` — fluent query builder (`$filter`, `$select`, `$expand`, `$apply`, etc.)
- `src/entity.ts` — single-record handle (CRUD, containers, scripts, `$ref`)
- `src/scripts.ts` — script invocation (by name and by FMSID)
- `src/http.ts` — HTTP plumbing (auth, timeout, 401 retry)
- `src/metadata.ts` — `$metadata` parser (with ProductVersion extraction)
- `src/containers.ts` — container field I/O (binary + base64)
- `src/batch.ts` — `$batch` multipart composer
- `src/errors.ts` — `FMSODataError`, `FMScriptError`, type guards

## Bundle constraints

- Zero runtime dependencies (the `dependencies` field in package.json must stay empty)
- `@fms-odata/spec-ts` is a devDependency only — bundled at build time
- Target gzipped size: under 10 KB for ESM min
