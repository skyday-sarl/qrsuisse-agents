export const MAIN_HELP = `qrsuisse: command line interface for the QR Suisse public API (v1)

Usage:
  qrsuisse <command> [options]

Commands:
  usage                      API creation quota of the account          (right QR_CREATE)
  templates                  Style templates of the account             (right QR_READ)
  qr list                    List the QR codes of the account           (right QR_READ)
  qr get <id>                Get a QR code                              (right QR_READ)
  qr create                  Create a QR code (uses one creation)       (right QR_CREATE)
  qr update <id>             Update, archive or reactivate a QR code    (right QR_UPDATE)
  qr image <id>              Download the image (PNG or SVG)            (right QR_READ)
  qr stats <id>              Get the scan statistics                    (right STATS_READ)

Authentication:
  The API key is read from the QRSUISSE_API_KEY environment variable, never from an
  argument (arguments end up in the shell history and the process list). Create the key in
  the QR Suisse dashboard (Pro and Entreprise plans), with only the rights you need.

Global options:
  --base-url <url>           API address (default https://app.qrsuisse.ch/api/v1,
                             or QRSUISSE_API_BASE_URL). HTTPS only, except on localhost.
  --retries <n>              Wait for Retry-After and retry up to n times on 429 rate_limited,
                             409 idempotency_in_progress and 503 render_busy (default 0).
                             429 quota_exceeded is never retried.
  --compact                  Print JSON on a single line.
  -h, --help                 Show help (also: qrsuisse <command> --help).
  -v, --version              Show the version.

Output:
  JSON on stdout. On an API error (or connection_error, redirect_refused, unexpected_response),
  the error (code, message, status, retryAfter, resetAt) is printed as JSON on stderr and the
  exit code is 1. An error detected by the CLI itself (usage_error, missing_api_key,
  invalid_argument, file_error) is printed the same way with the exit code 2. With --retries,
  each wait is announced by a JSON line on stderr ({"notice":"retrying",...}).
  Base your logic on the "error" code, never on "message" (a French text that may change).

Not available:
  There is no delete command: deleting a QR code is permanent (statistics lost, printed copies
  show an error page). Archive it instead with "qrsuisse qr update <id> --archive" (reversible),
  or delete it from the dashboard.

Documentation: https://www.qrsuisse.ch/en/api-documentation
`;

export const COMMAND_HELP: Record<string, string> = {
  usage: `Usage: qrsuisse usage

API creation quota of the account: creations this UTC month (used), monthly quota of the plan,
pack credits remaining and reset date. Right QR_CREATE.
`,
  templates: `Usage: qrsuisse templates

Style templates of the account, with the id to pass to --template-id. Templates are managed in
the dashboard only. Right QR_READ.
`,
  "qr list": `Usage: qrsuisse qr list [options]

List the QR codes of the account, newest first. Right QR_READ.

Options:
  --active <true|false>      Active QR codes only (true) or archived ones only (false).
  --type <types>             Comma-separated: url, web, email, phone, sms, ftp, calendar, vcard.
  --search <text>            Search in the label, the destination and the slug.
  --created-from <date>      Created on or after this date (YYYY-MM-DD or ISO 8601 date-time).
  --created-before <date>    Created before this date (excluded).
  --sort <order>             created_desc (default), created_asc, label_asc, label_desc.
  --limit <n>                Items per page, 1 to 100 (default 20).
  --cursor <cursor>          nextCursor of the previous page (send the same filters again).
  --all                      Follow every page and print all the QR codes at once.
`,
  "qr get": `Usage: qrsuisse qr get <id>

Get a QR code. Right QR_READ.
`,
  "qr create": `Usage: qrsuisse qr create --label <label> --url <destination> [options]
       qrsuisse qr create --label <label> --first-name <name> --last-name <name> [options]
       qrsuisse qr create --body-file <file.json | ->

Create a QR code. Uses one creation of the monthly quota (or a pack credit), even if the QR code
is deleted afterwards. Check the balance first with "qrsuisse usage". Right QR_CREATE.

Options:
  --label <label>            Label (required).
  --url <destination>        URL QR code: https:, http:, mailto:, tel:, sms: or ftp: destination.
  --first-name <name>        Business card (VCARD) QR code: first name.
  --last-name <name>         Business card: last name.
  --organization <name>      Business card: organisation.
  --job-title <title>        Business card: job title.
  --website <url>            Business card: website.
  --template-id <id>         Apply a style template (see "qrsuisse templates").
  --no-template              No style, even if the account has a default template.
  --body-file <file | ->     Full JSON body of POST /qr-codes (phones, emails, addresses...),
                             read from a file or from stdin with "-". Cannot be combined with
                             the field options above.
  --idempotency-key <key>    Idempotency-Key header. Default: a new random UUID. To retry a
                             creation that failed on a network error without creating a
                             duplicate, send the same command again with the key printed on
                             stderr (valid 24 hours).

Never put health data, passwords or other sensitive data in a QR code: the destination is
revealed to anyone who scans it.
`,
  "qr update": `Usage: qrsuisse qr update <id> [options]

Partially update a QR code: only the fields given are changed. Archiving and reactivating do
not use a creation. Right QR_UPDATE.

A QR code may already be printed: a new destination applies at once to every printed copy.
Check the QR code first ("qrsuisse qr get <id>") and confirm the change with its owner.

Options:
  --archive                  Archive the QR code (its public address stops redirecting).
  --reactivate               Reactivate an archived QR code.
  --label <label>            New label.
  --url <destination>        New destination (URL QR codes only).
  --first-name, --last-name, --organization, --job-title, --website <value>
                             Business card fields (VCARD QR codes only). An empty value clears
                             --organization, --job-title and --website.
  --template-id <id>         Apply the current style of a template.
  --no-template              Remove the style.
  --body-file <file | ->     Full JSON body of PATCH /qr-codes/{id} (phones, emails, addresses
                             replace the whole category). Cannot be combined with the options above.
`,
  "qr image": `Usage: qrsuisse qr image <id> --output <file | -> [options]

Download the image of a QR code. Prints a JSON summary (file, bytes, etag...) unless the image is
written to stdout with "--output -". Right QR_READ.

Options:
  --output <file | ->        File to write (required). "-" writes the image to stdout.
  --format <png|svg>         Default png. Prefer svg for printing (resizes without loss).
  --size <n>                 PNG only: side in pixels, 128 to 1024 (default 1024).
  --style none               Standard rendering, without the style of the QR code.
  --if-none-match <etag>     ETag of a previous download: nothing is written if unchanged.
`,
  "qr stats": `Usage: qrsuisse qr stats <id>

Scan statistics: total since creation and one item per day with at least one scan (15 months at
most). No data on who scanned. Right STATS_READ.
`,
};
