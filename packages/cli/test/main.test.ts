import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CLI_VERSION } from "../src/version.js";
import { EXIT_API_ERROR, EXIT_OK, EXIT_USAGE_ERROR, main, type CliEnvironment } from "../src/main.js";

/** Fictitious key: same shape as a real key, never valid. */
const FAKE_API_KEY = "qrs_live_testkeyid0001.fake-secret-for-unit-tests";
const QR_CODE = { id: "cm2f8k3qz0001xyz9abcd1234", type: "URL", label: "Poster", active: true };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** Runs the CLI with a mocked fetch; returns the exit code, the output and the requests sent. */
async function run(argv: string[], options: { responses?: Response[]; env?: Record<string, string>; files?: Record<string, string>; stdin?: string } = {}) {
  const queue = [...(options.responses ?? [])];
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error("Unexpected fetch call");
    return next;
  });
  let stdout = "";
  const stdoutChunks: (string | Uint8Array)[] = [];
  let stderr = "";
  const written = new Map<string, string | Uint8Array>();
  const io: CliEnvironment = {
    env: { QRSUISSE_API_KEY: FAKE_API_KEY, ...options.env },
    stdout: {
      write: (chunk) => {
        stdoutChunks.push(chunk);
        if (typeof chunk === "string") stdout += chunk;
      },
    },
    stderr: { write: (chunk) => (stderr += chunk) },
    readFile: async (path) => {
      const content = options.files?.[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    readStdin: async () => options.stdin ?? "",
    writeFile: async (path, data) => {
      written.set(path, data);
    },
    randomUUID: () => "00000000-0000-4000-8000-000000000001",
    fetch: fetchMock as unknown as typeof fetch,
  };
  const code = await main(argv, io);
  const requests = fetchMock.mock.calls.map(([input, init = {}]) => ({
    url: new URL(String(input)),
    method: init.method,
    headers: (init.headers ?? {}) as Record<string, string>,
    body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
  }));
  return { code, stdout, stdoutChunks, stderr, requests, written };
}

describe("help, version and key handling", () => {
  it("prints the version", async () => {
    const result = await run(["--version"]);
    expect(result).toMatchObject({ code: EXIT_OK, stdout: `${CLI_VERSION}\n` });
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(CLI_VERSION).toBe(packageJson.version);
  });

  it("prints the help, which says there is no delete command", async () => {
    const result = await run(["--help"], { env: { QRSUISSE_API_KEY: "" } });
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("QRSUISSE_API_KEY");
    expect(result.stdout).toContain("There is no delete command");
  });

  it("prints the help of a command", async () => {
    const result = await run(["qr", "create", "--help"]);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("--idempotency-key");
    expect(result.requests).toHaveLength(0);
  });

  it("exits with 2 and the help on stderr without a command", async () => {
    const result = await run([]);
    expect(result.code).toBe(EXIT_USAGE_ERROR);
    expect(result.stderr).toContain("Usage:");
  });

  it("refuses an API key given as an argument, without calling the API", async () => {
    for (const argument of ["--api-key=x", "--apiKey", "--key", "--token=abc"]) {
      const result = await run(["usage", argument]);
      expect(result.code).toBe(EXIT_USAGE_ERROR);
      expect(result.stderr).toContain("QRSUISSE_API_KEY");
      expect(result.requests).toHaveLength(0);
    }
  });

  it("asks for QRSUISSE_API_KEY when it is missing", async () => {
    const result = await run(["usage"], { env: { QRSUISSE_API_KEY: "" } });
    expect(result.code).toBe(EXIT_USAGE_ERROR);
    expect(result.stderr).toContain("QRSUISSE_API_KEY");
  });

  it("has no delete command", async () => {
    const result = await run(["qr", "delete", QR_CODE.id]);
    expect(result.code).toBe(EXIT_USAGE_ERROR);
    expect(result.requests).toHaveLength(0);
  });

  it("refuses an option of another command", async () => {
    const result = await run(["qr", "get", QR_CODE.id, "--archive"]);
    expect(result.code).toBe(EXIT_USAGE_ERROR);
    expect(result.stderr).toContain("--archive");
  });

  it("refuses a plain-HTTP base URL other than localhost", async () => {
    const result = await run(["usage", "--base-url", "http://app.qrsuisse.ch/api/v1"]);
    expect(result.code).toBe(EXIT_USAGE_ERROR);
    expect(result.requests).toHaveLength(0);
  });
});

describe("commands", () => {
  it("usage: prints the quota as JSON, sending the key in the header", async () => {
    const usage = { used: 1, monthlyQuota: 5, packCreditsRemaining: 0, resetAt: "2026-12-01T00:00:00.000Z" };
    const result = await run(["usage"], { responses: [jsonResponse(usage)] });
    expect(result.code).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout)).toEqual(usage);
    expect(result.requests[0]?.url.pathname).toBe("/api/v1/usage");
    expect(result.requests[0]?.headers.Authorization).toBe(`Bearer ${FAKE_API_KEY}`);
    expect(result.stdout).not.toContain("fake-secret");
  });

  it("--compact prints a single line", async () => {
    const result = await run(["templates", "--compact"], { responses: [jsonResponse({ data: [], nextCursor: null })] });
    expect(result.stdout).toBe('{"data":[],"nextCursor":null}\n');
  });

  it("uses QRSUISSE_API_BASE_URL", async () => {
    const result = await run(["usage"], {
      env: { QRSUISSE_API_BASE_URL: "http://localhost:3000/api/v1" },
      responses: [jsonResponse({})],
    });
    expect(result.requests[0]?.url.href).toBe("http://localhost:3000/api/v1/usage");
  });

  it("qr list: passes the filters", async () => {
    const result = await run(
      ["qr", "list", "--active", "false", "--type", "vcard,email", "--search", "genève", "--sort", "label_asc", "--limit", "5"],
      { responses: [jsonResponse({ data: [QR_CODE], nextCursor: "c1" })] },
    );
    expect(result.code).toBe(EXIT_OK);
    const query = result.requests[0]?.url.searchParams;
    expect(Object.fromEntries(query ?? [])).toEqual({ active: "false", type: "vcard,email", q: "genève", sort: "label_asc", limit: "5" });
    expect(JSON.parse(result.stdout).nextCursor).toBe("c1");
  });

  it("qr list --all: follows every page", async () => {
    const result = await run(["qr", "list", "--all", "--active", "true"], {
      responses: [jsonResponse({ data: [QR_CODE], nextCursor: "c1" }), jsonResponse({ data: [{ ...QR_CODE, id: "second" }], nextCursor: null })],
    });
    expect(JSON.parse(result.stdout).data.map((qrCode: { id: string }) => qrCode.id)).toEqual([QR_CODE.id, "second"]);
    expect(result.requests[1]?.url.searchParams.get("cursor")).toBe("c1");
    expect(result.requests[1]?.url.searchParams.get("active")).toBe("true");
  });

  it("qr list: refuses an invalid --active", async () => {
    expect((await run(["qr", "list", "--active", "yes"])).code).toBe(EXIT_USAGE_ERROR);
  });

  it("qr get and qr stats: call the right paths", async () => {
    const get = await run(["qr", "get", QR_CODE.id], { responses: [jsonResponse(QR_CODE)] });
    expect(get.requests[0]?.url.pathname).toBe(`/api/v1/qr-codes/${QR_CODE.id}`);
    const stats = await run(["qr", "stats", QR_CODE.id], { responses: [jsonResponse({ qrCodeId: QR_CODE.id, scanCountTotal: 0, dailyStats: [] })] });
    expect(stats.requests[0]?.url.pathname).toBe(`/api/v1/qr-codes/${QR_CODE.id}/stats`);
  });

  it("qr get: requires an id", async () => {
    expect((await run(["qr", "get"])).code).toBe(EXIT_USAGE_ERROR);
  });

  it("qr create: URL QR code with a random Idempotency-Key", async () => {
    const result = await run(["qr", "create", "--label", "Poster", "--url", "https://www.example.ch", "--template-id", "tpl1"], {
      responses: [jsonResponse(QR_CODE, 201)],
    });
    expect(result.code).toBe(EXIT_OK);
    expect(result.requests[0]).toMatchObject({
      method: "POST",
      body: { type: "URL", label: "Poster", destinationUrl: "https://www.example.ch", templateId: "tpl1" },
    });
    expect(result.requests[0]?.headers["Idempotency-Key"]).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("qr create: business card with --no-template and a chosen Idempotency-Key", async () => {
    const result = await run(
      ["qr", "create", "--label", "Card", "--first-name", "Anna", "--last-name", "Muster", "--job-title", "Doctor", "--no-template", "--idempotency-key", "my-key-1"],
      { responses: [jsonResponse(QR_CODE, 201)] },
    );
    expect(result.requests[0]?.body).toEqual({ type: "VCARD", label: "Card", firstName: "Anna", lastName: "Muster", jobTitle: "Doctor", templateId: null });
    expect(result.requests[0]?.headers["Idempotency-Key"]).toBe("my-key-1");
  });

  it("qr create: full body from a file or stdin", async () => {
    const body = { type: "VCARD", label: "Card", firstName: "A", lastName: "B", phones: [{ type: "MOBILE", value: "+41 79 000 00 00" }] };
    const fromFile = await run(["qr", "create", "--body-file", "card.json"], { files: { "card.json": JSON.stringify(body) }, responses: [jsonResponse(QR_CODE, 201)] });
    expect(fromFile.requests[0]?.body).toEqual(body);
    const fromStdin = await run(["qr", "create", "--body-file", "-"], { stdin: JSON.stringify(body), responses: [jsonResponse(QR_CODE, 201)] });
    expect(fromStdin.requests[0]?.body).toEqual(body);
  });

  it("qr create: refuses incomplete or conflicting options without calling the API", async () => {
    for (const argv of [
      ["qr", "create", "--url", "https://x.ch"],
      ["qr", "create", "--label", "x"],
      ["qr", "create", "--label", "x", "--first-name", "A"],
      ["qr", "create", "--label", "x", "--url", "https://x.ch", "--first-name", "A"],
      ["qr", "create", "--body-file", "b.json", "--label", "x"],
      ["qr", "create", "--label", "x", "--url", "https://x.ch", "--template-id", "t", "--no-template"],
    ]) {
      const result = await run(argv, { files: { "b.json": "{}" } });
      expect(result.code, argv.join(" ")).toBe(EXIT_USAGE_ERROR);
      expect(result.requests).toHaveLength(0);
    }
  });

  it("qr create: prints the Idempotency-Key with the error, to retry without a duplicate", async () => {
    const result = await run(["qr", "create", "--label", "x", "--url", "https://x.ch"], {
      responses: [jsonResponse({ error: "idempotency_in_progress", message: "…" }, 409, { "Retry-After": "2" })],
    });
    expect(result.code).toBe(EXIT_API_ERROR);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "idempotency_in_progress",
      message: "…",
      status: 409,
      retryAfter: 2,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("qr update: archive, reactivate and field changes", async () => {
    const archive = await run(["qr", "update", QR_CODE.id, "--archive"], { responses: [jsonResponse(QR_CODE)] });
    expect(archive.requests[0]).toMatchObject({ method: "PATCH", body: { active: false } });
    const reactivate = await run(["qr", "update", QR_CODE.id, "--reactivate", "--label", "New"], { responses: [jsonResponse(QR_CODE)] });
    expect(reactivate.requests[0]?.body).toEqual({ active: true, label: "New" });
    const clear = await run(["qr", "update", QR_CODE.id, "--organization", ""], { responses: [jsonResponse(QR_CODE)] });
    expect(clear.requests[0]?.body).toEqual({ organization: "" });
  });

  it("qr update: refuses an empty update or --archive with --reactivate", async () => {
    expect((await run(["qr", "update", QR_CODE.id])).code).toBe(EXIT_USAGE_ERROR);
    expect((await run(["qr", "update", QR_CODE.id, "--archive", "--reactivate"])).code).toBe(EXIT_USAGE_ERROR);
  });

  it("qr image: writes the file and prints a summary", async () => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg'/>";
    const result = await run(["qr", "image", QR_CODE.id, "--format", "svg", "--output", "qr.svg"], {
      responses: [new Response(svg, { headers: { "Content-Type": "image/svg+xml", ETag: '"e1"' } })],
    });
    expect(result.code).toBe(EXIT_OK);
    expect(result.written.get("qr.svg")).toBe(svg);
    expect(JSON.parse(result.stdout)).toMatchObject({ file: "qr.svg", bytes: svg.length, etag: '"e1"', notModified: false });
  });

  it("qr image: writes raw PNG bytes to stdout with --output -", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const result = await run(["qr", "image", QR_CODE.id, "--size", "256", "--output", "-"], {
      responses: [new Response(bytes, { headers: { "Content-Type": "image/png" } })],
    });
    expect(result.requests[0]?.url.search).toBe("?size=256");
    expect(result.stdoutChunks).toHaveLength(1);
    expect([...(result.stdoutChunks[0] as Uint8Array)]).toEqual([...bytes]);
  });

  it("qr image: writes nothing on 304", async () => {
    const result = await run(["qr", "image", QR_CODE.id, "--output", "qr.png", "--if-none-match", '"e1"'], {
      responses: [new Response(null, { status: 304, headers: { ETag: '"e1"' } })],
    });
    expect(result.written.size).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ notModified: true, etag: '"e1"' });
  });

  it("qr image: requires --output and checks --format", async () => {
    expect((await run(["qr", "image", QR_CODE.id])).code).toBe(EXIT_USAGE_ERROR);
    expect((await run(["qr", "image", QR_CODE.id, "--output", "x", "--format", "jpg"])).code).toBe(EXIT_USAGE_ERROR);
  });
});

describe("errors", () => {
  it("prints the API error as JSON on stderr with exit code 1", async () => {
    const result = await run(["qr", "get", "unknown"], { responses: [jsonResponse({ error: "not_found", message: "Ressource introuvable." }, 404)] });
    expect(result.code).toBe(EXIT_API_ERROR);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({ error: "not_found", message: "Ressource introuvable.", status: 404 });
  });

  it("gives resetAt for quota_exceeded", async () => {
    const result = await run(["qr", "create", "--label", "x", "--url", "https://x.ch", "--retries", "3"], {
      responses: [jsonResponse({ error: "quota_exceeded", message: "…", resetAt: "2026-12-01T00:00:00.000Z" }, 429, { "Retry-After": "5" })],
    });
    expect(JSON.parse(result.stderr)).toMatchObject({ error: "quota_exceeded", resetAt: "2026-12-01T00:00:00.000Z" });
    expect(result.requests).toHaveLength(1);
  });

  it("--retries waits and retries on rate_limited", async () => {
    vi.useFakeTimers();
    try {
      const pending = run(["usage", "--retries", "1"], {
        responses: [jsonResponse({ error: "rate_limited", message: "…" }, 429, { "Retry-After": "1" }), jsonResponse({ used: 0 })],
      });
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await pending;
      expect(result.code).toBe(EXIT_OK);
      expect(result.requests).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
