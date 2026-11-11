import { vi } from "vitest";
import { QrSuisseClient, type QrSuisseClientOptions } from "../src/index.js";

/** Fictitious key: same shape as a real key, never valid. */
export const FAKE_API_KEY = "qrs_live_testkeyid0001.fake-secret-for-unit-tests";

export const QR_CODE = {
  id: "cm2f8k3qz0001xyz9abcd1234",
  type: "URL",
  label: "Waiting room poster",
  active: true,
  scanCount: 42,
  slug: "AbC123_-xy",
  publicUrl: "https://app.qrsuisse.ch/r/AbC123_-xy",
  createdAt: "2026-10-01T08:30:00.000Z",
  updatedAt: "2026-10-12T14:05:00.000Z",
  templateId: null,
  style: { foreground: "#000000", background: "#FFFFFF", moduleShape: "SQUARE", eyeShape: "SQUARE", hasLogo: false },
  destinationUrl: "https://www.example.ch/appointments",
} as const;

export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

/** A `fetch` mock that answers the given responses in order and records each call. */
export function mockFetch(...responses: Response[]) {
  const queue = [...responses];
  return vi.fn(async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const next = queue.shift();
    if (!next) throw new Error("Unexpected fetch call");
    return next;
  });
}

export type FetchMock = ReturnType<typeof mockFetch>;

export function clientWith(fetchMock: FetchMock, options: Partial<QrSuisseClientOptions> = {}): QrSuisseClient {
  return new QrSuisseClient({ apiKey: FAKE_API_KEY, fetch: fetchMock as unknown as typeof fetch, ...options });
}

export function callOf(fetchMock: FetchMock, index = 0): { url: URL; init: RequestInit; headers: Record<string, string> } {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`No fetch call #${index}`);
  const [input, init = {}] = call;
  return { url: new URL(String(input)), init, headers: (init.headers ?? {}) as Record<string, string> };
}
