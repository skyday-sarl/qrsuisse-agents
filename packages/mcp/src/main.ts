import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createBridgeServer } from "./bridge.js";
import { HELP_TEXT, parseOptions, UsageError } from "./options.js";
import { MCP_PACKAGE_VERSION } from "./version.js";

export const EXIT_OK = 0;
export const EXIT_USAGE_ERROR = 2;

export interface MainEnvironment {
  env: Readonly<Record<string, string | undefined>>;
  /** Used only for --help and --version, never while the server runs. */
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  /** Transport of the local MCP client (stdio in bin.ts). */
  createTransport: () => Transport;
}

/**
 * Starts the bridge on the local transport, or prints the help or the version. Returns an exit code
 * when the process must end right away, `undefined` when the server runs until the transport closes.
 */
export async function main(argv: readonly string[], io: MainEnvironment): Promise<number | undefined> {
  let options;
  try {
    options = parseOptions(argv, io.env);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr.write(`qrsuisse-mcp: ${error.message}\nRun qrsuisse-mcp --help for usage.\n`);
    return EXIT_USAGE_ERROR;
  }
  if (options.action === "help") {
    io.stdout.write(HELP_TEXT);
    return EXIT_OK;
  }
  if (options.action === "version") {
    io.stdout.write(`${MCP_PACKAGE_VERSION}\n`);
    return EXIT_OK;
  }
  const log = (line: string) => io.stderr.write(`qrsuisse-mcp: ${line}\n`);
  const server = createBridgeServer({ remoteUrl: options.remoteUrl, log });
  await server.connect(io.createTransport());
  log(`${MCP_PACKAGE_VERSION} ready on stdio, relaying ${options.remoteUrl.href}`);
  return undefined;
}
