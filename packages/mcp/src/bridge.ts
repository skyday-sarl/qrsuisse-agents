import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  ResultSchema,
  type CallToolResult,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import { MCP_PACKAGE_VERSION } from "./version.js";

export const SERVER_NAME = "qrsuisse-mcp";

const INSTRUCTIONS =
  "Read-only documentation of QR Suisse, a Swiss dynamic QR code generator, and of its REST API v1, " +
  "relayed from the public QR Suisse documentation MCP server. Search the documentation, then read a page. " +
  "This server has no access to any QR Suisse account: to act on QR codes, use the QR Suisse API with an API key.";

export interface BridgeOptions {
  /** Address of the remote MCP server (already checked by parseRemoteUrl). */
  remoteUrl: URL;
  /** Writes one line of log; must never write on stdout, which carries the protocol. */
  log: (line: string) => void;
}

/**
 * Error relayed unchanged to the local MCP client: the Server of the SDK sends `code`, `message`
 * and `data` as they are, without the "MCP error <code>: " prefix that McpError adds.
 */
class RelayedError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

/** Removes the prefix added by McpError on the client side, to give back the remote message as sent. */
function remoteMessage(error: McpError): string {
  return error.message.replace(/^MCP error -?\d+: /, "");
}

type RelayedMethod = "tools/list" | "tools/call";

/**
 * Local MCP server that relays tools/list and tools/call to the remote MCP server (Streamable HTTP).
 * The tools and their schemas are read from the remote server at each tools/list, never copied
 * here. The connection to the remote server is opened at the first request, and opened again at
 * the next request if it failed.
 */
export function createBridgeServer({ remoteUrl, log }: BridgeOptions): Server {
  let remoteClient: Promise<Client> | undefined;

  function connectRemote(): Promise<Client> {
    if (!remoteClient) {
      const connecting = (async () => {
        const client = new Client({ name: SERVER_NAME, version: MCP_PACKAGE_VERSION });
        client.onerror = (error) => log(`remote MCP server: ${error.message}`);
        // Sends "Accept: application/json, text/event-stream" and no Origin header (Node.js fetch).
        await client.connect(new StreamableHTTPClientTransport(remoteUrl));
        return client;
      })();
      connecting.catch(() => {
        if (remoteClient === connecting) remoteClient = undefined;
      });
      remoteClient = connecting;
    }
    return remoteClient;
  }

  async function relay<T>(method: RelayedMethod, params: unknown, signal: AbortSignal): Promise<T> {
    try {
      const client = await connectRemote();
      // ResultSchema keeps every field of the remote result, including those this SDK does not know.
      return (await client.request({ method, params } as never, ResultSchema, { signal })) as T;
    } catch (error) {
      if (error instanceof McpError) throw new RelayedError(error.code, remoteMessage(error), error.data);
      const reason = error instanceof Error ? error.message : String(error);
      log(`${method} failed: ${reason}`);
      throw new McpError(ErrorCode.InternalError, `The QR Suisse MCP server (${remoteUrl.href}) could not be reached: ${reason}`);
    }
  }

  const server = new Server(
    {
      name: SERVER_NAME,
      title: "QR Suisse documentation",
      version: MCP_PACKAGE_VERSION,
      websiteUrl: "https://www.qrsuisse.ch/en/api-documentation/mcp-server",
    },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  server.setRequestHandler(ListToolsRequestSchema, (request, extra) =>
    relay<ListToolsResult>("tools/list", request.params, extra.signal),
  );
  server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
    relay<CallToolResult>("tools/call", request.params, extra.signal),
  );
  server.onclose = () => {
    void remoteClient?.then((client) => client.close()).catch(() => undefined);
  };
  return server;
}
