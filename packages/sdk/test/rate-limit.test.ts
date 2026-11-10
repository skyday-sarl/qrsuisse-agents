import { describe, expect, it } from "vitest";
import { parseRateLimitHeaders, parseRetryAfter } from "../src/index.js";

describe("parseRateLimitHeaders", () => {
  it("reads every bucket of RateLimit-Policy and RateLimit", () => {
    const headers = new Headers({
      "RateLimit-Policy": '"api-request";q=30;w=60, "api-create";q=8;w=60',
      RateLimit: '"api-request";r=29;t=60, "api-create";r=7;t=42',
    });
    expect(parseRateLimitHeaders(headers)).toEqual([
      { name: "api-request", limit: 30, windowSeconds: 60, remaining: 29, resetSeconds: 60 },
      { name: "api-create", limit: 8, windowSeconds: 60, remaining: 7, resetSeconds: 42 },
    ]);
  });

  it("returns an empty list without the headers (e.g. a 401)", () => {
    expect(parseRateLimitHeaders(new Headers())).toEqual([]);
  });

  it("ignores unreadable parameters instead of failing", () => {
    const headers = new Headers({ RateLimit: '"api-image";r=abc;t=5, ;, "";r=1' });
    expect(parseRateLimitHeaders(headers)).toEqual([{ name: "api-image", resetSeconds: 5 }]);
  });
});

describe("parseRetryAfter", () => {
  it("reads a number of seconds", () => {
    expect(parseRetryAfter(new Headers({ "Retry-After": "17" }))).toBe(17);
  });

  it("reads an HTTP date", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(parseRetryAfter(new Headers({ "Retry-After": "Tue, 10 Nov 2026 12:00:30 GMT" }), now)).toBe(30);
  });

  it("returns undefined when absent or unreadable", () => {
    expect(parseRetryAfter(new Headers())).toBeUndefined();
    expect(parseRetryAfter(new Headers({ "Retry-After": "soon" }))).toBeUndefined();
  });
});
