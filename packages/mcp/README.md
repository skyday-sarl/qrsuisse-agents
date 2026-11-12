# @qrsuisse/mcp

Local MCP server (stdio) for the documentation of [QR Suisse](https://www.qrsuisse.ch), a Swiss
dynamic QR code generator, and of its public REST API (v1).

It relays the public, read-only
[QR Suisse documentation MCP server](https://www.qrsuisse.ch/en/api-documentation/mcp-server)
(`https://www.qrsuisse.ch/mcp/docs`, registry name `ch.qrsuisse/mcp-docs`) to MCP clients that
start their servers with a command, such as Claude Desktop, Cursor or VS Code. Clients that support
remote MCP servers (Streamable HTTP) can connect to `https://www.qrsuisse.ch/mcp/docs` directly,
without this package.

**Public documentation only, no account.** This server needs no QR Suisse account and no API key.
It gives access to the public documentation only (search, read a page) and cannot act on a
QR Suisse account or on QR codes. To act on QR codes, use the [QR Suisse API](https://www.qrsuisse.ch/en/api-documentation)
with an API key, for example through [`@qrsuisse/sdk`](https://www.npmjs.com/package/@qrsuisse/sdk)
or the [`qrsuisse`](https://www.npmjs.com/package/qrsuisse) CLI.

Requires Node.js 18.17 or later.

## Tools

The tools and their input schemas are read from the remote server at each `tools/list`, so this
package follows its changes without an update. Today:

- `qr_suisse_search_docs`: keyword search in the documentation (English), up to 5 pages;
- `qr_suisse_get_page`: full Markdown text of one page (`llms-txt`, `agents-md`, `auth-md`,
  `pricing-md`, or `api/<operationId>`).

## Configuration

### Claude Desktop

In `claude_desktop_config.json` (Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "qrsuisse": {
      "command": "npx",
      "args": ["-y", "@qrsuisse/mcp"]
    }
  }
}
```

### Cursor

In `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "qrsuisse": {
      "command": "npx",
      "args": ["-y", "@qrsuisse/mcp"]
    }
  }
}
```

### VS Code

In `.vscode/mcp.json`:

```json
{
  "servers": {
    "qrsuisse": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@qrsuisse/mcp"]
    }
  }
}
```

or from a terminal:

```sh
code --add-mcp '{"name":"qrsuisse","command":"npx","args":["-y","@qrsuisse/mcp"]}'
```

### Claude Code

```sh
claude mcp add qrsuisse -- npx -y @qrsuisse/mcp
```

## Options

| Option | Description |
|---|---|
| `--url <address>` | Address of the remote MCP server. Default: the `QRSUISSE_MCP_URL` environment variable, then `https://www.qrsuisse.ch/mcp/docs`. HTTPS only (HTTP is accepted for `localhost`, `127.0.0.1` and `[::1]` only); an address with a user name or a password is refused. |
| `--help` | Print the help. |
| `--version` | Print the version. |

Logs (start, connection errors) are written on stderr; stdout carries the MCP protocol only.

## Behaviour

- Relays `tools/list` and `tools/call` to the remote server over Streamable HTTP (POST requests,
  `Accept: application/json, text/event-stream`, no `Origin` header). Results are relayed unchanged.
- Errors of the remote server (JSON-RPC errors, tool results with `isError`) are relayed unchanged.
  When the remote server cannot be reached, the request fails with a JSON-RPC internal error
  (`-32603`) and the connection is opened again at the next request.
- The connection to the remote server is opened at the first request, not at start-up.
- Sends no API key and no cookie. The remote server receives the MCP requests of your client
  (search terms, page identifiers) and, as with any HTTP request, your IP address. See the
  [privacy policy](https://www.qrsuisse.ch/en/legal/privacy-policy).

## License

MIT, see [LICENSE](LICENSE). The license covers this package only: it grants no right to the
QR Suisse name or logo (see the [Brand](https://www.qrsuisse.ch/en/brand) page).
