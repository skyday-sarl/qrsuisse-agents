# @qrsuisse/sdk

TypeScript client for the [QR Suisse](https://www.qrsuisse.ch) public REST API (v1): create,
read, update and archive dynamic QR codes, download their image, read their scan statistics,
the creation quota of the account and its style templates.

> **Not published yet.** This package is not on npm. The package name is provisional.

- Typed from the OpenAPI specification of the API, version 1.3.0 (see `spec/` at the root of
  the repository).
- No runtime dependency: native `fetch` (Node.js 18.17 or later, Deno, Bun, browsers).
- API key sent only in the `Authorization` header, over HTTPS.
- Optional `Idempotency-Key` on creations, `RateLimit` / `Retry-After` reading, optional waits and
  retries, typed errors.

The API is available with the Pro and Entreprise plans. An API key can only be created from the
QR Suisse dashboard, by a member of the account who manages API keys; give it only the rights
your tool needs.

## Install

Until it is published, build it from this repository:

```sh
npm install
npm run build
```

## Quick start

```ts
import { QrSuisseClient } from "@qrsuisse/sdk";

const client = new QrSuisseClient({ apiKey: process.env.QRSUISSE_API_KEY! });

const { data: usage } = await client.getUsage();
console.log(`${usage.used} of ${usage.monthlyQuota} creations used this month`);

const { data: qrCode } = await client.createQrCode(
  { type: "URL", label: "Waiting room poster", destinationUrl: "https://www.example.ch/appointments" },
  { idempotencyKey: crypto.randomUUID() },
);
console.log(qrCode.publicUrl);
```

Never write the key in your code, never put it in a URL or a log: read it from an environment
variable or a secrets manager.

## Operations

| Method | Endpoint | Right |
|---|---|---|
| `listQrCodes(params?)` | `GET /qr-codes` | `QR_READ` |
| `listAllQrCodes(filters?)` (async iterator over every page) | `GET /qr-codes` | `QR_READ` |
| `createQrCode(input, { idempotencyKey? })` | `POST /qr-codes` | `QR_CREATE` |
| `getQrCode(id)` | `GET /qr-codes/{id}` | `QR_READ` |
| `updateQrCode(id, input)` | `PATCH /qr-codes/{id}` | `QR_UPDATE` |
| `deleteQrCode(id)` | `DELETE /qr-codes/{id}` | `QR_DELETE` |
| `getQrCodeStats(id)` | `GET /qr-codes/{id}/stats` | `STATS_READ` |
| `getQrCodeImage(id, { format?, size?, style?, ifNoneMatch? })` | `GET /qr-codes/{id}/image` | `QR_READ` |
| `getUsage()` | `GET /usage` | `QR_CREATE` |
| `listTemplates()` | `GET /templates` | `QR_READ` |

Every method returns `{ data, status, headers, rateLimit }`. Each one also accepts a `signal`
(`AbortSignal`) to cancel the request.

### List and search

```ts
const { data: page } = await client.listQrCodes({ active: true, type: ["vcard"], q: "geneve", limit: 50 });

// Every page: the same filters are sent again with each cursor, as the API requires.
for await (const qrCode of client.listAllQrCodes({ sort: "created_asc" })) {
  console.log(qrCode.id, qrCode.label);
}
```

### Create, retry safely

Each creation uses one creation of the monthly quota (or a pack credit), even if the QR code is
deleted afterwards. Send a new random `idempotencyKey` for each QR code, never personal data. If
the request fails on a timeout or a dropped connection, send it again with **the same** key
within 24 hours: you get the QR code already created, without a second creation.

```ts
import { QrSuisseConnectionError } from "@qrsuisse/sdk";

const idempotencyKey = crypto.randomUUID();
const input = {
  type: "VCARD",
  label: "Business card Dr Muster",
  firstName: "Anna",
  lastName: "Muster",
  phones: [{ type: "PROFESSIONAL", value: "+41 27 123 45 67" }],
} as const;

let created;
try {
  created = await client.createQrCode(input, { idempotencyKey });
} catch (error) {
  if (!(error instanceof QrSuisseConnectionError)) throw error;
  created = await client.createQrCode(input, { idempotencyKey }); // same key, same body
}
console.log(created.data.id, created.replayed ? "(replayed)" : "(new)");
```

To apply a style, pass the `id` of a template (`listTemplates()`) as `templateId`; `null` means
no style. A style is never sent directly.

### Update, archive, reactivate

`updateQrCode` only changes the fields you send. A QR code may already be printed: a new
destination applies at once to every printed copy, so confirm such a change with the user first.

```ts
await client.updateQrCode(id, { destinationUrl: "https://www.example.ch/new-page" });
await client.updateQrCode(id, { active: false }); // archive (reversible)
await client.updateQrCode(id, { active: true }); // reactivate
```

`deleteQrCode` is permanent: statistics are deleted, printed copies show an error page, and the
creation is not given back. Prefer archiving unless the user explicitly asks for a deletion.

### Image

```ts
import { writeFile } from "node:fs/promises";

const svg = await client.getQrCodeImage(id, { format: "svg" });
if (!svg.notModified) await writeFile(svg.filename ?? "qr.svg", svg.data); // string

const png = await client.getQrCodeImage(id, { size: 512 });
if (!png.notModified) await writeFile("qr.png", png.data); // Uint8Array

// Download again only if it changed.
const again = await client.getQrCodeImage(id, { size: 512, ifNoneMatch: png.etag });
console.log(again.notModified); // true if unchanged (304)
```

## Errors

The API answers every error with `{ "error": "<code>", "message": "<text>" }`. The SDK throws:

- `QrSuisseApiError`: the API answered with an error status. Use `code` (`not_found`,
  `forbidden`, `rate_limited`, `quota_exceeded`, ...), never `message`, a French text that may
  change. Also `status`, `body`, `retryAfter` (seconds), `rateLimit`, and `resetAt` for
  `quota_exceeded`. A response outside this format gets the code `unexpected_response`.
- `QrSuisseConnectionError`: no answer (network, DNS, TLS, or timeout with `timedOut: true`).
- `TypeError`: invalid argument, before anything is sent (missing key, `http://` address,
  malformed `idempotencyKey`, empty id).

```ts
import { isQrSuisseApiError } from "@qrsuisse/sdk";

try {
  await client.createQrCode(input, { idempotencyKey });
} catch (error) {
  if (isQrSuisseApiError(error, "quota_exceeded")) {
    console.log(`Monthly quota used up until ${error.resetAt}`);
  } else if (isQrSuisseApiError(error, "forbidden")) {
    console.log("The key does not have the QR_CREATE right");
  } else {
    throw error;
  }
}
```

## Rate limits and retries

Every response gives the state of the rate limit buckets it consulted, read from the
`RateLimit-Policy` and `RateLimit` headers:

```ts
const { rateLimit } = await client.getUsage();
// [{ name: "api-request", limit: 30, windowSeconds: 60, remaining: 29, resetSeconds: 60 }]
```

These headers follow an IETF draft that may still change; only `429 rate_limited` and
`Retry-After` are authoritative. Slow down when `remaining` gets close to 0.

Retries are disabled by default. With `retry`, the client waits for `Retry-After` and sends the
request again on `429 rate_limited`, `409 idempotency_in_progress` and `503 render_busy`:

```ts
const client = new QrSuisseClient({
  apiKey: process.env.QRSUISSE_API_KEY!,
  retry: { maxRetries: 2, maxDelaySeconds: 60 },
});
```

`429 quota_exceeded`, `401` and every other error are never retried.

## Options

| Option | Default | |
|---|---|---|
| `apiKey` | required | API key (`qrs_live_...`). |
| `baseUrl` | `https://app.qrsuisse.ch/api/v1` | HTTPS only; `http://` is accepted for `localhost` only. |
| `timeoutMs` | `30000` | Timeout of each attempt. |
| `retry` | `{ maxRetries: 0 }` | See above. |
| `fetch` | global `fetch` | Custom `fetch` implementation. |

The client never follows a redirect (the key would follow it), and refuses an `http://` address
other than localhost before sending anything.

## Types

The types are generated from the OpenAPI specification with
[openapi-typescript](https://openapi-ts.dev) (`src/generated/openapi.ts`, versioned) and exported
under readable names: `QrCode`, `QrCodeCreateInput`, `QrCodeUpdateInput`, `QrCodeStats`, `Usage`,
`QrTemplate`, `ApiErrorCode`... The raw `paths`, `components` and `operations` are exported too.

## Links

- [API documentation](https://www.qrsuisse.ch/en/api-documentation)
- [OpenAPI specification](https://www.qrsuisse.ch/openapi.json)
- [Authentication guide](https://www.qrsuisse.ch/auth.md)
- [Instructions for AI agents](https://www.qrsuisse.ch/agents.md)
- [Terms and Conditions](https://www.qrsuisse.ch/en/legal/terms-of-use)

## License

MIT, see [LICENSE](LICENSE). The license covers this code only: it grants no right to use the
QR Suisse service, which requires an account and is governed by its Terms and Conditions, and no
right to the QR Suisse name or logo.
