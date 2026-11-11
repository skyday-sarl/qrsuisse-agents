import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BASE_URL,
  QrSuisseApiError,
  QrSuisseClient,
  QrSuisseArgumentError,
  QrSuisseConnectionError,
  QrSuisseRedirectError,
  SDK_VERSION,
  isQrSuisseApiError,
} from "../src/index.js";
import { FAKE_API_KEY, QR_CODE, callOf, clientWith, jsonResponse, mockFetch } from "./helpers.js";

const RATE_LIMIT_HEADERS = {
  "RateLimit-Policy": '"api-request";q=30;w=60',
  RateLimit: '"api-request";r=29;t=60',
};

describe("QrSuisseClient configuration", () => {
  it("uses the production API by default", () => {
    expect(clientWith(mockFetch()).baseUrl).toBe(DEFAULT_BASE_URL);
  });

  it("refuses a missing key or a key with spaces", () => {
    expect(() => new QrSuisseClient({ apiKey: "" })).toThrow(TypeError);
    expect(() => new QrSuisseClient({ apiKey: `${FAKE_API_KEY}\n` })).toThrow(/spaces/);
  });

  it("refuses plain HTTP, except on localhost", () => {
    expect(() => clientWith(mockFetch(), { baseUrl: "http://app.qrsuisse.ch/api/v1" })).toThrow(/https/);
    expect(clientWith(mockFetch(), { baseUrl: "http://localhost:3000/api/v1/" }).baseUrl).toBe("http://localhost:3000/api/v1");
    expect(clientWith(mockFetch(), { baseUrl: "http://127.0.0.1:3000/api/v1" }).baseUrl).toBe("http://127.0.0.1:3000/api/v1");
  });

  it("refuses credentials or a query string in the base URL", () => {
    expect(() => clientWith(mockFetch(), { baseUrl: "https://user:pass@app.qrsuisse.ch/api/v1" })).toThrow(/credentials/);
    expect(() => clientWith(mockFetch(), { baseUrl: "https://app.qrsuisse.ch/api/v1?key=x" })).toThrow(/query/);
  });

  it("never exposes the key when the client is printed or serialised", async () => {
    const client = clientWith(mockFetch());
    const { inspect } = await import("node:util");
    expect(inspect(client)).not.toContain("fake-secret");
    expect(JSON.stringify(client)).not.toContain("fake-secret");
  });

  it("keeps SDK_VERSION equal to the package version", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(SDK_VERSION).toBe(packageJson.version);
  });
});

describe("requests", () => {
  it("sends the key in the Authorization header only, never in the URL", async () => {
    const fetchMock = mockFetch(jsonResponse(QR_CODE, { headers: RATE_LIMIT_HEADERS }));
    await clientWith(fetchMock).getQrCode(QR_CODE.id);

    const { url, init, headers } = callOf(fetchMock);
    expect(url.href).toBe(`${DEFAULT_BASE_URL}/qr-codes/${QR_CODE.id}`);
    expect(url.href).not.toContain(FAKE_API_KEY);
    expect(headers.Authorization).toBe(`Bearer ${FAKE_API_KEY}`);
    expect(headers["User-Agent"]).toBe(`qrsuisse-sdk-js/${SDK_VERSION}`);
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
  });

  it("returns the data with the rate limit state", async () => {
    const fetchMock = mockFetch(jsonResponse(QR_CODE, { headers: RATE_LIMIT_HEADERS }));
    const response = await clientWith(fetchMock).getQrCode(QR_CODE.id);
    expect(response.data).toEqual(QR_CODE);
    expect(response.status).toBe(200);
    expect(response.rateLimit).toEqual([{ name: "api-request", limit: 30, windowSeconds: 60, remaining: 29, resetSeconds: 60 }]);
  });

  it("encodes the QR code id in the path", async () => {
    const fetchMock = mockFetch(jsonResponse(QR_CODE));
    await clientWith(fetchMock).getQrCode("../usage");
    expect(callOf(fetchMock).url.pathname).toBe("/api/v1/qr-codes/..%2Fusage");
  });

  it("refuses an empty id without calling the API", async () => {
    const fetchMock = mockFetch();
    await expect(clientWith(fetchMock).getQrCode(" ")).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists QR codes with filters, comma-separated types and a boolean active", async () => {
    const fetchMock = mockFetch(jsonResponse({ data: [QR_CODE], nextCursor: null }));
    const { data } = await clientWith(fetchMock).listQrCodes({
      active: true,
      type: ["vcard", "email"],
      q: "genève",
      sort: "label_asc",
      limit: 50,
      createdFrom: "2026-10-01T08:00:00+02:00",
    });
    const { url } = callOf(fetchMock);
    expect(url.searchParams.get("active")).toBe("true");
    expect(url.searchParams.get("type")).toBe("vcard,email");
    expect(url.searchParams.get("q")).toBe("genève");
    expect(url.searchParams.get("sort")).toBe("label_asc");
    expect(url.searchParams.get("limit")).toBe("50");
    // The `+` of the offset must reach the API encoded as %2B.
    expect(url.search).toContain("createdFrom=2026-10-01T08%3A00%3A00%2B02%3A00");
    expect(data.data).toHaveLength(1);
  });

  it("pages through every QR code, sending the same filters with each cursor", async () => {
    const second = { ...QR_CODE, id: "cm2f8k3qz0002xyz9abcd1234" };
    const fetchMock = mockFetch(
      jsonResponse({ data: [QR_CODE], nextCursor: "cursor-1" }),
      jsonResponse({ data: [second], nextCursor: null }),
    );
    const ids: string[] = [];
    for await (const qrCode of clientWith(fetchMock).listAllQrCodes({ active: "true", sort: "created_asc" })) {
      ids.push(qrCode.id);
    }
    expect(ids).toEqual([QR_CODE.id, second.id]);
    expect(callOf(fetchMock, 0).url.searchParams.has("cursor")).toBe(false);
    const secondCall = callOf(fetchMock, 1).url.searchParams;
    expect(secondCall.get("cursor")).toBe("cursor-1");
    expect(secondCall.get("active")).toBe("true");
    expect(secondCall.get("sort")).toBe("created_asc");
  });

  it("creates a QR code with an Idempotency-Key and reports a replay", async () => {
    const fetchMock = mockFetch(jsonResponse(QR_CODE, { status: 201, headers: { "Idempotent-Replayed": "true" } }));
    const input = { type: "URL", label: "Poster", destinationUrl: "https://www.example.ch" } as const;
    const response = await clientWith(fetchMock).createQrCode(input, { idempotencyKey: "3f1c2b0e-8a4d-4c6e-9b7a-1d2e3f4a5b6c" });

    const { init, headers } = callOf(fetchMock);
    expect(init.method).toBe("POST");
    expect(headers["Idempotency-Key"]).toBe("3f1c2b0e-8a4d-4c6e-9b7a-1d2e3f4a5b6c");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual(input);
    expect(response.status).toBe(201);
    expect(response.replayed).toBe(true);
  });

  it("creates without Idempotency-Key when none is given", async () => {
    const fetchMock = mockFetch(jsonResponse(QR_CODE, { status: 201 }));
    const response = await clientWith(fetchMock).createQrCode({ type: "VCARD", label: "Card", firstName: "Anna", lastName: "Muster" });
    expect(callOf(fetchMock).headers).not.toHaveProperty("Idempotency-Key");
    expect(response.replayed).toBe(false);
  });

  it("refuses a malformed Idempotency-Key without calling the API", async () => {
    const fetchMock = mockFetch();
    await expect(
      clientWith(fetchMock).createQrCode({ type: "URL", label: "x", destinationUrl: "https://x.ch" }, { idempotencyKey: "has space" }),
    ).rejects.toThrow(/idempotencyKey/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates with PATCH and the partial body", async () => {
    const fetchMock = mockFetch(jsonResponse({ ...QR_CODE, active: false }));
    const { data } = await clientWith(fetchMock).updateQrCode(QR_CODE.id, { active: false });
    const { init } = callOf(fetchMock);
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe('{"active":false}');
    expect(data.active).toBe(false);
  });

  it("deletes with DELETE and returns no data", async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));
    const response = await clientWith(fetchMock).deleteQrCode(QR_CODE.id);
    expect(callOf(fetchMock).init.method).toBe("DELETE");
    expect(response).toMatchObject({ status: 204, data: null });
  });

  it("reads statistics, usage and templates", async () => {
    const stats = { qrCodeId: QR_CODE.id, scanCountTotal: 3, dailyStats: [{ date: "2026-10-11T00:00:00.000Z", count: 3 }] };
    const usage = { used: 1, monthlyQuota: 5, packCreditsRemaining: 0, resetAt: "2026-12-01T00:00:00.000Z" };
    const templates = { data: [], nextCursor: null };
    const fetchMock = mockFetch(jsonResponse(stats), jsonResponse(usage), jsonResponse(templates));
    const client = clientWith(fetchMock);

    expect((await client.getQrCodeStats(QR_CODE.id)).data).toEqual(stats);
    expect((await client.getUsage()).data).toEqual(usage);
    expect((await client.listTemplates()).data).toEqual(templates);
    expect(fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([
      `/api/v1/qr-codes/${QR_CODE.id}/stats`,
      "/api/v1/usage",
      "/api/v1/templates",
    ]);
  });
});

describe("images", () => {
  it("returns PNG bytes with the ETag and the file name", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = mockFetch(
      new Response(bytes, {
        headers: {
          "Content-Type": "image/png",
          ETag: '"abc"',
          "Content-Disposition": 'attachment; filename="qr-suisse-AbC123_-xy.png"',
        },
      }),
    );
    const image = await clientWith(fetchMock).getQrCodeImage(QR_CODE.id, { size: 512 });
    expect(callOf(fetchMock).url.search).toBe("?size=512");
    expect(image.notModified).toBe(false);
    if (image.notModified) return;
    expect(image.data).toBeInstanceOf(Uint8Array);
    expect([...image.data]).toEqual([...bytes]);
    expect(image.etag).toBe('"abc"');
    expect(image.filename).toBe("qr-suisse-AbC123_-xy.png");
  });

  it("returns SVG as text", async () => {
    const fetchMock = mockFetch(new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }));
    const image = await clientWith(fetchMock).getQrCodeImage(QR_CODE.id, { format: "svg", style: "none" });
    expect(callOf(fetchMock).url.searchParams.get("format")).toBe("svg");
    expect(callOf(fetchMock).url.searchParams.get("style")).toBe("none");
    expect(image.data).toBe("<svg/>");
  });

  it("returns notModified on 304 when If-None-Match is sent", async () => {
    const fetchMock = mockFetch(new Response(null, { status: 304, headers: { ETag: '"abc"' } }));
    const image = await clientWith(fetchMock).getQrCodeImage(QR_CODE.id, { ifNoneMatch: '"abc"' });
    expect(callOf(fetchMock).headers["If-None-Match"]).toBe('"abc"');
    expect(image).toMatchObject({ notModified: true, data: null, status: 304, etag: '"abc"' });
  });
});

describe("errors", () => {
  it("throws a typed error with the API code, the rate limit state and Retry-After", async () => {
    const fetchMock = mockFetch(
      jsonResponse(
        { error: "forbidden", message: "Cette clé API n'a pas le droit requis pour cette opération." },
        { status: 403, headers: RATE_LIMIT_HEADERS },
      ),
    );
    const error = await clientWith(fetchMock).getUsage().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QrSuisseApiError);
    expect(isQrSuisseApiError(error, "forbidden")).toBe(true);
    expect(error).toMatchObject({ status: 403, code: "forbidden", retryAfter: undefined });
    expect((error as QrSuisseApiError).rateLimit[0]?.remaining).toBe(29);
  });

  it("exposes resetAt for quota_exceeded and never retries it", async () => {
    const fetchMock = mockFetch(
      jsonResponse(
        { error: "quota_exceeded", message: "Quota mensuel de créations API atteint.", resetAt: "2026-12-01T00:00:00.000Z" },
        { status: 429, headers: { "Retry-After": "86400" } },
      ),
    );
    const client = clientWith(fetchMock, { retry: { maxRetries: 3, maxDelaySeconds: 100_000 } });
    const error = await client.createQrCode({ type: "URL", label: "x", destinationUrl: "https://x.ch" }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "quota_exceeded", resetAt: "2026-12-01T00:00:00.000Z", retryAfter: 86400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry 429 rate_limited by default", async () => {
    const fetchMock = mockFetch(jsonResponse({ error: "rate_limited", message: "…" }, { status: 429, headers: { "Retry-After": "1" } }));
    await expect(clientWith(fetchMock).getUsage()).rejects.toMatchObject({ code: "rate_limited", retryAfter: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits for Retry-After and retries 429 rate_limited when enabled", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = mockFetch(
        jsonResponse({ error: "rate_limited", message: "…" }, { status: 429, headers: { "Retry-After": "2" } }),
        jsonResponse({ used: 0, monthlyQuota: 5, packCreditsRemaining: 0, resetAt: "2026-12-01T00:00:00.000Z" }),
      );
      const pending = clientWith(fetchMock, { retry: { maxRetries: 1 } }).getUsage();
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      const response = await pending;
      expect(response.data.used).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a creation with the same body and the same Idempotency-Key", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = mockFetch(
        jsonResponse({ error: "idempotency_in_progress", message: "…" }, { status: 409, headers: { "Retry-After": "1" } }),
        jsonResponse(QR_CODE, { status: 201, headers: { "Idempotent-Replayed": "true" } }),
      );
      const pending = clientWith(fetchMock, { retry: { maxRetries: 2 } }).createQrCode(
        { type: "URL", label: "x", destinationUrl: "https://x.ch" },
        { idempotencyKey: "key-1" },
      );
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await pending).replayed).toBe(true);
      expect(callOf(fetchMock, 1).headers["Idempotency-Key"]).toBe("key-1");
      expect(callOf(fetchMock, 1).init.body).toBe(callOf(fetchMock, 0).init.body);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait longer than maxDelaySeconds", async () => {
    const fetchMock = mockFetch(jsonResponse({ error: "rate_limited", message: "…" }, { status: 429, headers: { "Retry-After": "120" } }));
    const client = clientWith(fetchMock, { retry: { maxRetries: 1, maxDelaySeconds: 60 } });
    await expect(client.getUsage()).rejects.toMatchObject({ code: "rate_limited", retryAfter: 120 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries a 401", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ error: "unauthorized", message: "Authentification invalide ou absente." }, { status: 401, headers: { "Retry-After": "1" } }),
    );
    await expect(clientWith(fetchMock, { retry: { maxRetries: 3 } }).getUsage()).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an unknown future error code as is", async () => {
    const fetchMock = mockFetch(jsonResponse({ error: "some_new_code", message: "…" }, { status: 400 }));
    await expect(clientWith(fetchMock).getUsage()).rejects.toMatchObject({ code: "some_new_code" });
  });

  it("reports a response outside the error format as unexpected_response", async () => {
    const fetchMock = mockFetch(new Response("<html>Bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }));
    const error = await clientWith(fetchMock).getUsage().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 502, code: "unexpected_response", body: "<html>Bad gateway</html>" });
    expect((error as Error).message).not.toContain(FAKE_API_KEY);
  });

  it("wraps a network failure in QrSuisseConnectionError without the key", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const error = await clientWith(fetchMock as never).getUsage().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QrSuisseConnectionError);
    expect(error).toMatchObject({ timedOut: false, message: "GET /api/v1/usage failed." });
  });

  it("aborts after the timeout", async () => {
    const fetchMock = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const error = await clientWith(fetchMock as never, { timeoutMs: 10 }).getUsage().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QrSuisseConnectionError);
    expect(error).toMatchObject({ timedOut: true });
  });

  it("covers the reading of the body with the timeout", async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { headers: { "Content-Type": "application/json" } });
    });
    const error = await clientWith(fetchMock as never, { timeoutMs: 10 }).getUsage().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QrSuisseConnectionError);
    expect(error).toMatchObject({ timedOut: true });
  });

  it("gives the system error code of a connection failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    });
    const error = await clientWith(fetchMock as never).getUsage().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ causeCode: "ECONNREFUSED", timedOut: false });
  });

  it("refuses a redirect with its own error, without following it", async () => {
    const fetchMock = mockFetch(new Response(null, { status: 301, headers: { Location: "https://app.qrsuisse.ch/api/v1/usage" } }));
    const error = await clientWith(fetchMock).getUsage().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QrSuisseRedirectError);
    expect(error).toMatchObject({ code: "redirect_refused", status: 301, location: "https://app.qrsuisse.ch/api/v1/usage" });
    expect((error as Error).message).toContain("/api/v1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a successful response that is not JSON as unexpected_response", async () => {
    const fetchMock = mockFetch(new Response("<html>Captive portal</html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    const error = await clientWith(fetchMock).getUsage().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QrSuisseApiError);
    expect(error).toMatchObject({ status: 200, code: "unexpected_response", body: "<html>Captive portal</html>" });
  });

  it("throws QrSuisseArgumentError, a TypeError, for an invalid argument", async () => {
    await expect(clientWith(mockFetch()).getQrCode("")).rejects.toBeInstanceOf(QrSuisseArgumentError);
    expect(() => new QrSuisseClient({ apiKey: "" })).toThrow(QrSuisseArgumentError);
  });

  it("calls onRetry before each wait", async () => {
    vi.useFakeTimers();
    try {
      const onRetry = vi.fn();
      const fetchMock = mockFetch(
        jsonResponse({ error: "rate_limited", message: "…" }, { status: 429, headers: { "Retry-After": "3" } }),
        jsonResponse({ used: 0 }),
      );
      const pending = clientWith(fetchMock, { retry: { maxRetries: 2, onRetry } }).getUsage();
      await vi.advanceTimersByTimeAsync(3_000);
      await pending;
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry.mock.calls[0]?.[0]).toMatchObject({ delaySeconds: 3, attempt: 1, maxRetries: 2, error: { code: "rate_limited" } });
    } finally {
      vi.useRealTimers();
    }
  });
});
