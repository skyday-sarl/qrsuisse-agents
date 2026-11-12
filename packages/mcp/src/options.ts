/** Address of the public QR Suisse documentation MCP server (Streamable HTTP, stateless, read-only). */
export const DEFAULT_REMOTE_URL = "https://www.qrsuisse.ch/mcp/docs";

/** Environment variable that replaces the default address (the --url option takes precedence). */
export const REMOTE_URL_ENV = "QRSUISSE_MCP_URL";

export type Options = { action: "run"; remoteUrl: URL } | { action: "help" } | { action: "version" };

/** Invalid command line or environment: the message is printed on stderr and the process exits. */
export class UsageError extends Error {
  override name = "UsageError";
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Checks the address of the remote MCP server: HTTPS only, except on the local machine (tests,
 * development), where HTTP is accepted. Credentials in the address are refused, so that they never
 * end up in a log or an error message.
 */
export function parseRemoteUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`Invalid MCP server address: ${value}`);
  }
  const isLocal = LOCAL_HOSTNAMES.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new UsageError(`The MCP server address must use https:// (http:// is only accepted for localhost): ${url.origin}`);
  }
  if (url.username || url.password) {
    throw new UsageError("The MCP server address must not contain a user name or a password.");
  }
  return url;
}

/** Reads the command line (`--url <address>`, `--url=<address>`, `--help`, `--version`) and the environment. */
export function parseOptions(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): Options {
  let urlArgument: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === "--help" || argument === "-h") return { action: "help" };
    if (argument === "--version" || argument === "-v") return { action: "version" };
    if (argument === "--url") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) throw new UsageError("--url needs an address.");
      urlArgument = value;
      index++;
    } else if (argument.startsWith("--url=")) {
      urlArgument = argument.slice("--url=".length);
    } else {
      throw new UsageError(`Unknown argument: ${argument}`);
    }
  }
  const remoteUrl = urlArgument ?? (env[REMOTE_URL_ENV] || DEFAULT_REMOTE_URL);
  return { action: "run", remoteUrl: parseRemoteUrl(remoteUrl) };
}

export const HELP_TEXT = `qrsuisse-mcp: local MCP server (stdio) for the QR Suisse documentation.

Relays the tools of the public, read-only QR Suisse documentation MCP server
(${DEFAULT_REMOTE_URL}) to an MCP client that starts servers over stdio,
such as Claude Desktop, Cursor or VS Code. No account and no API key: it gives
access to the public documentation only, never to a QR Suisse account.

Usage:
  npx -y @qrsuisse/mcp [--url <address>]

Options:
  --url <address>  Address of the remote MCP server (HTTPS only, except localhost).
                   Default: the ${REMOTE_URL_ENV} environment variable, then
                   ${DEFAULT_REMOTE_URL}
  --help           Print this help.
  --version        Print the version.

Logs are written on stderr; stdout carries the MCP protocol only.
Documentation: https://www.qrsuisse.ch/en/api-documentation/mcp-server
`;
