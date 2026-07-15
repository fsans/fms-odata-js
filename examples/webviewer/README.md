# fms-odata-js · Web Viewer Demo (v0.4.0)

A **single, self-contained HTML page** that demonstrates `fms-odata-js` in a
FileMaker Pro **Web Viewer**. Connects to the bundled `Contacts.fmp12` demo
solution and showcases all major library features.

## Features Demonstrated

| Feature | Description |
|---------|-------------|
| **M1-M2** | CRUD queries with `$top`, `$count` |
| **M3** | Script execution ready (add a "Ping" script) |
| **M4** | Container I/O support (in library, add container fields to test) |
| **M5** | Metadata introspection (`$metadata` parsing) |
| **M6** | Batch operations (`$batch` multipart requests) |
| **v0.2.0** | Version detection, `$apply` aggregation, `$ref` navigation (in library) |
| **v0.4.0** | Schema editing (DDL), webhook management (in library) |

## Two Variants

| File | Library Source | When to use |
|------|--------------|-------------|
| [`index.html`](./index.html) | Loaded from jsDelivr CDN at runtime | Internet access available, smallest file |
| [`index-inline.html`](./index-inline.html) | **Fully inlined** — no external JS | Offline/air-gapped, strict Web Viewer sandboxes |

Both have identical UI and behavior. The inline version bundles **v0.4.0** of the library.

## Quick Start

1. **Host the test database**
   - Upload [`../Contacts.fmp12`](../Contacts.fmp12) to your FileMaker Server
   - Enable **OData API** in Admin Console → Database Server → Configuration
   - Open the database

2. **Load the page**
   - Open `index.html` in a browser, or
   - Drop into a FileMaker Web Viewer (URL, `data:` URL, or calculated HTML string)

3. **Configure and connect**
   Adjust the `Host` field to your FMS URL, then click **Connect & refresh all tables**.

   Default demo credentials:
   | Field | Value |
  |-------|-------|
   | Host | `https://fms.example.com` |
   | Database | `Contacts` |
   | User | `admin` |
   | Password | `admin` |

   > **Change these before hosting on a real network!**

## What It Does

- Loads `fms-odata-js` v0.4.0 (CDN or inlined via IIFE bundle)
- Issues OData `GET` requests per table with `$top=100&$count=true`
- Renders results as tabbed data grids
- Surfaces `FMSODataError` details (HTTP status + FMS error code) inline

## Using New Features (M4-v0.4.0)

The Web Viewer demo focuses on visual table browsing. To test the advanced features:

### Container Fields (M4)
Add a container field to your `contact` table:

```javascript
// In the browser console or a custom script
const container = db.from('contact').byKey(42).container('photo');
const { blob, filename, contentType } = await container.get();

// Upload (binary mode for images/PDFs)
const fileInput = document.getElementById('fileInput');
await container.upload({
  data: fileInput.files[0],
  filename: 'avatar.png',
  encoding: 'binary' // or 'base64' for arbitrary file types
});
```

### Metadata (M5)
Introspect the database schema:

```javascript
const meta = await db.metadata();
console.log('Tables:', meta.entitySets.map(e => e.name));
console.log('Fields:', meta.entityTypes[0].properties.map(p => p.name));
```

### Batch Operations (M6)
Send multiple operations in one request:

```javascript
const batch = db.batch();

// Queue reads
const contactsHandle = batch.add({
  op: 'list',
  entitySet: 'contact',
  query: { $top: 10 }
});

// Queue atomic writes
batch.changeset(cs => {
  cs.create('contact', { first_name: 'Alice', last_name: 'Liddell' });
});

const result = await batch.send();
console.log('All OK:', result.ok);
console.log('Responses:', result.responses);
```

### Version Detection & Aggregation (v0.2.0)
Detect server version and use `$apply` aggregation:

```javascript
const version = await db.version(); // '19' | '21' | '22' | '26' | null
console.log('FMS version:', version);

if (await db.hasFeature('applyAggregation')) {
  const { value } = await db
    .from('contact')
    .aggregate([{ field: 'id', function: 'countdistinct', alias: 'total' }])
    .get();
  console.log('Total contacts:', value[0].total);
}
```

### Navigation Properties / $ref (v0.2.0)

```javascript
const refs = await db.from('contact').byKey(7).getRefs('address');
console.log('Related addresses:', refs.length);
```

See the [`consumer-node`](../consumer-node) example for complete runnable demos of all features.

## Embedding in a Web Viewer

### Option 1: External URL
Host `index.html` on a web server or FMS and load via HTTPS:
```
https://your-server/fms-odata-js/examples/webviewer/index.html
```

### Option 2: Data URL (inline HTML)
Copy the entire contents of `index-inline.html` into a calculation:

```filemaker
"data:text/html;charset=utf-8," &
  Substitute ( YourCalculationReturningHtml ; [ "#" ; "%23" ] ; [ "&" ; "%26" ] )
```

### Option 3: FileMaker 19+ Script
Use `Set Web Viewer` with a calculated HTML string for completely offline operation.

## CORS Requirements

Web Viewers run under `fmp://` or `null` origin. Your FMS must either:
- Send permissive CORS headers for the OData endpoint, or
- Be accessed via the same origin (Data API container field serving)

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `status: loaded with errors` + 401 | Wrong user/password, or OData account lacks privileges |
| `status: err` + network failure | OData API not enabled on FMS, or host URL incorrect |
| 400 on count | Expected — library works around the FMS `/$count` quirk |
| TLS / certificate error | Self-signed FMS cert; see below |
| `Fetch API cannot load ... due to access control checks` | CORS failure, usually caused by TLS error first — fix the cert issue and retry |

### TLS / Self-Signed Certificate Errors

The browser's `fetch()` API cannot skip certificate validation. If your FMS uses a self-signed cert, you have two options:

1. **Use HTTP for local dev** — Change the host from `https://192.168.0.24` to `http://192.168.0.24`. This bypasses TLS entirely. Only suitable for local networks where FMS allows plain HTTP.

2. **Trust the certificate at the OS level** — On macOS:
   - Open `https://your-fms-host` in Safari
   - Click "Show Details" → "visit this website" → proceed
   - Or: open **Keychain Access** → **File → Import Items** → select the FMS cert → double-click it → set "Trust" to "Always Trust"
   - Restart FileMaker Pro so the Web Viewer (WKWebView) picks up the trusted certificate

3. **Install a proper certificate** — Use Let's Encrypt or a commercial cert on FMS for production.

## CDN Version History

- **v0.4.0** (current) — Schema editing (DDL), webhook management, spec-ts 2.0.1 alignment
- **v0.3.0** — Spec alignment: version detection, `$apply`, FMSID scripts, `$ref`, Bearer auth, IIFE build
- **v0.1.6** — M4 containers, M5 metadata, M6 batch
- **v0.1.1** — M1-M3 (basic CRUD + scripts)

To use a specific version, change the URL in `index.html`:
```html
import { FMSOData } from 'https://cdn.jsdelivr.net/gh/fsans/fms-odata-js@v0.4.0/dist/fms-odata.esm.min.js'
```
