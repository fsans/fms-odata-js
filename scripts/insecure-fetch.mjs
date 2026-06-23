// Factory for a Node-only fetch that optionally skips TLS verification.
//
// FileMaker Server on a LAN IP (e.g. `https://192.168.0.24`) typically serves
// a self-signed certificate. Production callers supply their own verified
// fetch; this helper is only used by the local dev probe and the opt-in
// live-integration test suite.
//
// Zero external deps: toggles Node's `NODE_TLS_REJECT_UNAUTHORIZED=0` for the
// lifetime of the current process when insecure mode is requested. This is
// dev-only and never shipped in the runtime bundle.

/**
 * Build a `fetch`-compatible function.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.insecureTls=false] If true, disables certificate
 *   verification process-wide. USE IN DEV ONLY.
 * @returns {typeof globalThis.fetch}
 */
export function createFetch({ insecureTls = false } = {}) {
  if (insecureTls) {
    // Applies to this Node process only. Node's built-in fetch (undici) honors
    // this env var. Safer approaches (per-request `dispatcher`) require adding
    // `undici` as a devDep, which we avoid.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    if (!globalThis.__fmOdataTlsWarned) {
      globalThis.__fmOdataTlsWarned = true
      console.warn(
        '[fms-odata-js] TLS certificate verification is DISABLED for this process (FM_VERIFY_SSL=0 or FM_ODATA_INSECURE_TLS=1). Dev use only.',
      )
    }
  }
  return globalThis.fetch
}
