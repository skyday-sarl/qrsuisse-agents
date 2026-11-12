import { createServer, type IncomingHttpHeaders, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ErrorCode, McpError, ResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { createBridgeServer } from "../src/bridge.js";
import { EXIT_OK, EXIT_USAGE_ERROR, main } from "../src/main.js";
import { DEFAULT_REMOTE_URL, parseOptions, parseRemoteUrl, UsageError } from "../src/options.js";
import { MCP_PACKAGE_VERSION } from "../src/version.js";

/** Tools as the remote server describes them, with a field this SDK does not know, to check they are relayed unchanged. */
const REMOTE_TOOLS = [
  {
    name: "qr_suisse_search_docs",
    title: "Search the QR Suisse documentation",
    description: "Keyword search in the QR Suisse documentation.",
    inputSchema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: { query: { type: "string", minLength: 1, maxLength: 200 } },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
    "x-future-field": { kept: true },
  },
  {
    name: "qr_suisse_get_page",
    description: "Returns the full Markdown text of one page.",
    inputSchema: { type: "object", properties: { page: { type: "string", enum: ["llms-txt", "agents-md"] } }, required: ["page"] },
  },
];

const SEARCH_RESULT = {
  content: [{ type: "text", text: '{"results":[]}' }],
  structuredContent: { results: [] },
};

interface RecordedRequest {
  method: string;
  headers: IncomingHttpHeaders;
  body: { method?: string; params?: unknown } | undefined;
}

type RpcAnswer = { result: unknown } | { error: { code: number; message: string; data?: unknown } } | { httpStatus: number };

/**
 * Fictitious remote MCP server (Streamable HTTP, stateless, JSON responses), like
 * https://www.qrsuisse.ch/mcp/docs: POST only (GET answers 405). `answers` decides the answer to each
 * JSON-RPC method; a function receives the request parameters.
 */
async function startFakeRemote(answers: Record<string, RpcAnswer | ((params: unknown) => RpcAnswer)>) {
  const requests: RecordedRequest[] = [];
  const server: HttpServer = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    request.on("end", () => {
      const body = raw ? (JSON.parse(raw) as { id?: number; method?: string; params?: unknown }) : undefined;
      requests.push({ method: request.method ?? "", headers: request.headers, body });
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      if (body?.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const configured = answers[body.method ?? ""];
      const answer = typeof configured === "function" ? configured(body.params) : configured;
      if (!answer) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } }));
        return;
      }
      if ("httpStatus" in answer) {
        response.writeHead(answer.httpStatus, { "Content-Type": "text/plain" }).end("Service unavailable");
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...answer }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  openServers.push(server);
  return { url: new URL(`http://127.0.0.1:${port}/mcp/docs`), requests };
}

const INITIALIZE_ANSWER: RpcAnswer = {
  result: {
    protocolVersion: "2025-06-18",
    capabilities: { tools: { listChanged: true } },
    serverInfo: { name: "ch.qrsuisse/mcp-docs", version: "1.0.0" },
  },
};

const openServers: HttpServer[] = [];
const openClients: Client[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
  await Promise.all(openServers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

/** Connects a local MCP client to the bridge through an in-memory transport (stdio in real use). */
async function connectToBridge(remoteUrl: URL) {
  const logs: string[] = [];
  const bridge = createBridgeServer({ remoteUrl, log: (line) => logs.push(line) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await bridge.connect(serverSide);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientSide);
  openClients.push(client);
  return { client, logs };
}

async function rejection(promise: Promise<unknown>): Promise<McpError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(McpError);
  return error as McpError;
}

describe("relay to the remote MCP server", () => {
  it("relays tools/list with the tools and schemas of the remote server, unchanged", async () => {
    const remote = await startFakeRemote({ initialize: INITIALIZE_ANSWER, "tools/list": { result: { tools: REMOTE_TOOLS } } });
    const { client } = await connectToBridge(remote.url);

    const result = await client.request({ method: "tools/list" }, ResultSchema);

    expect(result).toEqual({ tools: REMOTE_TOOLS });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {} });
  });

  it("sends POST requests with the Streamable HTTP Accept header and without Origin header", async () => {
    const remote = await startFakeRemote({ initialize: INITIALIZE_ANSWER, "tools/list": { result: { tools: REMOTE_TOOLS } } });
    const { client } = await connectToBridge(remote.url);
    await client.listTools();

    const posts = remote.requests.filter((request) => request.method === "POST");
    expect(posts.map((request) => request.body?.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    for (const request of posts) {
      expect(request.headers.accept).toBe("application/json, text/event-stream");
    }
    for (const request of remote.requests) {
      expect(request.headers.origin).toBeUndefined();
    }
  });

  it("connects to the remote server once, at the first request", async () => {
    const remote = await startFakeRemote({ initialize: INITIALIZE_ANSWER, "tools/list": { result: { tools: REMOTE_TOOLS } } });
    const { client } = await connectToBridge(remote.url);
    expect(remote.requests).toHaveLength(0);

    await client.listTools();
    await client.listTools();

    expect(remote.requests.filter((request) => request.body?.method === "initialize")).toHaveLength(1);
  });

  it("relays tools/call with its arguments and returns the remote result unchanged", async () => {
    let receivedParams: unknown;
    const remote = await startFakeRemote({
      initialize: INITIALIZE_ANSWER,
      "tools/call": (params) => {
        receivedParams = params;
        return { result: SEARCH_RESULT };
      },
    });
    const { client } = await connectToBridge(remote.url);

    const result = await client.callTool({ name: "qr_suisse_search_docs", arguments: { query: "rate limit" } });

    expect(receivedParams).toEqual({ name: "qr_suisse_search_docs", arguments: { query: "rate limit" } });
    expect(result).toEqual(SEARCH_RESULT);
  });

  it("relays a tool result marked isError unchanged", async () => {
    const toolError = { content: [{ type: "text", text: "Page not found" }], isError: true };
    const remote = await startFakeRemote({ initialize: INITIALIZE_ANSWER, "tools/call": { result: toolError } });
    const { client } = await connectToBridge(remote.url);

    expect(await client.callTool({ name: "qr_suisse_get_page", arguments: { page: "llms-txt" } })).toEqual(toolError);
  });
});

describe("errors", () => {
  it("relays a JSON-RPC error of the remote server with its code, message and data", async () => {
    const remote = await startFakeRemote({
      initialize: INITIALIZE_ANSWER,
      "tools/call": { error: { code: -32602, message: "Unknown tool: nope", data: { availableTools: ["qr_suisse_search_docs"] } } },
    });
    const { client } = await connectToBridge(remote.url);

    const error = await rejection(client.callTool({ name: "nope", arguments: {} }));

    expect(error.code).toBe(-32602);
    // The local client adds the "MCP error <code>: " prefix once, as with a direct connection.
    expect(error.message).toBe("MCP error -32602: Unknown tool: nope");
    expect(error.data).toEqual({ availableTools: ["qr_suisse_search_docs"] });
  });

  it("answers an internal error, logged on stderr, when the remote server fails over HTTP", async () => {
    const remote = await startFakeRemote({ initialize: INITIALIZE_ANSWER, "tools/call": { httpStatus: 503 } });
    const { client, logs } = await connectToBridge(remote.url);

    const error = await rejection(client.callTool({ name: "qr_suisse_search_docs", arguments: { query: "quota" } }));

    expect(error.code).toBe(ErrorCode.InternalError);
    expect(error.message).toContain(`The QR Suisse MCP server (${remote.url.href}) could not be reached`);
    expect(logs.some((line) => line.startsWith("tools/call failed:"))).toBe(true);
  });

  it("opens the connection again at the next request when the first connection failed", async () => {
    let initializeCalls = 0;
    const remote = await startFakeRemote({
      initialize: () => (++initializeCalls === 1 ? { httpStatus: 503 } : INITIALIZE_ANSWER),
      "tools/list": { result: { tools: REMOTE_TOOLS } },
    });
    const { client } = await connectToBridge(remote.url);

    expect((await rejection(client.listTools())).code).toBe(ErrorCode.InternalError);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["qr_suisse_search_docs", "qr_suisse_get_page"]);
  });

  it("answers an internal error when the remote server cannot be reached", async () => {
    const remote = await startFakeRemote({});
    await new Promise((resolve) => openServers.pop()!.close(resolve));
    const { client } = await connectToBridge(remote.url);

    expect((await rejection(client.listTools())).code).toBe(ErrorCode.InternalError);
  });
});

describe("address of the remote server", () => {
  it("uses the public documentation MCP server by default", () => {
    expect(parseOptions([], {})).toEqual({ action: "run", remoteUrl: new URL(DEFAULT_REMOTE_URL) });
    expect(DEFAULT_REMOTE_URL).toBe("https://www.qrsuisse.ch/mcp/docs");
  });

  it("reads QRSUISSE_MCP_URL, and --url takes precedence", () => {
    const env = { QRSUISSE_MCP_URL: "https://mcp.example.ch/docs" };
    expect(parseOptions([], env)).toMatchObject({ remoteUrl: new URL("https://mcp.example.ch/docs") });
    expect(parseOptions(["--url", "https://other.example.ch/mcp"], env)).toMatchObject({ remoteUrl: new URL("https://other.example.ch/mcp") });
    expect(parseOptions(["--url=https://other.example.ch/mcp"], env)).toMatchObject({ remoteUrl: new URL("https://other.example.ch/mcp") });
  });

  it("refuses an address that is not HTTPS, except on localhost", () => {
    expect(() => parseRemoteUrl("http://www.qrsuisse.ch/mcp/docs")).toThrow(UsageError);
    expect(() => parseRemoteUrl("ftp://www.qrsuisse.ch/mcp/docs")).toThrow(UsageError);
    expect(() => parseRemoteUrl("not an address")).toThrow(UsageError);
    expect(() => parseOptions([], { QRSUISSE_MCP_URL: "http://mcp.example.ch/docs" })).toThrow(UsageError);
    expect(parseRemoteUrl("http://localhost:3000/mcp/docs").host).toBe("localhost:3000");
    expect(parseRemoteUrl("http://127.0.0.1:3000/mcp/docs").host).toBe("127.0.0.1:3000");
    expect(parseRemoteUrl("http://[::1]:3000/mcp/docs").host).toBe("[::1]:3000");
  });

  it("refuses an address with credentials, and unknown arguments", () => {
    expect(() => parseRemoteUrl("https://user:secret@mcp.example.ch/docs")).toThrow(UsageError);
    expect(() => parseOptions(["--url"], {})).toThrow(UsageError);
    expect(() => parseOptions(["--verbose"], {})).toThrow(UsageError);
  });
});

describe("process entry point", () => {
  function io(env: Record<string, string> = {}) {
    const output = { stdout: "", stderr: "" };
    return {
      output,
      environment: {
        env,
        stdout: { write: (chunk: string) => (output.stdout += chunk) },
        stderr: { write: (chunk: string) => (output.stderr += chunk) },
      },
    };
  }

  it("refuses a non-HTTPS address on stderr, with the usage error exit code, before starting", async () => {
    const { output, environment } = io();
    let transportCreated = false;
    const code = await main(["--url", "http://www.qrsuisse.ch/mcp/docs"], {
      ...environment,
      createTransport: () => {
        transportCreated = true;
        return InMemoryTransport.createLinkedPair()[1];
      },
    });

    expect(code).toBe(EXIT_USAGE_ERROR);
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain("must use https://");
    expect(transportCreated).toBe(false);
  });

  it("writes nothing on stdout while the server runs, only on stderr", async () => {
    const remote = await startFakeRemote({ initialize: INITIALIZE_ANSWER, "tools/list": { result: { tools: REMOTE_TOOLS } } });
    const { output, environment } = io({ QRSUISSE_MCP_URL: remote.url.href });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();

    const code = await main([], { ...environment, createTransport: () => serverSide });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientSide);
    openClients.push(client);
    await client.listTools();

    expect(code).toBeUndefined();
    expect(client.getServerVersion()).toMatchObject({ name: "qrsuisse-mcp", version: MCP_PACKAGE_VERSION });
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain(`ready on stdio, relaying ${remote.url.href}`);
  });

  it("prints the version, equal to package.json, and the help", async () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(MCP_PACKAGE_VERSION).toBe(packageJson.version);

    const version = io();
    expect(await main(["--version"], { ...version.environment, createTransport: () => InMemoryTransport.createLinkedPair()[1] })).toBe(EXIT_OK);
    expect(version.output.stdout).toBe(`${MCP_PACKAGE_VERSION}\n`);

    const help = io();
    expect(await main(["--help"], { ...help.environment, createTransport: () => InMemoryTransport.createLinkedPair()[1] })).toBe(EXIT_OK);
    expect(help.output.stdout).toContain("npx -y @qrsuisse/mcp");
  });
});
