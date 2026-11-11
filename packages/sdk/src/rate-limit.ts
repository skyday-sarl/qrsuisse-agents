// Reading of the rate limit headers of the API (spec 1.3.0, "Rate limiting").
//
// `RateLimit-Policy` and `RateLimit` follow the IETF draft `draft-ietf-httpapi-ratelimit-headers`
// (a list of structured-field items: `"api-request";q=30;w=60, "api-create";q=8;w=60`). The API
// documents that this format may still change: only `429 rate_limited` and `Retry-After` are
// authoritative, so a header that cannot be read is ignored, never an error.

/** State of one rate limit bucket after a request. Each figure is absent if the API did not give it. */
export interface RateLimitBucket {
  /** Name of the bucket, for example `api-request`, `api-create` or `api-image`. */
  name: string;
  /** Requests allowed per window (`q` of `RateLimit-Policy`). */
  limit?: number;
  /** Length of the window in seconds (`w` of `RateLimit-Policy`). */
  windowSeconds?: number;
  /** Requests remaining in the current window (`r` of `RateLimit`). */
  remaining?: number;
  /** Seconds until the window reopens (`t` of `RateLimit`). */
  resetSeconds?: number;
}

/** Buckets consulted by a request, in the order given by the API. Empty when the headers are absent (e.g. on a `401`). */
export type RateLimitState = RateLimitBucket[];

interface StructuredItem {
  name: string;
  parameters: Map<string, number>;
}

/** Splits a structured-field list on the commas that are outside quoted strings. */
function splitListMembers(header: string): string[] {
  const members: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const character of header) {
    if (character === '"') inQuotes = !inQuotes;
    if (character === "," && !inQuotes) {
      members.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  members.push(current);
  return members.map((member) => member.trim()).filter((member) => member.length > 0);
}

function parseStructuredList(header: string | null): StructuredItem[] {
  if (!header) return [];
  const items: StructuredItem[] = [];
  for (const member of splitListMembers(header)) {
    const [rawName = "", ...rawParameters] = member.split(";").map((part) => part.trim());
    const name = rawName.replace(/^"(.*)"$/, "$1");
    if (!name) continue;
    const parameters = new Map<string, number>();
    for (const rawParameter of rawParameters) {
      const [key, value] = rawParameter.split("=").map((part) => part.trim());
      const numericValue = Number(value);
      if (key && value !== undefined && Number.isFinite(numericValue)) parameters.set(key, numericValue);
    }
    items.push({ name, parameters });
  }
  return items;
}

/** Reads `RateLimit-Policy` and `RateLimit` into one entry per bucket. */
export function parseRateLimitHeaders(headers: Headers): RateLimitState {
  const buckets = new Map<string, RateLimitBucket>();
  const bucketNamed = (name: string): RateLimitBucket => {
    let bucket = buckets.get(name);
    if (!bucket) {
      bucket = { name };
      buckets.set(name, bucket);
    }
    return bucket;
  };

  for (const { name, parameters } of parseStructuredList(headers.get("ratelimit-policy"))) {
    const bucket = bucketNamed(name);
    if (parameters.has("q")) bucket.limit = parameters.get("q");
    if (parameters.has("w")) bucket.windowSeconds = parameters.get("w");
  }
  for (const { name, parameters } of parseStructuredList(headers.get("ratelimit"))) {
    const bucket = bucketNamed(name);
    if (parameters.has("r")) bucket.remaining = parameters.get("r");
    if (parameters.has("t")) bucket.resetSeconds = parameters.get("t");
  }
  return [...buckets.values()];
}

/**
 * Reads `Retry-After` in seconds: the API sends a number of seconds; an HTTP date (RFC 9110) is
 * also accepted. `undefined` when absent or unreadable.
 */
export function parseRetryAfter(headers: Headers, now: number = Date.now()): number | undefined {
  const value = headers.get("retry-after")?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}
