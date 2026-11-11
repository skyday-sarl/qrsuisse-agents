# OpenAPI specification used by the SDK

`openapi.yaml` is a copy of the OpenAPI specification of the QR Suisse public API, **version
1.3.0**, in English. It is the document served at https://www.qrsuisse.ch/openapi.yaml (English
by default) once version 1.3.0 is released.

- Source: QR Suisse application sources, English version generated the same way as the
  published document, taken on 2026-11-10 (version 1.3.0, before its release).
- The published specification prevails over this copy: https://www.qrsuisse.ch/openapi.json.
- The description still contains the `{{PREAVIS}}` placeholder of the deprecation notice period,
  as in the source on that date.

The SDK types (`packages/sdk/src/generated/openapi.ts`) are generated from this file. To update
both:

```sh
curl -fsS https://www.qrsuisse.ch/openapi.yaml -o spec/openapi.yaml
npm run generate
npm test
```

Never edit `packages/sdk/src/generated/openapi.ts` by hand.
