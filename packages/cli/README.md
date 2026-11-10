# qrsuisse (CLI)

Command line interface for the [QR Suisse](https://www.qrsuisse.ch) public REST API (v1), built
on [`@qrsuisse/sdk`](../sdk). JSON output, for scripts and AI agents.

> **Not published yet.** This package is not on npm. The package name is provisional.

Requires Node.js 18.17 or later and an API key of a Pro or Entreprise account, created in the
QR Suisse dashboard with only the rights you need.

## Install

Until it is published, build it from this repository:

```sh
npm install
npm run build
node packages/cli/dist/bin.js --help
# or: npm link --workspace qrsuisse, then: qrsuisse --help
```

## Authentication

The key is read from the `QRSUISSE_API_KEY` environment variable only. There is no option to
pass it as an argument: arguments end up in the shell history and in the process list.

```sh
export QRSUISSE_API_KEY="<your key>"   # better: load it from your secrets manager
```

## Commands

```sh
qrsuisse usage                                  # creation quota (right QR_CREATE)
qrsuisse templates                              # style templates (right QR_READ)
qrsuisse qr list [filters]                      # list (right QR_READ)
qrsuisse qr get <id>                            # get (right QR_READ)
qrsuisse qr create ...                          # create, uses one creation (right QR_CREATE)
qrsuisse qr update <id> ...                     # update, archive, reactivate (right QR_UPDATE)
qrsuisse qr image <id> --output <file>          # PNG or SVG image (right QR_READ)
qrsuisse qr stats <id>                          # scan statistics (right STATS_READ)
```

`qrsuisse --help` and `qrsuisse <command> --help` describe every option.

### Examples

```sh
# Remaining quota before creating several QR codes
qrsuisse usage

# Active business cards, every page
qrsuisse qr list --active true --type vcard --all

# Search, sorted by label
qrsuisse qr list --search "waiting room" --sort label_asc --limit 50

# Create a URL QR code with a style template
qrsuisse qr create --label "Waiting room poster" --url "https://www.example.ch/appointments" --template-id <templateId>

# Create a business card with phones and emails (full JSON body, here from stdin)
echo '{"type":"VCARD","label":"Card Dr Muster","firstName":"Anna","lastName":"Muster",
       "phones":[{"type":"PROFESSIONAL","value":"+41 27 123 45 67"}]}' | qrsuisse qr create --body-file -

# Archive (reversible), then reactivate
qrsuisse qr update <id> --archive
qrsuisse qr update <id> --reactivate

# SVG for printing, PNG at 512 px
qrsuisse qr image <id> --format svg --output poster.svg
qrsuisse qr image <id> --size 512 --output poster.png

# Extract a field with jq
qrsuisse qr get <id> | jq -r .publicUrl
```

### Creating without duplicates

Every `qr create` sends an `Idempotency-Key` header: a new random UUID, or the value of
`--idempotency-key`. If the creation fails in a way that can be sent again as is (no answer,
`429 rate_limited`, `409 idempotency_in_progress`, server error), the error printed on stderr
contains this `idempotencyKey`. Send the same command again with
`--idempotency-key <that value>` within 24 hours: you get the QR code already created, without a
second creation.

### Changing a destination

A QR code may already be printed: a new destination applies at once to every printed copy. Check
the QR code with `qrsuisse qr get <id>` and confirm the change with its owner before running
`qrsuisse qr update <id> --url ...`.

### No delete command

The CLI has no delete command, on purpose: deleting a QR code is permanent (statistics deleted,
printed copies show an error page, the creation is not given back). Archive it with
`qrsuisse qr update <id> --archive`, or delete it from the dashboard. The SDK offers
`deleteQrCode` for integrations that need it.

## Output and errors

- Success: JSON on stdout (indented, or on one line with `--compact`), exit code `0`.
- API error: JSON on stderr, exit code `1`:

  ```json
  { "error": "quota_exceeded", "message": "Quota mensuel de créations API atteint.", "status": 429, "retryAfter": 1728000, "resetAt": "2026-12-01T00:00:00.000Z" }
  ```

  Base your logic on `error`, never on `message` (a French text that may change). No answer at
  all gives `"error": "connection_error"`.
- Wrong command line: message on stderr, exit code `2`.

## Options common to every command

| Option | |
|---|---|
| `--base-url <url>` | API address, default `https://app.qrsuisse.ch/api/v1` (or `QRSUISSE_API_BASE_URL`). HTTPS only, except on localhost. |
| `--retries <n>` | Wait for `Retry-After` and retry up to `n` times on `429 rate_limited`, `409 idempotency_in_progress` and `503 render_busy` (default 0). `429 quota_exceeded` is never retried. |
| `--compact` | JSON on a single line. |

## Links

- [API documentation](https://www.qrsuisse.ch/en/api-documentation)
- [Instructions for AI agents](https://www.qrsuisse.ch/agents.md)
- [Terms and Conditions](https://www.qrsuisse.ch/en/legal/terms-of-use)

## License

MIT, see [LICENSE](LICENSE). The license covers this code only: it grants no right to use the
QR Suisse service, which requires an account and is governed by its Terms and Conditions, and no
right to the QR Suisse name or logo.
