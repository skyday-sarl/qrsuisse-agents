import type { RateLimitState } from "./rate-limit.js";
import type { ApiErrorCode } from "./types.js";

/**
 * Code of an error answered by the API. A documented code (`ApiErrorCode`), or, for a code added
 * by a later minor version of the API, its raw value. `unexpected_response` is not an API code:
 * the SDK uses it when the response is not in the documented error format (for example an HTML
 * page from a proxy).
 */
export type QrSuisseErrorCode = ApiErrorCode | "unexpected_response" | (string & {});

/** Base class of every error thrown by the SDK. */
export class QrSuisseError extends Error {
  override name = "QrSuisseError";
}

/**
 * The API answered with an error status. Base your logic on `code`, never on `message`: the
 * message is a reading aid, in French, that may change without notice.
 */
export class QrSuisseApiError extends QrSuisseError {
  override name = "QrSuisseApiError";

  /** HTTP status of the response. */
  readonly status: number;
  /** Stable error code (`error` field of the response body). */
  readonly code: QrSuisseErrorCode;
  /** Full response body, including possible details such as `resetAt`. */
  readonly body: unknown;
  /** Seconds to wait, from `Retry-After`, when the API gave it. */
  readonly retryAfter: number | undefined;
  /** Rate limit buckets of the response (empty on a `401`). */
  readonly rateLimit: RateLimitState;
  /** For `quota_exceeded`: date when the monthly quota is reset (ISO 8601). */
  readonly resetAt: string | undefined;

  constructor(details: {
    status: number;
    code: QrSuisseErrorCode;
    message: string;
    body: unknown;
    retryAfter: number | undefined;
    rateLimit: RateLimitState;
  }) {
    super(details.message);
    this.status = details.status;
    this.code = details.code;
    this.body = details.body;
    this.retryAfter = details.retryAfter;
    this.rateLimit = details.rateLimit;
    const resetAt = isRecord(details.body) ? details.body.resetAt : undefined;
    this.resetAt = typeof resetAt === "string" ? resetAt : undefined;
  }
}

/** The request did not get a complete answer: network failure, DNS, TLS or timeout. */
export class QrSuisseConnectionError extends QrSuisseError {
  override name = "QrSuisseConnectionError";

  /** `true` when the request was aborted by the SDK timeout. */
  readonly timedOut: boolean;
  /** System error code of the cause when there is one, for example `ECONNREFUSED` or `CERT_HAS_EXPIRED`. */
  readonly causeCode: string | undefined;

  constructor(message: string, options: { cause: unknown; timedOut: boolean }) {
    super(message, { cause: options.cause });
    this.timedOut = options.timedOut;
    this.causeCode = systemErrorCode(options.cause);
  }
}

/**
 * The server answered with a redirect. The client never follows one, so that the API key is
 * never sent to another address: the API itself never redirects, so the base URL is usually wrong
 * (`http://` instead of `https://`, or a path without `/api/v1`).
 */
export class QrSuisseRedirectError extends QrSuisseError {
  override name = "QrSuisseRedirectError";

  readonly code = "redirect_refused";
  /** HTTP status of the redirect (`0` when the runtime hides it). */
  readonly status: number;
  /** Target of the redirect (`Location` header), when the runtime gives it. */
  readonly location: string | undefined;

  constructor(details: { method: string; path: string; status: number; location: string | undefined }) {
    super(
      `${details.method} ${details.path}: the server answered with a redirect${details.location ? ` to ${details.location}` : ""}, ` +
        "which the client never follows so that the API key is not sent elsewhere. " +
        "Check the base URL: it must be the https:// address of the API, ending with /api/v1.",
    );
    this.status = details.status;
    this.location = details.location;
  }
}

/** Invalid argument, detected before anything is sent (missing key, `http://` address, malformed `idempotencyKey`...). */
export class QrSuisseArgumentError extends TypeError {
  override name = "QrSuisseArgumentError";
}

/** `code` of a Node.js system error, looked for on the error and on its cause (`fetch failed` wraps it). */
function systemErrorCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; isRecord(current); depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    if (depth >= 3) return undefined;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** `true` if `error` is an API error, optionally with the given code. */
export function isQrSuisseApiError(error: unknown, code?: QrSuisseErrorCode): error is QrSuisseApiError {
  return error instanceof QrSuisseApiError && (code === undefined || error.code === code);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
