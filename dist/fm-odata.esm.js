// src/errors.ts
var FMODataError = class extends Error {
  constructor(message, init) {
    super(message);
    this.name = "FMODataError";
    this.status = init.status;
    if (init.code !== void 0) this.code = init.code;
    if (init.odataError !== void 0) this.odataError = init.odataError;
    if (init.request !== void 0) this.request = init.request;
  }
};
async function parseErrorResponse(res, request) {
  const status = res.status;
  let body = "";
  try {
    body = await res.text();
  } catch {
  }
  let code;
  let message = res.statusText || `HTTP ${status}`;
  let odataError = body;
  const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
  const looksJson = ctype.includes("json") || body.startsWith("{") && body.endsWith("}");
  const looksXml = ctype.includes("xml") || body.trimStart().startsWith("<?xml") || body.includes("<m:error");
  if (looksJson) {
    try {
      const json = JSON.parse(body);
      odataError = json;
      const errCode = json?.error?.code;
      const rawMsg = json?.error?.message;
      const msg = typeof rawMsg === "string" ? rawMsg : rawMsg?.value;
      if (errCode) code = String(errCode);
      if (msg) message = msg;
    } catch {
    }
  } else if (looksXml) {
    const codeMatch = body.match(/<m:code>([^<]+)<\/m:code>/);
    const msgMatch = body.match(/<m:message(?:\s[^>]*)?>([^<]+)<\/m:message>/);
    if (codeMatch?.[1]) code = codeMatch[1];
    if (msgMatch?.[1]) message = msgMatch[1];
  }
  return new FMODataError(message, { status, ...code !== void 0 ? { code } : {}, odataError, request });
}
var FMScriptError = class extends FMODataError {
  constructor(message, init) {
    super(message, {
      status: init.status,
      code: init.scriptError,
      ...init.odataError !== void 0 ? { odataError: init.odataError } : {},
      ...init.request !== void 0 ? { request: init.request } : {}
    });
    this.name = "FMScriptError";
    this.scriptError = init.scriptError;
    if (init.scriptResult !== void 0) this.scriptResult = init.scriptResult;
  }
};
function isFMODataError(err) {
  return err instanceof FMODataError;
}
function isFMScriptError(err) {
  return err instanceof FMScriptError;
}

// src/http.ts
var AUTH_SCHEME_RE = /^(basic|bearer|fmid|negotiate|digest)\s+\S/i;
async function resolveAuthHeader(provider) {
  const raw = typeof provider === "function" ? await provider() : provider;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new TypeError("fm-odata-js: token resolver produced an empty value");
  }
  return AUTH_SCHEME_RE.test(raw) ? raw : `Bearer ${raw}`;
}
function basicAuth(user, password) {
  const raw = `${user}:${password}`;
  const b64 = typeof Buffer !== "undefined" ? Buffer.from(raw, "utf8").toString("base64") : btoa(unescape(encodeURIComponent(raw)));
  return `Basic ${b64}`;
}
function fmidAuth(token) {
  return `FMID ${token}`;
}
function combineSignals(signals) {
  const filtered = signals.filter((s) => s !== void 0);
  if (filtered.length === 0) return void 0;
  if (filtered.length === 1) return filtered[0];
  const ctrl = new AbortController();
  for (const s of filtered) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      return ctrl.signal;
    }
    s.addEventListener(
      "abort",
      () => ctrl.abort(s.reason),
      { once: true }
    );
  }
  return ctrl.signal;
}
var ACCEPT_DEFAULTS = {
  json: "application/json",
  xml: "application/xml",
  text: "text/plain",
  binary: "application/octet-stream",
  none: "*/*"
};
async function executeRequest(ctx, url, opts = {}) {
  return executeRequestImpl(
    ctx,
    url,
    opts,
    /* retried */
    false
  );
}
async function executeRequestImpl(ctx, url, opts, retried) {
  const method = opts.method ?? "GET";
  const headers = new Headers(opts.headers);
  headers.set("Authorization", await resolveAuthHeader(ctx.token));
  if (!headers.has("OData-Version")) headers.set("OData-Version", "4.0");
  if (!headers.has("OData-MaxVersion")) headers.set("OData-MaxVersion", "4.0");
  if (!headers.has("Accept")) {
    headers.set("Accept", ACCEPT_DEFAULTS[opts.accept ?? "json"]);
  }
  const timeoutCtrl = new AbortController();
  const timeoutId = ctx.timeoutMs && ctx.timeoutMs > 0 ? setTimeout(() => timeoutCtrl.abort(new Error(`Timeout after ${ctx.timeoutMs}ms`)), ctx.timeoutMs) : void 0;
  const signal = combineSignals([opts.signal, ctx.timeoutMs ? timeoutCtrl.signal : void 0]);
  let res;
  try {
    res = await ctx.fetch(url, {
      method,
      headers,
      keepalive: true,
      ...opts.body !== void 0 ? { body: opts.body } : {},
      ...signal ? { signal } : {}
    });
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    throw err;
  }
  if (timeoutId) clearTimeout(timeoutId);
  if (res.status === 401 && ctx.onUnauthorized && !retried) {
    await ctx.onUnauthorized();
    return executeRequestImpl(ctx, url, opts, true);
  }
  if (!res.ok) {
    throw await parseErrorResponse(res, { url, method });
  }
  return res;
}
async function executeJson(ctx, url, opts = {}) {
  const res = await executeRequest(ctx, url, opts);
  if (res.status === 204) return void 0;
  const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!ctype.includes("json")) {
    const text = await res.text();
    if (!text) return void 0;
    try {
      return JSON.parse(text);
    } catch {
      throw new FMODataError(`Expected JSON response, got "${ctype || "no content-type"}"`, {
        status: res.status,
        odataError: text,
        request: { url, method: opts.method ?? "GET" }
      });
    }
  }
  return await res.json();
}

// src/url.ts
function escapeStringLiteral(s) {
  return s.replace(/'/g, "''");
}
function formatDateTime(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new TypeError("formatDateTime: invalid Date");
  }
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
function formatLiteral(v) {
  if (v === null || v === void 0) return "null";
  if (typeof v === "string") return `'${escapeStringLiteral(v)}'`;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new TypeError(`formatLiteral: cannot encode non-finite number: ${v}`);
    }
    return String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return formatDateTime(v);
  throw new TypeError(`formatLiteral: unsupported OData literal type: ${typeof v}`);
}
function encodePathSegment(s) {
  return encodeURIComponent(s);
}
function odataEncode(v) {
  return encodeURIComponent(v).replace(/%2C/gi, ",").replace(/%24/g, "$").replace(/%3D/g, "=").replace(/%3B/g, ";");
}
function buildQueryString(params) {
  const parts = [];
  for (const [k, v] of params) {
    if (v === "" || v === void 0 || v === null) continue;
    parts.push(`${k}=${odataEncode(v)}`);
  }
  return parts.join("&");
}

// src/batch.ts
function utf8ByteLength(str) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str).byteLength;
  }
  return Buffer.byteLength(str, "utf8");
}
function generateBoundary(prefix) {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${uuid}`;
}
function buildEntitySetPath(baseUrl, entitySet, query) {
  const parts = [];
  if (query?.$top !== void 0) parts.push(`$top=${odataEncode(String(query.$top))}`);
  if (query?.$skip !== void 0) parts.push(`$skip=${odataEncode(String(query.$skip))}`);
  if (query?.$filter) parts.push(`$filter=${odataEncode(query.$filter)}`);
  if (query?.$select) parts.push(`$select=${odataEncode(query.$select)}`);
  const qs = parts.join("&");
  const encodedSet = encodePathSegment(entitySet);
  return qs ? `${baseUrl}/${encodedSet}?${qs}` : `${baseUrl}/${encodedSet}`;
}
function buildEntityPath(baseUrl, entitySet, key) {
  const encodedSet = encodePathSegment(entitySet);
  let keySegment;
  if (typeof key === "number") {
    keySegment = String(key);
  } else if (typeof key === "string") {
    keySegment = `'${key.replace(/'/g, "''")}'`;
  } else if (typeof key === "boolean") {
    keySegment = key ? "true" : "false";
  } else {
    throw new TypeError("Batch: unsupported key type");
  }
  return `${baseUrl}/${encodedSet}(${keySegment})`;
}
var Changeset = class {
  constructor(baseUrl) {
    this._ops = [];
    this._handles = [];
    this._baseUrl = baseUrl;
  }
  /** @internal */
  get _operations() {
    return this._ops;
  }
  /** @internal */
  get _handleSlots() {
    return this._handles;
  }
  /**
   * Create a new entity within this changeset.
   */
  create(entitySet, body) {
    const path = buildEntitySetPath(this._baseUrl, entitySet);
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const index = this._handles.length;
    this._handles.push({ resolve, reject });
    this._ops.push({
      method: "POST",
      path,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return { __brand: "BatchHandle", _promise: promise, _index: index };
  }
  /**
   * Patch an existing entity within this changeset.
   */
  patch(entitySet, key, body, opts) {
    const path = buildEntityPath(this._baseUrl, entitySet, key);
    const headers = { "Content-Type": "application/json" };
    if (opts?.ifMatch) headers["If-Match"] = opts.ifMatch;
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const index = this._handles.length;
    this._handles.push({ resolve, reject });
    this._ops.push({
      method: "PATCH",
      path,
      headers,
      body: JSON.stringify(body)
    });
    return { __brand: "BatchHandle", _promise: promise, _index: index };
  }
  /**
   * Delete an entity within this changeset.
   */
  delete(entitySet, key, opts) {
    const path = buildEntityPath(this._baseUrl, entitySet, key);
    const headers = {};
    if (opts?.ifMatch) headers["If-Match"] = opts.ifMatch;
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const index = this._handles.length;
    this._handles.push({ resolve, reject });
    this._ops.push({ method: "DELETE", path, headers });
    return { __brand: "BatchHandle", _promise: promise, _index: index };
  }
};
var Batch = class {
  constructor(client) {
    this._parts = [];
    this._changesets = [];
    this._client = client;
  }
  /**
   * Add a read operation (GET) to the batch.
   * Read operations are not part of a changeset and execute independently.
   */
  add(op) {
    const path = buildEntitySetPath(this._client.baseUrl, op.entitySet, op.query);
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const handle = { __brand: "BatchHandle", _promise: promise, _index: this._parts.length };
    this._parts.push({
      type: "read",
      content: { method: "GET", path },
      handle
    });
    return handle;
  }
  /**
   * Create an atomic changeset (group of write operations).
   * All operations in a changeset succeed or fail together.
   */
  changeset(build) {
    const cs = new Changeset(this._client.baseUrl);
    build(cs);
    this._changesets.push(cs);
    this._parts.push({ type: "changeset", content: cs });
  }
  /**
   * Serialize the batch into a multipart/mixed body.
   * @internal
   */
  _serialize() {
    const batchBoundary = generateBoundary("batch");
    const lines = [];
    for (const part of this._parts) {
      lines.push(`--${batchBoundary}`);
      if (part.type === "read") {
        const op = part.content;
        lines.push("Content-Type: application/http");
        lines.push("Content-Transfer-Encoding: binary");
        lines.push("");
        lines.push(`${op.method} ${op.path} HTTP/1.1`);
      } else if (part.type === "changeset") {
        const cs = part.content;
        const csBoundary = generateBoundary("changeset");
        lines.push("Content-Type: multipart/mixed; boundary=" + csBoundary);
        lines.push("");
        for (const op of cs._operations) {
          lines.push(`--${csBoundary}`);
          lines.push("Content-Type: application/http");
          lines.push("Content-Transfer-Encoding: binary");
          lines.push("");
          lines.push(`${op.method} ${op.path} HTTP/1.1`);
          if (op.headers) {
            for (const [k, v] of Object.entries(op.headers)) {
              lines.push(`${k}: ${v}`);
            }
          }
          if (op.body) {
            lines.push(`Content-Length: ${utf8ByteLength(op.body)}`);
            lines.push("");
            lines.push(op.body);
          }
        }
        lines.push(`--${csBoundary}--`);
      }
    }
    lines.push(`--${batchBoundary}--`);
    return { boundary: batchBoundary, body: lines.join("\r\n") };
  }
  /**
   * Send the batch request and parse the multipart response.
   */
  async send(opts = {}) {
    const { boundary, body } = this._serialize();
    const res = await executeRequest(
      this._client._ctx,
      `${this._client.baseUrl}/$batch`,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/mixed; boundary=${boundary}`
        },
        body,
        accept: "none",
        ...opts.signal ? { signal: opts.signal } : {}
      }
    );
    const responseText = await res.text();
    return this._parseResponse(responseText, res.headers.get("content-type") ?? "");
  }
  /**
   * Parse a multipart/mixed batch response.
   * @internal
   */
  _parseResponse(responseText, contentType) {
    const boundaryMatch = contentType.match(/boundary=([^;\s]+)/);
    const boundary = boundaryMatch?.[1];
    if (!boundary) {
      throw new Error("Batch response missing boundary in Content-Type");
    }
    const parts = responseText.split(`--${boundary}`);
    const results = [];
    let partIndex = 0;
    for (let i = 1; i < parts.length - 1; i++) {
      const part = parts[i].trim();
      if (!part || part === "--") continue;
      const batchPart = this._parts[partIndex];
      if (!batchPart) continue;
      if (batchPart.type === "read") {
        const result = this._parseHttpPart(part);
        results.push(result);
        if (batchPart.handle) {
          this._resolveHandle(batchPart.handle, result);
        }
        partIndex++;
      } else if (batchPart.type === "changeset") {
        const cs = batchPart.content;
        const csResults = this._parseChangesetResponse(part, cs);
        results.push(...csResults);
        const failed = csResults.find((r) => !r.ok);
        for (let j = 0; j < cs._handleSlots.length; j++) {
          const slot = cs._handleSlots[j];
          const csResult = csResults[j];
          if (failed) {
            slot.reject(new Error(`Changeset failed: ${failed.status}`));
          } else if (csResult) {
            slot.resolve(csResult.body);
          } else {
            slot.resolve(void 0);
          }
        }
        partIndex++;
      }
    }
    return {
      responses: results,
      ok: results.every((r) => r.ok)
    };
  }
  /** @internal — parse a single HTTP response part. */
  _parseHttpPart(part) {
    const outerEnd = part.indexOf("\r\n\r\n");
    const innerHttpText = outerEnd >= 0 ? part.slice(outerEnd + 4) : part;
    const innerHeadEnd = innerHttpText.indexOf("\r\n\r\n");
    const innerHead = innerHeadEnd >= 0 ? innerHttpText.slice(0, innerHeadEnd) : innerHttpText;
    const innerBody = innerHeadEnd >= 0 ? innerHttpText.slice(innerHeadEnd + 4).trim() : "";
    const statusMatch = innerHead.match(/^HTTP\/1\.\d (\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
    let parsedBody = void 0;
    if (innerBody && innerHead.toLowerCase().includes("application/json")) {
      try {
        parsedBody = JSON.parse(innerBody);
      } catch {
        parsedBody = innerBody;
      }
    } else if (innerBody) {
      parsedBody = innerBody;
    }
    return {
      status,
      body: parsedBody,
      headers: new Headers(),
      ok: status >= 200 && status < 300
    };
  }
  /** @internal — parse a changeset multipart response. */
  _parseChangesetResponse(part, cs) {
    const boundaryMatch = part.match(/boundary=([^\s]+)/);
    const csBoundary = boundaryMatch?.[1];
    if (!csBoundary) {
      return [this._parseHttpPart(part)];
    }
    const csParts = part.split(`--${csBoundary}`);
    const results = [];
    for (let i = 1; i < csParts.length - 1; i++) {
      const csPart = csParts[i].trim();
      if (!csPart || csPart === "--") continue;
      results.push(this._parseHttpPart(csPart));
    }
    return results;
  }
  /** @internal — resolve a batch handle with the result. */
  _resolveHandle(handle, result) {
  }
};

// src/metadata.ts
function parseBoolAttr(value, defaultValue) {
  if (value === void 0) return defaultValue;
  return value === "true";
}
function getAttr(text, name) {
  const re = new RegExp(`${name}="([^"]*)"`, "i");
  const m = text.match(re);
  return m?.[1];
}
function getAttrs(text) {
  const out = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}
function findElements(xml, tagName) {
  const results = [];
  const openRe = new RegExp(`<([\\w]+:)?${tagName}\\b[^>]*>`, "gi");
  let m;
  while ((m = openRe.exec(xml)) !== null) {
    const openTag = m[0];
    if (/\/>\s*$/.test(openTag)) {
      results.push(openTag);
      continue;
    }
    const startIdx = m.index;
    const closeRe = new RegExp(`</([\\w]+:)?${tagName}>`, "gi");
    closeRe.lastIndex = openRe.lastIndex;
    const closeM = closeRe.exec(xml);
    if (closeM) {
      results.push(xml.slice(startIdx, closeM.index + closeM[0].length));
    }
  }
  return results;
}
function elementContent(xml, tagName) {
  const openRe = new RegExp(`<(?:[\\w]+:)?${tagName}\\b[^>]*>`, "i");
  const openM = openRe.exec(xml);
  if (!openM) return void 0;
  const startIdx = openM.index + openM[0].length;
  const closeRe = new RegExp(`</(?:[\\w]+:)?${tagName}>`, "i");
  closeRe.lastIndex = startIdx;
  const closeM = closeRe.exec(xml);
  if (!closeM) return void 0;
  return xml.slice(startIdx, closeM.index);
}
function parseProperty(xml) {
  const attrs = getAttrs(xml);
  const nullable = parseBoolAttr(attrs.Nullable, true);
  const out = {
    name: attrs.Name ?? "",
    type: attrs.Type ?? "",
    nullable
  };
  if (attrs.MaxLength !== void 0) {
    const n = parseInt(attrs.MaxLength, 10);
    if (!Number.isNaN(n)) out.maxLength = n;
  }
  return out;
}
function parseNavigationProperty(xml) {
  const attrs = getAttrs(xml);
  const type = attrs.Type ?? "";
  const collection = type.startsWith("Collection(");
  const target = collection ? type.slice(11, -1) : type;
  return {
    name: attrs.Name ?? "",
    target,
    collection
  };
}
function parseKey(xml) {
  const keys = [];
  const refs = findElements(xml, "PropertyRef");
  for (const ref of refs) {
    const name = getAttr(ref, "Name");
    if (name) keys.push(name);
  }
  return keys;
}
function parseEntityType(xml) {
  const name = getAttr(xml, "Name") ?? "";
  const keys = [];
  const properties = [];
  const navigationProperties = [];
  const inner = elementContent(xml, "EntityType") ?? xml;
  const keyEl = findElements(inner, "Key")[0];
  if (keyEl) {
    keys.push(...parseKey(keyEl));
  }
  for (const prop of findElements(inner, "Property")) {
    properties.push(parseProperty(prop));
  }
  for (const nav of findElements(inner, "NavigationProperty")) {
    navigationProperties.push(parseNavigationProperty(nav));
  }
  return { name, keys, properties, navigationProperties };
}
function parseEntitySet(xml) {
  const attrs = getAttrs(xml);
  return {
    name: attrs.Name ?? "",
    entityType: attrs.EntityType ?? ""
  };
}
function extractProductVersion(xml) {
  const attrMatch = xml.match(
    /<Annotation\s+Term="Org\.OData\.Core\.V1\.ProductVersion"\s+String="([^"]+)"/i
  );
  if (attrMatch?.[1]) return attrMatch[1];
  const childMatch = xml.match(
    /<Annotation\s+Term="Org\.OData\.Core\.V1\.ProductVersion"[^>]*>\s*<String>([^<]+)<\/String>/i
  );
  if (childMatch?.[1]) return childMatch[1].trim();
  return void 0;
}
function parseAction(xml) {
  const name = getAttr(xml, "Name") ?? "";
  const attrs = getAttrs(xml);
  const boundTo = attrs["IsBound"] === "true" ? attrs["EntityType"] : void 0;
  const parameters = [];
  const inner = elementContent(xml, "Action") ?? xml;
  for (const p of findElements(inner, "Parameter")) {
    const pAttrs = getAttrs(p);
    parameters.push({
      name: pAttrs.Name ?? "",
      type: pAttrs.Type ?? ""
    });
  }
  return boundTo !== void 0 ? { name, boundTo, parameters } : { name, parameters };
}
function parseMetadata(xml) {
  try {
    const dataServices = elementContent(xml, "DataServices");
    if (!dataServices) {
      throw new Error("Missing <edmx:DataServices> in metadata");
    }
    const schema = findElements(dataServices, "Schema")[0];
    if (!schema) {
      throw new Error("Missing <Schema> in metadata");
    }
    const namespace = getAttr(schema, "Namespace") ?? "";
    const schemaInner = elementContent(schema, "Schema") ?? schema;
    const entityTypes = [];
    for (const et of findElements(schemaInner, "EntityType")) {
      entityTypes.push(parseEntityType(et));
    }
    const entitySets = [];
    const container = findElements(schemaInner, "EntityContainer")[0];
    if (container) {
      const containerInner = elementContent(container, "EntityContainer") ?? container;
      for (const es of findElements(containerInner, "EntitySet")) {
        entitySets.push(parseEntitySet(es));
      }
    }
    const actions = [];
    for (const a of findElements(schemaInner, "Action")) {
      actions.push(parseAction(a));
    }
    const productVersion = extractProductVersion(xml);
    const result = {
      namespace,
      entityTypes,
      entitySets,
      actions,
      raw: xml
    };
    if (productVersion !== void 0) result.productVersion = productVersion;
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FMODataError(`Failed to parse $metadata: ${message}`, {
      status: 0,
      odataError: xml.slice(0, 500)
    });
  }
}
async function fetchMetadataXml(ctx, baseUrl, opts = {}) {
  const res = await executeRequest(ctx, `${baseUrl}/$metadata`, {
    method: "GET",
    accept: "xml",
    ...opts.signal ? { signal: opts.signal } : {}
  });
  return res.text();
}
var MetadataFetcher = class {
  constructor(_ctx, _baseUrl) {
    this._ctx = _ctx;
    this._baseUrl = _baseUrl;
  }
  async fetchXml(opts = {}) {
    return fetchMetadataXml(this._ctx, this._baseUrl, opts);
  }
  async fetch(opts = {}) {
    if (!opts.refresh && this._cache) {
      return this._cache;
    }
    const promise = this.fetchXml(opts).then(parseMetadata);
    this._cache = promise;
    return promise;
  }
};

// src/containers.ts
var FM_CONTAINER_SUPPORTED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/tiff",
  "application/pdf"
];
function normalizeMime(value) {
  return (value.split(";")[0] ?? "").trim().toLowerCase();
}
function isSupportedContainerMime(value) {
  const normalized = normalizeMime(value);
  return FM_CONTAINER_SUPPORTED_MIME_TYPES.includes(normalized);
}
function sniffContainerMime(bytes) {
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return "image/jpeg";
  }
  if (bytes.length >= 4 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56) {
    return "image/gif";
  }
  if (bytes.length >= 4 && (bytes[0] === 73 && bytes[1] === 73 && bytes[2] === 42 && bytes[3] === 0 || bytes[0] === 77 && bytes[1] === 77 && bytes[2] === 0 && bytes[3] === 42)) {
    return "image/tiff";
  }
  if (bytes.length >= 4 && bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70) {
    return "application/pdf";
  }
  return void 0;
}
var ContainerRef = class {
  constructor(entity, fieldName) {
    if (!fieldName) {
      throw new TypeError("ContainerRef: fieldName is required");
    }
    this._entity = entity;
    this.fieldName = fieldName;
  }
  /**
   * Absolute URL of the container field itself
   * (`…/<EntitySet>(<key>)/<fieldName>`). This is the URL used by binary
   * `upload()`. Append `/$value` to download.
   */
  url() {
    return `${this._entity.toURL()}/${encodePathSegment(this.fieldName)}`;
  }
  /** @internal — `…/<field>/$value` for downloads. */
  _valueUrl() {
    return `${this.url()}/$value`;
  }
  /**
   * Download the container's contents and buffer them into a `Blob`. For
   * very large payloads prefer `getStream()` to avoid buffering in memory.
   */
  async get(opts = {}) {
    const res = await executeRequest(this._entity._client._ctx, this._valueUrl(), {
      method: "GET",
      // FMS quirk: `Accept: application/octet-stream` makes `$value` return the
      // stored filename string as `text/plain` instead of the binary. Use the
      // wildcard so FMS returns the actual bytes with a sniffed Content-Type.
      // See `docs/filemaker-quirks.md`.
      accept: "none",
      ...opts.signal ? { signal: opts.signal } : {}
    });
    const contentType = res.headers.get("content-type") ?? "";
    const disposition = res.headers.get("content-disposition");
    const filename = disposition ? parseContentDispositionFilename(disposition) : void 0;
    const blob = await res.blob();
    const out = {
      blob,
      contentType,
      size: blob.size
    };
    if (filename !== void 0) out.filename = filename;
    return out;
  }
  /**
   * Stream the container's contents without buffering. Useful for large files
   * (`pipeTo()` into a writable, forward to another `Response`, etc.).
   *
   * Throws if the underlying `Response` has no body.
   */
  async getStream(opts = {}) {
    const res = await executeRequest(this._entity._client._ctx, this._valueUrl(), {
      method: "GET",
      // See note in `get()` — Accept: */* avoids the FMS `octet-stream` quirk.
      accept: "none",
      ...opts.signal ? { signal: opts.signal } : {}
    });
    if (!res.body) {
      throw new TypeError("ContainerRef.getStream: response has no body");
    }
    return res.body;
  }
  /**
   * Upload binary contents to the container. Replaces any existing value.
   *
   * Default `encoding: 'binary'` PATCHes `…/<field>` with raw bytes and a
   * `Content-Type` header. Restricted to PNG / JPEG / GIF / TIFF / PDF.
   *
   * `encoding: 'base64'` PATCHes `…/<EntitySet>(<key>)` with a JSON body
   * containing base64 data plus `@com.filemaker.odata.…` annotations. Use
   * this when updating multiple container fields (or mixing container and
   * regular fields) in a single round-trip.
   *
   * `contentType` is optional — when omitted, the library sniffs the MIME
   * from the payload's magic bytes. Throws if no supported signature matches.
   */
  async upload(input, opts = {}) {
    const encoding = input.encoding ?? "binary";
    const bytes = await toUint8Array(input.data);
    let contentType = input.contentType;
    if (!contentType) {
      const sniffed = sniffContainerMime(bytes);
      if (!sniffed) {
        throw new TypeError(
          `ContainerRef.upload: contentType is required and could not be sniffed from the payload. Pass a contentType explicitly (one of ${FM_CONTAINER_SUPPORTED_MIME_TYPES.join(", ")}).`
        );
      }
      contentType = sniffed;
    }
    if (encoding === "binary") {
      if (!isSupportedContainerMime(contentType)) {
        throw new TypeError(
          `ContainerRef.upload (binary): contentType "${contentType}" is not a FileMaker-supported container type. Use one of ${FM_CONTAINER_SUPPORTED_MIME_TYPES.join(", ")}, or switch to { encoding: 'base64' }.`
        );
      }
      const headers = {
        "Content-Type": contentType
      };
      if (input.filename) {
        headers["Content-Disposition"] = formatContentDisposition(input.filename);
      }
      const body2 = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(body2).set(bytes);
      await executeRequest(this._entity._client._ctx, this.url(), {
        method: "PATCH",
        headers,
        body: body2,
        accept: "none",
        ...opts.signal ? { signal: opts.signal } : {}
      });
      return;
    }
    const body = buildContainerJsonBody({
      [this.fieldName]: {
        data: toBase64(bytes),
        contentType,
        ...input.filename ? { filename: input.filename } : {}
      }
    });
    await executeRequest(this._entity._client._ctx, this._entity.toURL(), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(body),
      accept: "none",
      ...opts.signal ? { signal: opts.signal } : {}
    });
  }
  /**
   * Clear the container value. FMS has no documented per-field DELETE for
   * record-level data, so the supported path is to PATCH the record with
   * `{ <fieldName>: null }`.
   */
  async delete(opts = {}) {
    const body = { [this.fieldName]: null };
    await executeRequest(this._entity._client._ctx, this._entity.toURL(), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(body),
      accept: "none",
      ...opts.signal ? { signal: opts.signal } : {}
    });
  }
};
function buildContainerJsonBody(containers, regularFields = {}) {
  const body = { ...regularFields };
  for (const [field, value] of Object.entries(containers)) {
    if (!value.contentType) {
      throw new TypeError(`buildContainerJsonBody: "${field}".contentType is required`);
    }
    body[field] = value.data;
    body[`${field}@com.filemaker.odata.ContentType`] = value.contentType;
    if (value.filename) {
      body[`${field}@com.filemaker.odata.Filename`] = value.filename;
    }
  }
  return body;
}
function parseContentDispositionFilename(value) {
  const ext = value.match(/filename\*\s*=\s*([^']+)'[^']*'([^;]+)/i);
  if (ext) {
    const charset = ext[1].trim().toLowerCase();
    const encoded = ext[2].trim();
    try {
      const decoded = decodeURIComponent(encoded);
      return charset === "utf-8" || charset === "utf8" ? decoded : decoded;
    } catch {
    }
  }
  const plain = value.match(/filename\s*=\s*("([^"\\]*(?:\\.[^"\\]*)*)"|([^;]+))/i);
  if (plain) {
    const quoted = plain[2];
    if (quoted !== void 0) return quoted.replace(/\\(.)/g, "$1").trim();
    const unquoted = plain[3];
    if (unquoted !== void 0) return unquoted.trim();
  }
  return void 0;
}
function formatContentDisposition(filename) {
  const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
  const needsRfc5987 = /[^\x00-\x7F]/.test(filename);
  let base;
  if (TOKEN_RE.test(filename)) {
    base = `inline; filename=${filename}`;
  } else {
    const safeAscii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, '\\"');
    base = `inline; filename="${safeAscii}"`;
  }
  if (!needsRfc5987) return base;
  return `${base}; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
async function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  const ab = await data.arrayBuffer();
  return new Uint8Array(ab);
}
function toBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    );
  }
  return btoa(bin);
}

// src/scripts.ts
function formatKey(key) {
  if (typeof key === "number") {
    if (!Number.isFinite(key)) {
      throw new TypeError("ScriptInvoker: key must be a finite number");
    }
    return String(key);
  }
  if (typeof key === "string") return `'${escapeStringLiteral(key)}'`;
  if (typeof key === "boolean") return key ? "true" : "false";
  throw new TypeError("ScriptInvoker: unsupported key type");
}
var ScriptInvoker = class {
  constructor(client, scope = {}) {
    this._client = client;
    if (scope.entitySet !== void 0) this.entitySet = scope.entitySet;
    if (scope.key !== void 0) this.key = scope.key;
  }
  /** Build the absolute URL for invoking `name` at this scope. */
  url(name) {
    if (!name) throw new TypeError("ScriptInvoker: script name is required");
    return this._urlForSegment(`Script.${encodePathSegment(name)}`);
  }
  /** Build the absolute URL for invoking by FMSID at this scope. */
  urlById(fmsid) {
    if (!Number.isFinite(fmsid)) throw new TypeError("ScriptInvoker: fmsid must be a finite number");
    return this._urlForSegment(`Script.FMSID:${fmsid}`);
  }
  /** @internal — build URL from a script path segment. */
  _urlForSegment(scriptSegment) {
    const base = this._client.baseUrl;
    if (this.entitySet === void 0) {
      return `${base}/${scriptSegment}`;
    }
    const setSegment = encodePathSegment(this.entitySet);
    if (this.key === void 0) {
      return `${base}/${setSegment}/${scriptSegment}`;
    }
    return `${base}/${setSegment}(${formatKey(this.key)})/${scriptSegment}`;
  }
  /** Invoke the script by name. Resolves to a `ScriptResult` on success. */
  async run(name, opts = {}) {
    return this._runAtUrl(this.url(name), opts);
  }
  /**
   * Invoke the script by its immutable FMSID.
   *
   * Requires FileMaker Server 2026+ (v26). Use `db.hasFeature('scriptsByFMSID')`
   * to check before calling.
   *
   * ```ts
   * const result = await db.scriptById(42, { parameter: 'hello' })
   * ```
   */
  async runById(fmsid, opts = {}) {
    return this._runAtUrl(this.urlById(fmsid), opts);
  }
  /** @internal — execute a script POST at the given URL. */
  async _runAtUrl(url, opts) {
    const headers = {};
    let body;
    if (opts.parameter !== void 0) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({ scriptParameter: opts.parameter });
    }
    const method = "POST";
    const json = await executeJson(this._client._ctx, url, {
      method,
      headers,
      ...body !== void 0 ? { body } : {},
      accept: "json",
      ...opts.signal ? { signal: opts.signal } : {}
    });
    return parseScriptEnvelope(json, { url, method });
  }
};
function parseScriptEnvelope(raw, request) {
  const envelope = extractEnvelope(raw);
  const scriptError = envelope.scriptError !== void 0 ? String(envelope.scriptError) : "0";
  const scriptResult = envelope.scriptResult !== void 0 ? String(envelope.scriptResult) : void 0;
  if (scriptError !== "0") {
    throw new FMScriptError(
      `FileMaker script error ${scriptError}`,
      {
        status: 200,
        scriptError,
        ...scriptResult !== void 0 ? { scriptResult } : {},
        odataError: raw,
        request
      }
    );
  }
  const out = { scriptError, raw };
  if (scriptResult !== void 0) out.scriptResult = scriptResult;
  return out;
}
function extractEnvelope(raw) {
  if (raw === null || typeof raw !== "object") return {};
  const obj = raw;
  if ("scriptError" in obj || "scriptResult" in obj) {
    return obj;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const inner = v;
      if ("scriptError" in inner || "scriptResult" in inner) {
        return inner;
      }
    }
  }
  return {};
}
function runScriptAtDatabase(client, name, opts) {
  return new ScriptInvoker(client).run(name, opts);
}
function runScriptByIdAtDatabase(client, fmsid, opts) {
  return new ScriptInvoker(client).runById(fmsid, opts);
}
function runScriptAtEntitySet(client, entitySet, name, opts) {
  return new ScriptInvoker(client, { entitySet }).run(name, opts);
}
function runScriptAtEntity(client, entitySet, key, name, opts) {
  return new ScriptInvoker(client, { entitySet, key }).run(name, opts);
}

// src/entity.ts
function formatKey2(key) {
  if (typeof key === "number") {
    if (!Number.isFinite(key)) {
      throw new TypeError("EntityRef: key must be a finite number");
    }
    return String(key);
  }
  if (typeof key === "string") return `'${escapeStringLiteral(key)}'`;
  if (typeof key === "boolean") return key ? "true" : "false";
  throw new TypeError("EntityRef: unsupported key type");
}
var EntityRef = class {
  constructor(client, entitySet, key) {
    this._client = client;
    this.entitySet = entitySet;
    this.key = key;
  }
  /** Absolute URL for this entity. */
  toURL() {
    return `${this._client.baseUrl}/${encodePathSegment(this.entitySet)}(${formatKey2(this.key)})`;
  }
  /** `GET` the entity. Returns the parsed JSON row. */
  async get(opts = {}) {
    const json = await executeJson(this._client._ctx, this.toURL(), {
      method: "GET",
      accept: "json",
      ...opts.signal ? { signal: opts.signal } : {}
    });
    return json;
  }
  /**
   * `GET` a single field's scalar value via the OData property URL
   * (`…/<EntitySet>(<key>)/<fieldName>`). FMS responds with the JSON envelope
   * `{ value: … }`; this method unwraps it and returns just the value.
   *
   * Useful when you only need one column without composing a `$select` query.
   * For container fields use `container(name).get()` instead.
   */
  async fieldValue(fieldName, opts = {}) {
    const url = `${this.toURL()}/${encodePathSegment(fieldName)}`;
    const json = await executeJson(this._client._ctx, url, {
      method: "GET",
      accept: "json",
      ...opts.signal ? { signal: opts.signal } : {}
    });
    return json.value;
  }
  /**
   * `PATCH` the entity with partial values. Returns the updated row when the
   * server echoes one (OData `Prefer: return=representation`), otherwise
   * `undefined` on `204 No Content`.
   */
  async patch(body, opts = {}) {
    const headers = {
      "Content-Type": "application/json",
      Prefer: opts.returnRepresentation ? "return=representation" : "return=minimal"
    };
    if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;
    const json = await executeJson(this._client._ctx, this.toURL(), {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
      accept: "json",
      ...opts.signal ? { signal: opts.signal } : {}
    });
    return json;
  }
  /** `DELETE` the entity. Resolves on success; throws `FMODataError` otherwise. */
  async delete(opts = {}) {
    const headers = {};
    if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;
    await executeRequest(this._client._ctx, this.toURL(), {
      method: "DELETE",
      headers,
      accept: "none",
      ...opts.signal ? { signal: opts.signal } : {}
    });
  }
  /**
   * Invoke a FileMaker script in the context of this single record. FMS sets
   * the script's current record to this entity before running it.
   */
  async script(name, opts = {}) {
    return runScriptAtEntity(this._client, this.entitySet, this.key, name, opts);
  }
  /**
   * Get a typed handle to one of this record's container fields, exposing
   * `.get()`, `.getStream()`, `.upload(...)`, and `.delete()`.
   */
  container(fieldName) {
    return new ContainerRef(this, fieldName);
  }
  /**
   * Update one or more container fields (and optionally regular fields) on
   * this record in a single base64 PATCH request. This maps to the Claris
   * "Operation 3" (`PATCH /<EntitySet>(<key>)` with JSON body containing
   * `<field>`, `<field>@com.filemaker.odata.ContentType`, and
   * `<field>@com.filemaker.odata.Filename`).
   *
   * Each container value's `data` must already be base64-encoded (use the
   * library's exported `toBase64()` helper or `Buffer.from(bytes).toString('base64')`).
   *
   * @example
   * await db.from('contact').byKey(7).patchContainers(
   *   {
   *     photo:    { data: photoB64,    contentType: 'image/png',       filename: 'p.png' },
   *     contract: { data: contractB64, contentType: 'application/pdf', filename: 'c.pdf' },
   *   },
   *   { website: 'https://example.com' },
   * )
   */
  async patchContainers(containers, regularFields = {}, opts = {}) {
    const headers = {
      "Content-Type": "application/json",
      Prefer: opts.returnRepresentation ? "return=representation" : "return=minimal"
    };
    if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;
    const body = buildContainerJsonBody(containers, regularFields);
    await executeRequest(this._client._ctx, this.toURL(), {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
      accept: "none",
      ...opts.signal ? { signal: opts.signal } : {}
    });
  }
  // -------------------------------------------------------------------------
  // Record references ($ref) — OData standard, supported since FMS 19
  // -------------------------------------------------------------------------
  /**
   * Get the references for a navigation property on this record.
   *
   * `GET /<EntitySet>(<key>)/<navProperty>/$ref`
   *
   * Returns an array of entity references. For a single-valued navigation
   * property, the array has at most one element.
   *
   * @example
   * ```ts
   * const refs = await db.from('contact').byKey(7).getRefs('addresses')
   * // [{ '@odata.id': 'https://fms.example.com/fmi/odata/v4/DB/address(1)' }, ...]
   * ```
   */
  async getRefs(navProperty, opts = {}) {
    const url = `${this.toURL()}/${encodePathSegment(navProperty)}/$ref`;
    const json = await executeJson(
      this._client._ctx,
      url,
      {
        method: "GET",
        accept: "json",
        ...opts.signal ? { signal: opts.signal } : {}
      }
    );
    if (json?.value) return json.value;
    if (json?.["@odata.id"]) return [json];
    return [];
  }
  /**
   * Add a reference to a related record via a navigation property.
   *
   * `POST /<EntitySet>(<key>)/<navProperty>/$ref`
   *
   * For single-valued navigation properties, use `setRef()` instead (PATCH).
   *
   * @example
   * ```ts
   * await db.from('contact').byKey(7).addRef('addresses', 42)
   * ```
   */
  async addRef(navProperty, relatedKey, opts = {}) {
    const url = `${this.toURL()}/${encodePathSegment(navProperty)}/$ref`;
    const headers = { "Content-Type": "application/json" };
    if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;
    const body = JSON.stringify({ "@odata.id": this._refId(navProperty, relatedKey) });
    await executeRequest(this._client._ctx, url, {
      method: "POST",
      headers,
      body,
      accept: "none",
      ...opts.signal ? { signal: opts.signal } : {}
    });
  }
  /**
   * Set (replace) the reference for a single-valued navigation property.
   *
   * `PATCH /<EntitySet>(<key>)/<navProperty>/$ref`
   *
   * @example
   * ```ts
   * await db.from('order').byKey(100).setRef('customer', 7)
   * ```
   */
  async setRef(navProperty, relatedKey, opts = {}) {
    const url = `${this.toURL()}/${encodePathSegment(navProperty)}/$ref`;
    const headers = { "Content-Type": "application/json" };
    if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;
    const body = JSON.stringify({ "@odata.id": this._refId(navProperty, relatedKey) });
    await executeRequest(this._client._ctx, url, {
      method: "PATCH",
      headers,
      body,
      accept: "none",
      ...opts.signal ? { signal: opts.signal } : {}
    });
  }
  /**
   * Remove a reference from a navigation property.
   *
   * `DELETE /<EntitySet>(<key>)/<navProperty>/$ref`
   *
   * For collection-valued navigation properties, pass the `relatedKey` to
   * remove a specific reference. For single-valued, omit `relatedKey` to
   * clear the reference.
   *
   * @example
   * ```ts
   * await db.from('contact').byKey(7).removeRef('addresses', 42)
   * await db.from('order').byKey(100).removeRef('customer')
   * ```
   */
  async removeRef(navProperty, relatedKey, opts = {}) {
    let url = `${this.toURL()}/${encodePathSegment(navProperty)}/$ref`;
    const headers = {};
    if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;
    if (relatedKey !== void 0) {
      url += `('${escapeStringLiteral(this._refId(navProperty, relatedKey))}')`;
    }
    await executeRequest(this._client._ctx, url, {
      method: "DELETE",
      headers,
      accept: "none",
      ...opts.signal ? { signal: opts.signal } : {}
    });
  }
  /** @internal — build a relative @odata.id for a related entity. */
  _refId(navProperty, relatedKey) {
    const navSet = navProperty;
    if (typeof relatedKey === "number") return `${navSet}(${relatedKey})`;
    return `${navSet}('${escapeStringLiteral(relatedKey)}')`;
  }
};

// src/query.ts
var Filter = class _Filter {
  constructor(expr) {
    this.expr = expr;
  }
  toString() {
    return this.expr;
  }
  and(other) {
    return new _Filter(`(${this.expr}) and (${_Filter.coerce(other)})`);
  }
  or(other) {
    return new _Filter(`(${this.expr}) or (${_Filter.coerce(other)})`);
  }
  not() {
    return new _Filter(`not (${this.expr})`);
  }
  /** @internal */
  static coerce(x) {
    return x instanceof _Filter ? x.expr : x;
  }
};
var filterFactory = {
  eq: (f, v) => new Filter(`${f} eq ${formatLiteral(v)}`),
  ne: (f, v) => new Filter(`${f} ne ${formatLiteral(v)}`),
  gt: (f, v) => new Filter(`${f} gt ${formatLiteral(v)}`),
  ge: (f, v) => new Filter(`${f} ge ${formatLiteral(v)}`),
  lt: (f, v) => new Filter(`${f} lt ${formatLiteral(v)}`),
  le: (f, v) => new Filter(`${f} le ${formatLiteral(v)}`),
  startswith: (f, v) => new Filter(`startswith(${f},${formatLiteral(v)})`),
  endswith: (f, v) => new Filter(`endswith(${f},${formatLiteral(v)})`),
  contains: (f, v) => new Filter(`contains(${f},${formatLiteral(v)})`),
  and: (a, b) => new Filter(`(${Filter.coerce(a)}) and (${Filter.coerce(b)})`),
  or: (a, b) => new Filter(`(${Filter.coerce(a)}) or (${Filter.coerce(b)})`),
  not: (a) => new Filter(`not (${Filter.coerce(a)})`),
  raw: (s) => new Filter(s)
};
function resolveFilter(input) {
  if (typeof input === "function") return Filter.coerce(input(filterFactory));
  return Filter.coerce(input);
}
var Query = class _Query {
  constructor(baseUrl, entitySet, client) {
    /** @internal */
    this._state = {};
    this._baseUrl = baseUrl;
    this._entitySet = entitySet;
    if (client) this._client = client;
  }
  select(...fields) {
    this._state.select = [...this._state.select ?? [], ...fields];
    return this;
  }
  filter(input) {
    const expr = resolveFilter(input);
    this._state.filter = this._state.filter ? `(${this._state.filter}) and (${expr})` : expr;
    return this;
  }
  or(input) {
    const expr = resolveFilter(input);
    this._state.filter = this._state.filter ? `(${this._state.filter}) or (${expr})` : expr;
    return this;
  }
  expand(name, build) {
    const entry = { name };
    if (build) {
      const nested = new _Query("", name);
      build(nested);
      entry.options = nested._state;
    }
    this._state.expand = [...this._state.expand ?? [], entry];
    return this;
  }
  orderby(field, dir = "asc") {
    this._state.orderby = [...this._state.orderby ?? [], { field, dir }];
    return this;
  }
  top(n) {
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError(`Query#top: expected non-negative integer, got ${n}`);
    }
    this._state.top = n;
    return this;
  }
  skip(n) {
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError(`Query#skip: expected non-negative integer, got ${n}`);
    }
    this._state.skip = n;
    return this;
  }
  count(enabled = true) {
    this._state.count = enabled;
    return this;
  }
  search(term) {
    this._state.search = term;
    return this;
  }
  // -------------------------------------------------------------------------
  // $apply (aggregation) — requires FMS 22.0.1+ (FileMaker 2024)
  // -------------------------------------------------------------------------
  /**
   * Set a raw `$apply` expression. Use this for advanced transformations
   * that the `aggregate()` / `groupBy()` helpers don't cover.
   *
   * Requires FileMaker Server 2024+ (v22). Use `db.hasFeature('applyAggregation')`
   * to check before calling.
   *
   * @example
   * ```ts
   * const result = await db.from('orders').apply('aggregate(total with sum as totalSum)')
   *   .get()
   * ```
   */
  apply(expr) {
    this._state.apply = expr;
    return this;
  }
  /**
   * Aggregate the entity set. Produces a `$apply=aggregate(...)` expression.
   *
   * Requires FileMaker Server 2024+ (v22).
   *
   * @example
   * ```ts
   * const result = await db.from('orders')
   *   .aggregate([{ field: 'total', function: 'sum', alias: 'totalSum' }])
   *   .get()
   * // $apply=aggregate(total with sum as totalSum)
   * ```
   */
  aggregate(expressions) {
    const parts = expressions.map((e) => `${e.field} with ${e.function} as ${e.alias}`);
    this._state.apply = `aggregate(${parts.join(",")})`;
    return this;
  }
  /**
   * Group the entity set by one or more fields, optionally with aggregation.
   * Produces a `$apply=groupby((fields), aggregate(...))` expression.
   *
   * Requires FileMaker Server 2024+ (v22).
   *
   * @example
   * ```ts
   * const result = await db.from('orders')
   *   .groupBy(
   *     ['customerId'],
   *     [{ field: 'total', function: 'sum', alias: 'totalSum' }],
   *   )
   *   .get()
   * // $apply=groupby((customerId),aggregate(total with sum as totalSum))
   * ```
   */
  groupBy(fields, aggregateExpressions) {
    const fieldList = fields.join(",");
    if (aggregateExpressions && aggregateExpressions.length > 0) {
      const aggParts = aggregateExpressions.map((e) => `${e.field} with ${e.function} as ${e.alias}`);
      this._state.apply = `groupby((${fieldList}),aggregate(${aggParts.join(",")}))`;
    } else {
      this._state.apply = `groupby((${fieldList}))`;
    }
    return this;
  }
  /** Build the absolute request URL for this query. */
  toURL() {
    const qs = serializeOptions(this._state, { topLevel: true });
    const base = `${this._baseUrl}/${encodePathSegment(this._entitySet)}`;
    return qs ? `${base}?${qs}` : base;
  }
  /**
   * Get a handle to a single entity by its primary key. Subsequent operations
   * (`.get()`, `.patch()`, `.delete()`) hit `/<EntitySet>(<key>)`.
   */
  byKey(key) {
    if (!this._client) {
      throw new Error("Query#byKey: no client attached (use FMOData#from)");
    }
    return new EntityRef(this._client, this._entitySet, key);
  }
  /**
   * `POST` a new entity to the collection. Returns the created row (FMS echoes
   * it by default).
   */
  async create(body, opts = {}) {
    if (!this._client) {
      throw new Error("Query#create: no client attached (use FMOData#from)");
    }
    const url = `${this._baseUrl}/${encodePathSegment(this._entitySet)}`;
    const json = await executeJson(this._client._ctx, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      accept: "json",
      ...opts.signal ? { signal: opts.signal } : {}
    });
    return json;
  }
  /**
   * `POST` a new entity carrying one or more container fields. Maps to the
   * Claris "Operation 1" — the request body is a JSON object containing
   * regular field values plus, for each container field, the base64 data
   * and the `@com.filemaker.odata.{ContentType,Filename}` annotations.
   *
   * Each container value's `data` must already be base64-encoded.
   *
   * @example
   * await db.from('contact').createWithContainers(
   *   { first_name: 'Bob', last_name: 'Jones' },
   *   { photo: { data: photoB64, contentType: 'image/png', filename: 'BJONES.png' } },
   * )
   */
  async createWithContainers(regularFields, containers, opts = {}) {
    if (!this._client) {
      throw new Error("Query#createWithContainers: no client attached (use FMOData#from)");
    }
    const url = `${this._baseUrl}/${encodePathSegment(this._entitySet)}`;
    const body = buildContainerJsonBody(
      containers,
      regularFields
    );
    const json = await executeJson(this._client._ctx, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      accept: "json",
      ...opts.signal ? { signal: opts.signal } : {}
    });
    return json;
  }
  /**
   * Execute the query. Returns the parsed OData collection envelope.
   */
  async get(opts = {}) {
    if (!this._client) {
      throw new Error("Query#get: no client attached (use FMOData#from)");
    }
    const json = await executeJson(this._client._ctx, this.toURL(), {
      method: "GET",
      accept: "json",
      ...opts.signal ? { signal: opts.signal } : {}
    });
    const out = { value: json?.value ?? [] };
    if (json && typeof json["@odata.count"] === "number") out.count = json["@odata.count"];
    if (json && typeof json["@odata.nextLink"] === "string") out.nextLink = json["@odata.nextLink"];
    return out;
  }
  /**
   * Invoke a FileMaker script in the context of this query's entity set.
   *
   * Filter / select / orderby / paging state on the `Query` is **ignored** —
   * the underlying OData Action only cares about the entity set. Use
   * `EntityRef#script` to run a script in the context of a specific record.
   */
  async script(name, opts = {}) {
    if (!this._client) {
      throw new Error("Query#script: no client attached (use FMOData#from)");
    }
    return runScriptAtEntitySet(this._client, this._entitySet, name, opts);
  }
};
function serializeOptions(s, opts) {
  const pairs = [];
  if (s.select && s.select.length > 0) {
    pairs.push(["$select", s.select.join(",")]);
  }
  if (s.filter) {
    pairs.push(["$filter", s.filter]);
  }
  if (s.expand && s.expand.length > 0) {
    const parts = s.expand.map((e) => {
      if (!e.options) return e.name;
      const inner = serializeOptions(e.options, { topLevel: false });
      return inner ? `${e.name}(${inner})` : e.name;
    });
    pairs.push(["$expand", parts.join(",")]);
  }
  if (s.orderby && s.orderby.length > 0) {
    pairs.push([
      "$orderby",
      s.orderby.map((o) => `${o.field} ${o.dir}`).join(",")
    ]);
  }
  if (s.top !== void 0) pairs.push(["$top", String(s.top)]);
  if (s.skip !== void 0) pairs.push(["$skip", String(s.skip)]);
  if (s.count) pairs.push(["$count", "true"]);
  if (s.search) pairs.push(["$search", s.search]);
  if (s.apply) pairs.push(["$apply", s.apply]);
  if (opts.topLevel) return buildQueryString(pairs);
  return pairs.map(([k, v]) => `${k}=${v}`).join(";");
}

// node_modules/@fm-odata/spec-ts/dist/versions.js
var FM_VERSION_NAMES = {
  "19": "FileMaker 19.x",
  "21": "Claris FileMaker 2023",
  "22": "Claris FileMaker 2024",
  "26": "Claris FileMaker 2026",
  future: "Future / next"
};
var ODATA_PROTOCOL_VERSION = "4.0";
var FM_VERSION_MATRIX = {
  "19": {
    major: "19",
    name: "FileMaker 19.x",
    releaseYear: null,
    internalVersion: "19.x",
    status: "baseline",
    features: {
      serviceDocument: true,
      metadata: true,
      databaseListing: true,
      tableListing: true,
      recordCRUD: true,
      recordReferences: true,
      crossJoin: true,
      batch: true,
      scripts: true,
      scriptsByFMSID: false,
      scriptListing: false,
      containerBinaryUpload: true,
      containerBase64Upload: true,
      containerDownload: true,
      schemaModification: true,
      webhooks: false,
      webhookQueryHeaders: false,
      applyAggregation: false,
      typeCasting: false,
      parameterizedFilters: false,
      immutableIdUrls: false,
      aiAnnotation: false,
      serverVersionAnnotation: false,
      enrichedFMComment: false,
      authBasic: true,
      authFMID: false,
      authOAuth: false
    },
    queryOptions: {
      $filter: true,
      $select: true,
      $orderby: true,
      $top: true,
      $skip: true,
      $expand: true,
      $count: true,
      $apply: false,
      $search: false,
      $compute: false
    }
  },
  "21": {
    major: "21",
    name: "Claris FileMaker 2023",
    releaseYear: 2023,
    internalVersion: "21.x",
    status: "supported",
    features: {
      serviceDocument: true,
      metadata: true,
      databaseListing: true,
      tableListing: true,
      recordCRUD: true,
      recordReferences: true,
      crossJoin: true,
      batch: true,
      scripts: true,
      scriptsByFMSID: false,
      scriptListing: false,
      containerBinaryUpload: true,
      containerBase64Upload: true,
      containerDownload: true,
      schemaModification: true,
      webhooks: true,
      webhookQueryHeaders: false,
      applyAggregation: false,
      typeCasting: true,
      parameterizedFilters: true,
      immutableIdUrls: false,
      aiAnnotation: false,
      serverVersionAnnotation: false,
      enrichedFMComment: false,
      authBasic: true,
      authFMID: true,
      authOAuth: true
    },
    queryOptions: {
      $filter: true,
      $select: true,
      $orderby: true,
      $top: true,
      $skip: true,
      $expand: true,
      $count: true,
      $apply: false,
      $search: false,
      $compute: false
    }
  },
  "22": {
    major: "22",
    name: "Claris FileMaker 2024",
    releaseYear: 2024,
    internalVersion: "22.x",
    status: "supported",
    features: {
      serviceDocument: true,
      metadata: true,
      databaseListing: true,
      tableListing: true,
      recordCRUD: true,
      recordReferences: true,
      crossJoin: true,
      batch: true,
      scripts: true,
      scriptsByFMSID: false,
      scriptListing: false,
      containerBinaryUpload: true,
      containerBase64Upload: true,
      containerDownload: true,
      schemaModification: true,
      webhooks: true,
      webhookQueryHeaders: true,
      applyAggregation: true,
      typeCasting: true,
      parameterizedFilters: true,
      immutableIdUrls: false,
      aiAnnotation: false,
      serverVersionAnnotation: false,
      enrichedFMComment: false,
      authBasic: true,
      authFMID: true,
      authOAuth: true
    },
    queryOptions: {
      $filter: true,
      $select: true,
      $orderby: true,
      $top: true,
      $skip: true,
      $expand: true,
      $count: true,
      $apply: true,
      $search: false,
      $compute: false
    }
  },
  "26": {
    major: "26",
    name: "Claris FileMaker 2026",
    releaseYear: 2026,
    internalVersion: "26.x",
    status: "current",
    features: {
      serviceDocument: true,
      metadata: true,
      databaseListing: true,
      tableListing: true,
      recordCRUD: true,
      recordReferences: true,
      crossJoin: true,
      batch: true,
      scripts: true,
      scriptsByFMSID: true,
      scriptListing: true,
      containerBinaryUpload: true,
      containerBase64Upload: true,
      containerDownload: true,
      schemaModification: true,
      webhooks: true,
      webhookQueryHeaders: true,
      applyAggregation: true,
      typeCasting: true,
      parameterizedFilters: true,
      immutableIdUrls: true,
      aiAnnotation: true,
      serverVersionAnnotation: true,
      enrichedFMComment: true,
      authBasic: true,
      authFMID: true,
      authOAuth: true
    },
    queryOptions: {
      $filter: true,
      $select: true,
      $orderby: true,
      $top: true,
      $skip: true,
      $expand: true,
      $count: true,
      $apply: true,
      $search: false,
      $compute: false
    }
  },
  future: {
    major: "future",
    name: "Future / next",
    releaseYear: null,
    internalVersion: "unknown",
    status: "future",
    features: {
      serviceDocument: true,
      metadata: true,
      databaseListing: true,
      tableListing: true,
      recordCRUD: true,
      recordReferences: true,
      crossJoin: true,
      batch: true,
      scripts: true,
      scriptsByFMSID: true,
      scriptListing: true,
      containerBinaryUpload: true,
      containerBase64Upload: true,
      containerDownload: true,
      schemaModification: true,
      webhooks: true,
      webhookQueryHeaders: true,
      applyAggregation: true,
      typeCasting: true,
      parameterizedFilters: true,
      immutableIdUrls: true,
      aiAnnotation: true,
      serverVersionAnnotation: true,
      enrichedFMComment: true,
      authBasic: true,
      authFMID: true,
      authOAuth: true
    },
    queryOptions: {
      $filter: true,
      $select: true,
      $orderby: true,
      $top: true,
      $skip: true,
      $expand: true,
      $count: true,
      $apply: true,
      $search: false,
      $compute: false
    }
  }
};
function hasFeature(version, feature) {
  return FM_VERSION_MATRIX[version]?.features[feature] ?? false;
}
function hasQueryOption(version, option) {
  return FM_VERSION_MATRIX[version]?.queryOptions[option] ?? false;
}
function minVersionForFeature(feature) {
  const order = ["19", "21", "22", "26"];
  for (const v of order) {
    if (FM_VERSION_MATRIX[v].features[feature])
      return v;
  }
  return null;
}

// src/client.ts
var FMOData = class {
  constructor(options) {
    if (!options.host) throw new TypeError("FMOData: `host` is required");
    if (!options.database) throw new TypeError("FMOData: `database` is required");
    if (options.token === void 0 || options.token === null) {
      throw new TypeError("FMOData: `token` is required");
    }
    this.host = options.host.replace(/\/+$/, "");
    this.database = options.database;
    this.baseUrl = `${this.host}/fmi/odata/v4/${encodeURIComponent(this.database)}`;
    this.timeoutMs = options.timeoutMs;
    this._ctx = {
      token: options.token,
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
      timeoutMs: options.timeoutMs,
      ...options.onUnauthorized ? { onUnauthorized: options.onUnauthorized } : {}
    };
  }
  /**
   * Start a query against the given entity set (FileMaker layout name).
   */
  from(entitySet) {
    if (!entitySet) throw new TypeError("FMOData#from: entitySet is required");
    return new Query(this.baseUrl, entitySet, this);
  }
  /**
   * Low-level escape hatch: execute a raw request against a path relative to
   * the database base URL (or an absolute URL). Returns the parsed JSON body.
   *
   * @example
   * ```ts
   * const body = await db.request<{ value: unknown[] }>('/contact?$top=1')
   * ```
   */
  async request(pathOrUrl, opts = {}) {
    return executeJson(this._ctx, this._resolveUrl(pathOrUrl), opts);
  }
  /**
   * Low-level escape hatch: execute a raw request and return the `Response`
   * object directly (useful for binary / streaming responses).
   */
  async rawRequest(pathOrUrl, opts = {}) {
    return executeRequest(this._ctx, this._resolveUrl(pathOrUrl), opts);
  }
  /**
   * Invoke a FileMaker script at database scope.
   *
   * ```ts
   * const result = await db.script('Ping', { parameter: 'hello' })
   * console.log(result.scriptResult) // => string value returned by the script
   * ```
   *
   * A non-zero `scriptError` is thrown as `FMScriptError`.
   */
  async script(name, opts = {}) {
    return runScriptAtDatabase(this, name, opts);
  }
  /**
   * Invoke a FileMaker script by its immutable FMSID.
   *
   * Requires FileMaker Server 2026+ (v26). Use `hasFeature('scriptsByFMSID')`
   * to check before calling. FMSID-based invocation is more stable than
   * name-based: it survives script renames and works across database
   * migrations.
   *
   * ```ts
   * const result = await db.scriptById(42, { parameter: 'hello' })
   * ```
   */
  async scriptById(fmsid, opts = {}) {
    return runScriptByIdAtDatabase(this, fmsid, opts);
  }
  /**
   * Fetch the OData CSDL `$metadata` XML and parse it into a typed structure.
   * Results are cached; pass `refresh: true` to force a refetch.
   *
   * ```ts
   * const meta = await db.metadata()
   * console.log(meta.entitySets.map(es => es.name))
   * ```
   */
  async metadata(opts = {}) {
    if (!this._metadataFetcher) {
      this._metadataFetcher = new MetadataFetcher(this._ctx, this.baseUrl);
    }
    return this._metadataFetcher.fetch(opts);
  }
  /**
   * Fetch the raw `$metadata` XML (escape hatch for debugging or custom parsing).
   */
  async metadataXml(opts = {}) {
    if (!this._metadataFetcher) {
      this._metadataFetcher = new MetadataFetcher(this._ctx, this.baseUrl);
    }
    return this._metadataFetcher.fetchXml(opts);
  }
  /**
   * Detect the FileMaker Server major version by fetching `$metadata` and
   * extracting the `Org.OData.Core.V1.ProductVersion` annotation. The result
   * is cached for the lifetime of this `FMOData` instance.
   *
   * Returns the major version string (`'19'`, `'21'`, `'22'`, `'26'`) or
   * `'future'` if the version is newer than the spec knows about. Returns
   * `null` if the version cannot be determined (e.g. the metadata lacks the
   * annotation).
   *
   * ```ts
   * const v = await db.version()
   * if (v === '26') console.log('Server is FileMaker 2026')
   * ```
   */
  async version() {
    if (this._detectedVersion !== void 0) return this._detectedVersion;
    try {
      const meta = await this.metadata();
      const raw = meta.productVersion;
      if (!raw) {
        this._detectedVersion = null;
        return null;
      }
      const match = raw.match(/^(\d+)\./);
      if (!match) {
        this._detectedVersion = null;
        return null;
      }
      const major = match[1];
      this._detectedVersion = major in FM_VERSION_MATRIX ? major : "future";
      return this._detectedVersion;
    } catch {
      this._detectedVersion = null;
      return null;
    }
  }
  /**
   * Get the full version info (feature flags + query option flags) for the
   * detected server version. Fetches metadata if not already cached.
   *
   * Returns `null` if the version cannot be determined.
   *
   * ```ts
   * const info = await db.versionInfo()
   * if (info?.features.applyAggregation) {
   *   // Server supports $apply
   * }
   * ```
   */
  async versionInfo() {
    const v = await this.version();
    if (!v) return null;
    return FM_VERSION_MATRIX[v];
  }
  /**
   * Check if the server supports a specific feature. Fetches metadata (to
   * detect the version) on first call; subsequent calls use the cached result.
   *
   * Returns `false` if the version cannot be determined.
   *
   * ```ts
   * if (await db.hasFeature('applyAggregation')) {
   *   const result = await db.from('orders').apply(...)
   * }
   * ```
   */
  async hasFeature(feature) {
    const v = await this.version();
    if (!v) return false;
    return hasFeature(v, feature);
  }
  /**
   * Create a new `$batch` builder for composing multiple OData operations
   * into a single HTTP round-trip.
   *
   * Read operations (`add`) are executed independently. Write operations
   * (`changeset`) are grouped atomically — all succeed or all fail.
   *
   * ```ts
   * const batch = db.batch()
   * const contacts = batch.add({ op: 'list', entitySet: 'contact', query: { $top: 5 } })
   * batch.changeset(cs => {
   *   cs.create('contact', { firstName: 'A', lastName: 'B' })
   *   cs.patch('contact', 123, { firstName: 'Updated' })
   * })
   * const result = await batch.send()
   * console.log(await contacts._promise) // First op result
   * ```
   */
  batch() {
    return new Batch(this);
  }
  /** @internal */
  _resolveUrl(pathOrUrl) {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    if (pathOrUrl.startsWith("/")) return `${this.baseUrl}${pathOrUrl}`;
    return `${this.baseUrl}/${pathOrUrl}`;
  }
};
export {
  Batch,
  Changeset,
  ContainerRef,
  EntityRef,
  FMOData,
  FMODataError,
  FMScriptError,
  FM_CONTAINER_SUPPORTED_MIME_TYPES,
  FM_VERSION_MATRIX,
  FM_VERSION_NAMES,
  Filter,
  MetadataFetcher,
  ODATA_PROTOCOL_VERSION,
  Query,
  ScriptInvoker,
  basicAuth,
  buildContainerJsonBody,
  filterFactory,
  fmidAuth,
  hasFeature,
  hasQueryOption,
  isFMODataError,
  isFMScriptError,
  minVersionForFeature,
  sniffContainerMime,
  toBase64
};
