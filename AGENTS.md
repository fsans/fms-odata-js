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
- `src/schema.ts` — schema DDL (create/delete tables, fields, indexes)
- `src/webhooks.ts` — webhook management (create, remove, get, getAll, invoke)

## Bundle constraints

- Zero runtime dependencies (the `dependencies` field in package.json must stay empty)
- `@fms-odata/spec-ts` is a devDependency only — bundled at build time
- Target gzipped size: under 12 KB for ESM min (raised from 10 KB after adding schema DDL + webhooks modules)

## Development workflow

Feature branch workflow with `development` as the integration branch:

```
feature/*  ->  development  ->  main
   (PR)         (PR)           (release)
```

### Branches

- **`main`** — Production-ready code. Only receives PRs from `development`.
- **`development`** — Integration branch for features. All work lands here first.
- **`feature/*`** — Individual feature/fix branches (create from `development`).

### Workflow

1. **Start work** — create a feature branch from `development`:
   ```bash
   git checkout development
   git pull origin development
   git checkout -b feature/my-feature
   ```
2. **Develop** — make commits on your feature branch.
3. **Push** — push the feature branch to origin.
4. **Create PR** — open a Pull Request from `feature/my-feature` -> `development`.
5. **Review & merge** — after review, merge into `development`.
6. **Release** — when ready, create a PR from `development` -> `main`.

### Commit message format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation
- `test:` — tests
- `refactor:` — code refactoring
- `chore:` — build/tooling
- `feat!:` / `fix!:` — breaking change (append `!` after the type)

Example:
```
fix: comma encoding in OData query parameters

FileMaker Server rejects %2C in $select, $orderby.
Added odataEncode() helper to preserve literal commas.
```

### Pre-PR checklist

- [ ] Tests pass: `npm test`
- [ ] Build succeeds: `npm run build`
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] `CHANGELOG.md` updated (if user-facing change)
- [ ] Version bumped (if releasing)
