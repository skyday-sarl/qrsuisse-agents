import { parseArgs } from "node:util";
import {
  QrSuisseApiError,
  QrSuisseClient,
  QrSuisseConnectionError,
  type ListQrCodesParams,
  type QrCode,
  type QrCodeCreateInput,
  type QrCodeImageFormat,
  type QrCodeUpdateInput,
} from "@qrsuisse/sdk";
import { COMMAND_HELP, MAIN_HELP } from "./help.js";
import { CLI_VERSION } from "./version.js";

/** Everything the CLI reads from or writes to the outside world, injected for the tests. */
export interface CliEnvironment {
  env: Record<string, string | undefined>;
  stdout: { write(chunk: string | Uint8Array): unknown };
  stderr: { write(chunk: string): unknown };
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  randomUUID(): string;
  fetch?: typeof fetch;
}

export const EXIT_OK = 0;
export const EXIT_API_ERROR = 1;
export const EXIT_USAGE_ERROR = 2;

/** Wrong command line: exit code 2, message on stderr. */
class UsageError extends Error {}

const GLOBAL_OPTIONS = ["base-url", "retries", "compact", "help", "version"] as const;
const URL_FIELD_OPTIONS = ["url"] as const;
const VCARD_FIELD_OPTIONS = ["first-name", "last-name", "organization", "job-title", "website"] as const;
const TEMPLATE_OPTIONS = ["template-id", "no-template"] as const;

const OPTIONS = {
  "base-url": { type: "string" },
  retries: { type: "string" },
  compact: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  // qr list
  active: { type: "string" },
  type: { type: "string" },
  search: { type: "string" },
  "created-from": { type: "string" },
  "created-before": { type: "string" },
  sort: { type: "string" },
  limit: { type: "string" },
  cursor: { type: "string" },
  all: { type: "boolean" },
  // qr create, qr update
  label: { type: "string" },
  url: { type: "string" },
  "first-name": { type: "string" },
  "last-name": { type: "string" },
  organization: { type: "string" },
  "job-title": { type: "string" },
  website: { type: "string" },
  "template-id": { type: "string" },
  "no-template": { type: "boolean" },
  "body-file": { type: "string" },
  "idempotency-key": { type: "string" },
  archive: { type: "boolean" },
  reactivate: { type: "boolean" },
  // qr image
  output: { type: "string", short: "o" },
  format: { type: "string" },
  size: { type: "string" },
  style: { type: "string" },
  "if-none-match": { type: "string" },
} as const;

type OptionName = keyof typeof OPTIONS;
type Values = { [Name in OptionName]?: (typeof OPTIONS)[Name]["type"] extends "boolean" ? boolean : string };

const FIELD_OPTIONS = ["label", ...URL_FIELD_OPTIONS, ...VCARD_FIELD_OPTIONS, ...TEMPLATE_OPTIONS] as const;

/** Options accepted by each command, on top of the global ones. */
const COMMAND_OPTIONS: Record<string, readonly OptionName[]> = {
  usage: [],
  templates: [],
  "qr list": ["active", "type", "search", "created-from", "created-before", "sort", "limit", "cursor", "all"],
  "qr get": [],
  "qr create": [...FIELD_OPTIONS, "body-file", "idempotency-key"],
  "qr update": [...FIELD_OPTIONS, "body-file", "archive", "reactivate"],
  "qr image": ["output", "format", "size", "style", "if-none-match"],
  "qr stats": [],
};

/** Commands that take a QR code id. */
const COMMANDS_WITH_ID = new Set(["qr get", "qr update", "qr image", "qr stats"]);

/** Runs the CLI and returns the exit code. */
export async function main(argv: readonly string[], io: CliEnvironment): Promise<number> {
  let idempotencyKey: string | undefined;
  let compact = false;
  try {
    refuseApiKeyArgument(argv);
    const { values, positionals } = parseCommandLine(argv);
    compact = values.compact === true;

    if (values.version) {
      io.stdout.write(`${CLI_VERSION}\n`);
      return EXIT_OK;
    }
    const command = resolveCommand(positionals);
    if (command === undefined && !values.help) {
      io.stderr.write(MAIN_HELP);
      return EXIT_USAGE_ERROR;
    }
    if (command === undefined || values.help) {
      io.stdout.write(command === undefined ? MAIN_HELP : COMMAND_HELP[command] ?? MAIN_HELP);
      return EXIT_OK;
    }
    checkOptionsOf(command, values);
    const id = commandId(command, positionals);

    const client = createClient(values, io);
    const print = (value: unknown) => io.stdout.write(`${JSON.stringify(value, null, compact ? undefined : 2)}\n`);

    switch (command) {
      case "usage":
        print((await client.getUsage()).data);
        return EXIT_OK;
      case "templates":
        print((await client.listTemplates()).data);
        return EXIT_OK;
      case "qr list":
        print(await listQrCodes(client, values));
        return EXIT_OK;
      case "qr get":
        print((await client.getQrCode(id)).data);
        return EXIT_OK;
      case "qr stats":
        print((await client.getQrCodeStats(id)).data);
        return EXIT_OK;
      case "qr create": {
        const body = await createBody(values, io);
        idempotencyKey = values["idempotency-key"] ?? io.randomUUID();
        print((await client.createQrCode(body, { idempotencyKey })).data);
        return EXIT_OK;
      }
      case "qr update":
        print((await client.updateQrCode(id, await updateBody(values, io))).data);
        return EXIT_OK;
      case "qr image":
        return await downloadImage(client, id, values, io, print);
      default:
        throw new UsageError(`Unknown command: ${command}`);
    }
  } catch (error) {
    return reportError(error, io, { idempotencyKey, compact });
  }
}

function refuseApiKeyArgument(argv: readonly string[]): void {
  if (argv.some((argument) => /^--?(api[-_]?key|key|token|secret)(=|$)/i.test(argument))) {
    throw new UsageError(
      "The API key is never passed as an argument (it would end up in the shell history). Set the QRSUISSE_API_KEY environment variable.",
    );
  }
}

function parseCommandLine(argv: readonly string[]): { values: Values; positionals: string[] } {
  try {
    const { values, positionals } = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
    return { values: values as Values, positionals };
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function resolveCommand(positionals: readonly string[]): string | undefined {
  const [first, second] = positionals;
  if (first === undefined) return undefined;
  if (first === "usage" || first === "templates") return first;
  if (first === "qr") {
    const command = `qr ${second ?? ""}`;
    if (second !== undefined && command in COMMAND_OPTIONS) return command;
    throw new UsageError(`Unknown or missing qr command${second ? `: ${second}` : ""}. Run "qrsuisse --help".`);
  }
  throw new UsageError(`Unknown command: ${first}. Run "qrsuisse --help".`);
}

function checkOptionsOf(command: string, values: Values): void {
  const allowed = new Set<string>([...GLOBAL_OPTIONS, ...(COMMAND_OPTIONS[command] ?? [])]);
  for (const name of Object.keys(values)) {
    if (!allowed.has(name)) throw new UsageError(`Option --${name} is not available for "${command}".`);
  }
}

function commandId(command: string, positionals: readonly string[]): string {
  const expectedPositionals = command.startsWith("qr ") ? 2 : 1;
  const extra = positionals.slice(expectedPositionals);
  if (!COMMANDS_WITH_ID.has(command)) {
    if (extra.length > 0) throw new UsageError(`Unexpected argument: ${extra[0]}`);
    return "";
  }
  const [id, ...rest] = extra;
  if (!id) throw new UsageError(`Missing QR code id. Usage: qrsuisse ${command} <id>`);
  if (rest.length > 0) throw new UsageError(`Unexpected argument: ${rest[0]}`);
  return id;
}

function createClient(values: Values, io: CliEnvironment): QrSuisseClient {
  const apiKey = io.env.QRSUISSE_API_KEY?.trim();
  if (!apiKey) {
    throw new UsageError(
      "Set the QRSUISSE_API_KEY environment variable to an API key created in the QR Suisse dashboard (Pro and Entreprise plans).",
    );
  }
  const baseUrl = values["base-url"] ?? (io.env.QRSUISSE_API_BASE_URL?.trim() || undefined);
  const maxRetries = values.retries === undefined ? 0 : parseInteger("--retries", values.retries);
  try {
    return new QrSuisseClient({ apiKey, baseUrl, retry: { maxRetries }, fetch: io.fetch });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

async function listQrCodes(client: QrSuisseClient, values: Values): Promise<unknown> {
  const params: ListQrCodesParams = {};
  if (values.active !== undefined) {
    if (values.active !== "true" && values.active !== "false") throw new UsageError("--active must be true or false.");
    params.active = values.active;
  }
  if (values.type !== undefined) params.type = values.type.split(",").map((type) => type.trim()) as ListQrCodesParams["type"];
  if (values.search !== undefined) params.q = values.search;
  if (values["created-from"] !== undefined) params.createdFrom = values["created-from"];
  if (values["created-before"] !== undefined) params.createdBefore = values["created-before"];
  if (values.sort !== undefined) params.sort = values.sort as ListQrCodesParams["sort"];
  if (values.limit !== undefined) params.limit = parseInteger("--limit", values.limit);

  if (!values.all) {
    if (values.cursor !== undefined) params.cursor = values.cursor;
    return (await client.listQrCodes(params)).data;
  }
  if (values.cursor !== undefined) throw new UsageError("--all and --cursor cannot be combined.");
  const qrCodes: QrCode[] = [];
  for await (const qrCode of client.listAllQrCodes(params)) qrCodes.push(qrCode);
  return { data: qrCodes, nextCursor: null };
}

async function createBody(values: Values, io: CliEnvironment): Promise<QrCodeCreateInput> {
  if (values["body-file"] !== undefined) {
    refuseFieldOptionsWithBodyFile(values);
    return (await readJsonBody(values["body-file"], io)) as QrCodeCreateInput;
  }
  if (values.label === undefined) throw new UsageError("--label is required (or give the full body with --body-file).");
  const hasVcardFields = VCARD_FIELD_OPTIONS.some((name) => values[name] !== undefined);
  const templateId = templateIdOf(values);
  const style = templateId === undefined ? {} : { templateId };

  if (values.url !== undefined) {
    if (hasVcardFields) throw new UsageError("--url cannot be combined with business card options.");
    return { type: "URL", label: values.label, destinationUrl: values.url, ...style };
  }
  if (!hasVcardFields) throw new UsageError("Give --url for a URL QR code, or --first-name and --last-name for a business card.");
  if (values["first-name"] === undefined || values["last-name"] === undefined) {
    throw new UsageError("A business card needs --first-name and --last-name.");
  }
  return {
    type: "VCARD",
    label: values.label,
    firstName: values["first-name"],
    lastName: values["last-name"],
    ...definedFields({ organization: values.organization, jobTitle: values["job-title"], website: values.website }),
    ...style,
  };
}

async function updateBody(values: Values, io: CliEnvironment): Promise<QrCodeUpdateInput> {
  if (values["body-file"] !== undefined) {
    refuseFieldOptionsWithBodyFile(values);
    if (values.archive || values.reactivate) throw new UsageError("--body-file cannot be combined with --archive or --reactivate.");
    return (await readJsonBody(values["body-file"], io)) as QrCodeUpdateInput;
  }
  if (values.archive && values.reactivate) throw new UsageError("--archive and --reactivate cannot be combined.");
  const templateId = templateIdOf(values);
  const body: QrCodeUpdateInput = definedFields({
    active: values.archive ? false : values.reactivate ? true : undefined,
    label: values.label,
    destinationUrl: values.url,
    firstName: values["first-name"],
    lastName: values["last-name"],
    organization: values.organization,
    jobTitle: values["job-title"],
    website: values.website,
    templateId,
  });
  if (Object.keys(body).length === 0) throw new UsageError('Nothing to update. Run "qrsuisse qr update --help".');
  return body;
}

function templateIdOf(values: Values): string | null | undefined {
  if (values["template-id"] !== undefined && values["no-template"]) {
    throw new UsageError("--template-id and --no-template cannot be combined.");
  }
  if (values["no-template"]) return null;
  return values["template-id"];
}

function refuseFieldOptionsWithBodyFile(values: Values): void {
  const conflicting = FIELD_OPTIONS.find((name) => values[name] !== undefined);
  if (conflicting) throw new UsageError(`--body-file cannot be combined with --${conflicting}.`);
}

async function readJsonBody(source: string, io: CliEnvironment): Promise<Record<string, unknown>> {
  const text = source === "-" ? await io.readStdin() : await io.readFile(source);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new UsageError(`--body-file: ${source === "-" ? "stdin" : source} is not valid JSON.`);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new UsageError("--body-file must contain a JSON object.");
  }
  return body as Record<string, unknown>;
}

async function downloadImage(
  client: QrSuisseClient,
  id: string,
  values: Values,
  io: CliEnvironment,
  print: (value: unknown) => void,
): Promise<number> {
  const output = values.output;
  if (output === undefined) throw new UsageError('--output is required: a file name, or "-" for stdout.');
  const format = values.format;
  if (format !== undefined && format !== "png" && format !== "svg") throw new UsageError("--format must be png or svg.");
  if (values.style !== undefined && values.style !== "none") throw new UsageError("--style only accepts none.");

  const image = await client.getQrCodeImage(id, {
    format: format as QrCodeImageFormat | undefined,
    size: values.size === undefined ? undefined : parseInteger("--size", values.size),
    style: values.style as "none" | undefined,
    ifNoneMatch: values["if-none-match"],
  });
  if (image.notModified) {
    if (output !== "-") print({ notModified: true, etag: image.etag });
    return EXIT_OK;
  }
  if (output === "-") {
    io.stdout.write(image.data);
    return EXIT_OK;
  }
  await io.writeFile(output, image.data);
  print({
    notModified: false,
    file: output,
    bytes: typeof image.data === "string" ? new TextEncoder().encode(image.data).byteLength : image.data.byteLength,
    contentType: image.contentType,
    etag: image.etag,
    filename: image.filename,
  });
  return EXIT_OK;
}

function parseInteger(option: string, value: string): number {
  if (!/^\d+$/.test(value)) throw new UsageError(`${option} must be a whole number.`);
  return Number(value);
}

/** Copy of `fields` without the `undefined` values: a missing option leaves the field out of the body. */
function definedFields<T extends Record<string, unknown>>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

function reportError(error: unknown, io: CliEnvironment, context: { idempotencyKey: string | undefined; compact: boolean }): number {
  const write = (value: unknown) => io.stderr.write(`${JSON.stringify(value, null, context.compact ? undefined : 2)}\n`);
  // Only on a failed creation: the key lets the user send the same creation again without a duplicate.
  const retryHint = context.idempotencyKey === undefined ? {} : { idempotencyKey: context.idempotencyKey };

  if (error instanceof UsageError) {
    io.stderr.write(`qrsuisse: ${error.message}\n`);
    return EXIT_USAGE_ERROR;
  }
  if (error instanceof QrSuisseApiError) {
    write({
      error: error.code,
      message: error.message,
      status: error.status,
      ...definedFields({ retryAfter: error.retryAfter, resetAt: error.resetAt }),
      ...retryHint,
    });
    return EXIT_API_ERROR;
  }
  if (error instanceof QrSuisseConnectionError) {
    write({ error: "connection_error", message: error.message, timedOut: error.timedOut, ...retryHint });
    return EXIT_API_ERROR;
  }
  write({ error: "internal_cli_error", message: error instanceof Error ? error.message : String(error) });
  return EXIT_API_ERROR;
}
