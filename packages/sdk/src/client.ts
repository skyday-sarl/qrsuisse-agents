import {
  isRecord,
  QrSuisseApiError,
  QrSuisseArgumentError,
  QrSuisseConnectionError,
  QrSuisseError,
  QrSuisseRedirectError,
} from "./errors.js";
import { parseRateLimitHeaders, parseRetryAfter, type RateLimitState } from "./rate-limit.js";
import type {
  ListQrCodesParams as GeneratedListQrCodesParams,
  QrCode,
  QrCodeCreateInput,
  QrCodeImageFormat,
  QrCodeListPage,
  QrCodeStats,
  QrCodeUpdateInput,
  QrTemplateList,
  Usage,
} from "./types.js";
import { SDK_VERSION } from "./version.js";

/** Address of the production API. */
export const DEFAULT_BASE_URL = "https://app.qrsuisse.ch/api/v1";

/** Host names on which plain HTTP is accepted, for local development only (same rule as the API). */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Format of the `Idempotency-Key` header documented by the API: 1 to 255 visible ASCII characters. */
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,255}$/;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRY_DELAY_SECONDS = 60;

export interface RetryOptions {
  /**
   * Number of new attempts after a response that asks the client to wait and try again:
   * `429 rate_limited`, `409 idempotency_in_progress` and `503 render_busy`, each with
   * `Retry-After`. Default `0`: no retry. `429 quota_exceeded` and every other error are never
   * retried.
   */
  maxRetries?: number;
  /** Longest wait accepted, in seconds. When `Retry-After` is longer, the error is thrown at once. Default 60. */
  maxDelaySeconds?: number;
  /** Called before each wait, for example to tell the user why the call takes longer. */
  onRetry?: (retry: RetryNotice) => void;
}

/** A wait before a new attempt. */
export interface RetryNotice {
  /** The error that asks to wait (`rate_limited`, `idempotency_in_progress` or `render_busy`). */
  error: QrSuisseApiError;
  /** Seconds before the new attempt (`Retry-After`). */
  delaySeconds: number;
  /** Number of the new attempt, from 1 to `maxRetries`. */
  attempt: number;
  maxRetries: number;
}

export interface QrSuisseClientOptions {
  /**
   * API key (`qrs_live_<apiKeyId>.<secret>`), created in the QR Suisse dashboard. Read it from
   * your configuration (for example `process.env.QRSUISSE_API_KEY`), never from versioned code.
   * It is only ever sent in the `Authorization` header.
   */
  apiKey: string;
  /** API address. Default `https://app.qrsuisse.ch/api/v1`. HTTPS only, except on localhost. */
  baseUrl?: string;
  /** Timeout of each attempt in milliseconds, reading of the response body included. Default 30000. */
  timeoutMs?: number;
  /** Automatic waits and retries on the responses that carry `Retry-After`. Disabled by default. */
  retry?: RetryOptions;
  /**
   * `fetch` implementation. Default: the global `fetch` (Node.js 18.17 and later, Deno, Bun).
   * Server-side only: never ship an API key to a browser, where anyone can read it.
   */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  /** Cancels the request (and a wait before a retry). */
  signal?: AbortSignal;
}

export interface CreateQrCodeOptions extends RequestOptions {
  /**
   * `Idempotency-Key` header: a new random value for each QR code to create (UUID v4
   * recommended, never personal data). Sending the same request again with the same value
   * within 24 hours returns the QR code already created instead of creating a second one.
   */
  idempotencyKey?: string;
}

export interface QrCodeImageOptions extends RequestOptions {
  /** `png` (default) or `svg`. */
  format?: QrCodeImageFormat;
  /** PNG only: side in pixels, 128 to 1024 (at least 256 with a logo). Default 1024. */
  size?: number;
  /** `none`: standard rendering, without the style of the QR code. */
  style?: "none";
  /** `ETag` of a previous call: the API answers `304` without a body if the image has not changed. */
  ifNoneMatch?: string;
}

/** `GET /qr-codes` parameters. `active` also accepts a boolean. */
export type ListQrCodesParams = Omit<GeneratedListQrCodesParams, "active"> & {
  active?: boolean | "true" | "false";
};

/** Successful response of the API. */
export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
  /** Rate limit buckets consulted by the request (`RateLimit` and `RateLimit-Policy` headers). */
  rateLimit: RateLimitState;
}

export interface CreateQrCodeResponse extends ApiResponse<QrCode> {
  /** `true` when the API replayed a creation already made with the same `Idempotency-Key` (no quota used). */
  replayed: boolean;
}

export interface QrCodeImage<T> extends ApiResponse<T> {
  notModified: false;
  /** `ETag` to send back in `ifNoneMatch` next time. */
  etag: string | undefined;
  /** File name suggested by the API (`qr-suisse-<slug>.<png|svg>`). */
  filename: string | undefined;
  contentType: string | undefined;
}

export interface QrCodeImageNotModified extends ApiResponse<null> {
  notModified: true;
  etag: string | undefined;
}

type ImageResult<T> = QrCodeImage<T> | QrCodeImageNotModified;

/** Reads the body of a successful response, within the timeout of the attempt. */
type ResponseReader<T> = (response: Response) => Promise<T>;

interface Exchange<T> {
  result: T;
  response: Response;
  rateLimit: RateLimitState;
}

interface RequestDescription {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: URLSearchParams;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  accept?: string;
}

/**
 * Client of the QR Suisse public REST API (v1).
 *
 * Every method returns `{ data, status, headers, rateLimit }` and throws a `QrSuisseApiError`
 * (with a stable `code`) when the API answers with an error, or a `QrSuisseConnectionError` when
 * no answer is received.
 */
export class QrSuisseClient {
  readonly baseUrl: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #maxRetryDelaySeconds: number;
  readonly #fetch: typeof fetch;
  readonly #onRetry: ((retry: RetryNotice) => void) | undefined;

  constructor(options: QrSuisseClientOptions) {
    this.#apiKey = validateApiKey(options.apiKey);
    this.baseUrl = validateBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxRetries = Math.max(0, Math.floor(options.retry?.maxRetries ?? 0));
    this.#maxRetryDelaySeconds = options.retry?.maxDelaySeconds ?? DEFAULT_MAX_RETRY_DELAY_SECONDS;
    this.#onRetry = options.retry?.onRetry;
    const fetchImplementation = options.fetch ?? globalThis.fetch;
    if (typeof fetchImplementation !== "function") {
      throw new QrSuisseArgumentError("No fetch implementation available: use Node.js 18 or later, or pass the `fetch` option.");
    }
    this.#fetch = fetchImplementation;
  }

  /** `GET /qr-codes` — one page of the QR codes of the account. Right `QR_READ`. */
  async listQrCodes(params: ListQrCodesParams = {}, options: RequestOptions = {}): Promise<ApiResponse<QrCodeListPage>> {
    return this.#json<QrCodeListPage>({ method: "GET", path: "/qr-codes", query: listQuery(params), signal: options.signal });
  }

  /**
   * Every QR code matching the filters, page after page. The same filter and sort parameters are
   * sent with each cursor, as the API requires. Right `QR_READ`.
   */
  async *listAllQrCodes(
    params: Omit<ListQrCodesParams, "cursor"> = {},
    options: RequestOptions = {},
  ): AsyncGenerator<QrCode, void, undefined> {
    let cursor: string | undefined;
    do {
      const { data } = await this.listQrCodes({ ...params, cursor }, options);
      yield* data.data;
      cursor = data.nextCursor ?? undefined;
    } while (cursor);
  }

  /**
   * `POST /qr-codes` — creates a QR code. Right `QR_CREATE`; uses one creation of the monthly
   * quota (or a pack credit). Pass `idempotencyKey` to be able to retry safely.
   */
  async createQrCode(input: QrCodeCreateInput, options: CreateQrCodeOptions = {}): Promise<CreateQrCodeResponse> {
    const headers: Record<string, string> = {};
    if (options.idempotencyKey !== undefined) {
      if (!IDEMPOTENCY_KEY_PATTERN.test(options.idempotencyKey)) {
        throw new QrSuisseArgumentError("idempotencyKey must be 1 to 255 visible ASCII characters, without spaces (UUID v4 recommended).");
      }
      headers["Idempotency-Key"] = options.idempotencyKey;
    }
    const response = await this.#json<QrCode>({
      method: "POST",
      path: "/qr-codes",
      body: input,
      headers,
      signal: options.signal,
    });
    return { ...response, replayed: response.headers.get("idempotent-replayed") === "true" };
  }

  /** `GET /qr-codes/{id}`. Right `QR_READ`. */
  async getQrCode(id: string, options: RequestOptions = {}): Promise<ApiResponse<QrCode>> {
    return this.#json<QrCode>({ method: "GET", path: qrCodePath(id), signal: options.signal });
  }

  /**
   * `PATCH /qr-codes/{id}` — partial update; a missing field is left unchanged. `{ active: false }`
   * archives the QR code, `{ active: true }` reactivates it. Right `QR_UPDATE`.
   *
   * A QR code may already be printed: changing its destination changes where every printed copy
   * leads. Confirm with the user before changing `destinationUrl` or the business card.
   */
  async updateQrCode(id: string, input: QrCodeUpdateInput, options: RequestOptions = {}): Promise<ApiResponse<QrCode>> {
    return this.#json<QrCode>({ method: "PATCH", path: qrCodePath(id), body: input, signal: options.signal });
  }

  /**
   * `DELETE /qr-codes/{id}` — **permanent** deletion: the statistics are deleted too, printed
   * copies show an error page, and the creation is not given back to the quota. Prefer archiving
   * (`updateQrCode(id, { active: false })`) unless the user explicitly asks for a deletion.
   * Right `QR_DELETE`.
   */
  async deleteQrCode(id: string, options: RequestOptions = {}): Promise<ApiResponse<null>> {
    const { response, rateLimit } = await this.#request(
      { method: "DELETE", path: qrCodePath(id), signal: options.signal },
      async () => null,
    );
    return { data: null, status: response.status, headers: response.headers, rateLimit };
  }

  /** `GET /qr-codes/{id}/stats` — total scans and one item per day with at least one scan. Right `STATS_READ`. */
  async getQrCodeStats(id: string, options: RequestOptions = {}): Promise<ApiResponse<QrCodeStats>> {
    return this.#json<QrCodeStats>({ method: "GET", path: `${qrCodePath(id)}/stats`, signal: options.signal });
  }

  /**
   * `GET /qr-codes/{id}/image` — image of the QR code: bytes for PNG, text for SVG. With
   * `ifNoneMatch`, `notModified` is `true` and `data` is `null` if the image has not changed.
   * Right `QR_READ`.
   */
  getQrCodeImage(id: string, options: QrCodeImageOptions & { format: "svg" }): Promise<ImageResult<string>>;
  getQrCodeImage(id: string, options?: QrCodeImageOptions & { format?: "png" }): Promise<ImageResult<Uint8Array>>;
  getQrCodeImage(id: string, options?: QrCodeImageOptions): Promise<ImageResult<Uint8Array | string>>;
  async getQrCodeImage(id: string, options: QrCodeImageOptions = {}): Promise<ImageResult<Uint8Array | string>> {
    const query = new URLSearchParams();
    if (options.format !== undefined) query.set("format", options.format);
    if (options.size !== undefined) query.set("size", String(options.size));
    if (options.style !== undefined) query.set("style", options.style);
    const headers: Record<string, string> = {};
    if (options.ifNoneMatch !== undefined) headers["If-None-Match"] = options.ifNoneMatch;

    const isSvgResponse = (response: Response) =>
      options.format === "svg" || response.headers.get("content-type")?.startsWith("image/svg+xml") === true;
    const { result: data, response, rateLimit } = await this.#request(
      {
        method: "GET",
        path: `${qrCodePath(id)}/image`,
        query,
        headers,
        signal: options.signal,
        accept: "image/png, image/svg+xml, application/json",
      },
      async (response): Promise<Uint8Array | string | null> => {
        if (response.status === 304) return null;
        return isSvgResponse(response) ? response.text() : new Uint8Array(await response.arrayBuffer());
      },
    );
    const etag = response.headers.get("etag") ?? undefined;
    if (data === null) {
      return { data: null, status: 304, headers: response.headers, rateLimit, notModified: true, etag };
    }
    const contentType = response.headers.get("content-type") ?? undefined;
    return {
      data,
      status: response.status,
      headers: response.headers,
      rateLimit,
      notModified: false,
      etag,
      filename: attachmentFilename(response.headers.get("content-disposition")),
      contentType,
    };
  }

  /** `GET /usage` — API creation quota of the account. Right `QR_CREATE`. */
  async getUsage(options: RequestOptions = {}): Promise<ApiResponse<Usage>> {
    return this.#json<Usage>({ method: "GET", path: "/usage", signal: options.signal });
  }

  /** `GET /templates` — style templates of the account, to pass as `templateId`. Right `QR_READ`. */
  async listTemplates(options: RequestOptions = {}): Promise<ApiResponse<QrTemplateList>> {
    return this.#json<QrTemplateList>({ method: "GET", path: "/templates", signal: options.signal });
  }

  async #json<T>(request: RequestDescription): Promise<ApiResponse<T>> {
    const { result, response, rateLimit } = await this.#request(request, (response) => readJson<T>(response));
    return { data: result, status: response.status, headers: response.headers, rateLimit };
  }

  /** Sends the request, waits and retries if allowed, and throws the API error otherwise. */
  async #request<T>(request: RequestDescription, read: ResponseReader<T>): Promise<Exchange<T>> {
    const body = request.body === undefined ? undefined : JSON.stringify(request.body);
    for (let attempt = 0; ; attempt++) {
      const outcome = await this.#attempt(request, body, read);
      if (!(outcome instanceof QrSuisseApiError)) return outcome;
      if (attempt < this.#maxRetries && this.#shouldRetry(outcome)) {
        const delaySeconds = outcome.retryAfter ?? 0;
        this.#onRetry?.({ error: outcome, delaySeconds, attempt: attempt + 1, maxRetries: this.#maxRetries });
        await sleep(delaySeconds * 1000, request.signal);
        continue;
      }
      throw outcome;
    }
  }

  #shouldRetry(error: QrSuisseApiError): boolean {
    const asksToWait =
      (error.status === 429 && error.code === "rate_limited") ||
      (error.status === 409 && error.code === "idempotency_in_progress") ||
      (error.status === 503 && error.code === "render_busy");
    return asksToWait && error.retryAfter !== undefined && error.retryAfter <= this.#maxRetryDelaySeconds;
  }

  /**
   * One attempt. The timeout covers the whole exchange, reading of the body included. An error
   * status is returned (not thrown) so that `#request` can decide to retry.
   */
  async #attempt<T>(
    request: RequestDescription,
    body: string | undefined,
    read: ResponseReader<T>,
  ): Promise<Exchange<T> | QrSuisseApiError> {
    const url = new URL(this.baseUrl + request.path);
    if (request.query) url.search = request.query.toString();

    const headers: Record<string, string> = {
      Accept: request.accept ?? "application/json",
      Authorization: `Bearer ${this.#apiKey}`,
      "User-Agent": `qrsuisse-sdk-js/${SDK_VERSION}`,
      ...request.headers,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.#timeoutMs);
    const abortFromCaller = () => timeout.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", abortFromCaller, { once: true });
    if (request.signal?.aborted) abortFromCaller();
    try {
      // `redirect: "manual"`: the API never redirects, and the key must never follow a redirect.
      const response = await this.#fetch(url, { method: request.method, headers, body, redirect: "manual", signal: timeout.signal });
      if (isRedirect(response)) {
        throw new QrSuisseRedirectError({
          method: request.method,
          path: url.pathname,
          status: response.status,
          location: response.headers.get("location") ?? undefined,
        });
      }
      const rateLimit = parseRateLimitHeaders(response.headers);
      if (response.ok || response.status === 304) {
        return { result: await read(response), response, rateLimit };
      }
      return await toApiError(response, rateLimit);
    } catch (cause) {
      if (cause instanceof QrSuisseError || request.signal?.aborted) throw cause;
      const timedOut = timeout.signal.aborted;
      const reason = timedOut ? `timed out after ${this.#timeoutMs} ms` : "failed";
      throw new QrSuisseConnectionError(`${request.method} ${url.pathname} ${reason}.`, { cause, timedOut });
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function isRedirect(response: Response): boolean {
  // `opaqueredirect`: some runtimes hide the status of a redirect that is not followed.
  return response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400 && response.status !== 304);
}

/** Body of a successful JSON response; a body that is not JSON (proxy, captive portal) gives `unexpected_response`. */
async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new QrSuisseApiError({
      status: response.status,
      code: "unexpected_response",
      message: `Unexpected ${response.status} response from the QR Suisse API (not JSON).`,
      body: text,
      retryAfter: undefined,
      rateLimit: parseRateLimitHeaders(response.headers),
    });
  }
}

function validateApiKey(apiKey: unknown): string {
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new QrSuisseArgumentError("apiKey is required: create a key in the QR Suisse dashboard and read it from your configuration.");
  }
  if (/\s/.test(apiKey)) {
    throw new QrSuisseArgumentError("apiKey must not contain spaces or line breaks: copy it exactly as shown in the dashboard.");
  }
  return apiKey;
}

function validateBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new QrSuisseArgumentError(`baseUrl is not a valid URL: ${baseUrl}`);
  }
  if (url.username || url.password) {
    throw new QrSuisseArgumentError("baseUrl must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new QrSuisseArgumentError("baseUrl must not contain a query string or a fragment.");
  }
  const isLoopback = LOOPBACK_HOSTNAMES.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    // A key sent over HTTP travels in clear text: refuse before sending anything.
    throw new QrSuisseArgumentError("baseUrl must use https:// (plain http:// is only accepted for localhost).");
  }
  return url.href.replace(/\/+$/, "");
}

function qrCodePath(id: string): string {
  if (typeof id !== "string" || id.trim() === "") {
    throw new QrSuisseArgumentError("A QR code id is required.");
  }
  return `/qr-codes/${encodeURIComponent(id)}`;
}

function listQuery(params: ListQrCodesParams): URLSearchParams {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    query.set(name, Array.isArray(value) ? value.join(",") : String(value));
  }
  return query;
}

async function toApiError(response: Response, rateLimit: RateLimitState): Promise<QrSuisseApiError> {
  const text = await response.text().catch(() => "");
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // Not JSON: kept as text in `body`.
  }
  const code = isRecord(body) && typeof body.error === "string" ? body.error : undefined;
  const message = code !== undefined && isRecord(body) && typeof body.message === "string" ? body.message : undefined;
  return new QrSuisseApiError({
    status: response.status,
    code: code ?? "unexpected_response",
    message: message ?? `Unexpected ${response.status} response from the QR Suisse API.`,
    body,
    retryAfter: parseRetryAfter(response.headers),
    rateLimit,
  });
}

function attachmentFilename(contentDisposition: string | null): string | undefined {
  const match = contentDisposition?.match(/filename="([^"]+)"/);
  return match?.[1];
}

function sleep(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
