// Tiny .env loader (no dependencies). Only reads KEY=VALUE lines, ignores
// comments and blank lines. Values are NOT shell-expanded; quotes are
// optional and stripped.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

export function loadEnvFile(path = resolve(repoRoot, '.env')) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return {}
    throw e
  }
  const out = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
    // Populate process.env only if not already set (process env wins).
    if (process.env[key] === undefined) process.env[key] = value
  }
  return out
}

/**
 * Load `.env` and return a typed config object. Missing required fields throw.
 *
 * Env var names are aligned with the fms-odata-spec standard:
 *   FM_SERVER, FM_DATABASE, FM_USER, FM_PASSWORD, FM_VERIFY_SSL, FM_TIMEOUT
 *
 * Legacy `FM_ODATA_*` names are still accepted as fallbacks for backward
 * compatibility. Standardized names take precedence.
 */
export function loadFmConfig() {
  loadEnvFile()

  // Resolve with fallback: standardized name first, then legacy FM_ODATA_* name.
  const pick = (standard, legacy) => process.env[standard] ?? process.env[legacy]
  const pickBool = (standard, legacy) =>
    process.env[standard] === '1' || process.env[legacy] === '1'

  const host = pick('FM_SERVER', 'FM_ODATA_HOST')
  const database = pick('FM_DATABASE', 'FM_ODATA_DATABASE')
  const user = pick('FM_USER', 'FM_ODATA_USER')
  const password = pick('FM_PASSWORD', 'FM_ODATA_PASSWORD')

  const required = { FM_SERVER: host, FM_DATABASE: database, FM_USER: user, FM_PASSWORD: password }
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) {
    throw new Error(
      `Missing required env vars: ${missing.join(', ')}. Copy .env.sample to .env and fill them in. ` +
        `(Legacy names FM_ODATA_HOST, FM_ODATA_DATABASE, FM_ODATA_USER, FM_ODATA_PASSWORD are also accepted.)`,
    )
  }

  // FM_VERIFY_SSL: standardized name uses positive logic (1 = verify).
  // Legacy FM_ODATA_INSECURE_TLS uses inverted logic (1 = skip verification).
  const verifySsl = process.env.FM_VERIFY_SSL !== '0' && process.env.FM_ODATA_INSECURE_TLS !== '1'

  return {
    host: host.replace(/\/+$/, ''),
    database,
    user,
    password,
    live: pickBool('FM_LIVE', 'FM_ODATA_LIVE'),
    insecureTls: !verifySsl,
    timeoutMs: process.env.FM_TIMEOUT ? parseInt(process.env.FM_TIMEOUT, 10) : undefined,
    tables: {
      contact: process.env.FM_ODATA_TABLE_CONTACT ?? 'contact',
      address: process.env.FM_ODATA_TABLE_ADDRESS ?? 'address',
      email: process.env.FM_ODATA_TABLE_EMAIL ?? 'email',
      phone: process.env.FM_ODATA_TABLE_PHONE ?? 'phone',
    },
  }
}
