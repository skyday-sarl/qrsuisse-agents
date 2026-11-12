// Guard against an accidental `npm publish` (run by the `prepublishOnly` script of each package).
// Publishing the SDK, the CLI and the MCP server on npm is decided by Skyday Sàrl: until then, and
// for every release, the person who publishes sets QRSUISSE_PUBLISH_APPROVED=yes for that command
// only. `npm pack` is not affected.

if (process.env.QRSUISSE_PUBLISH_APPROVED !== "yes") {
  console.error(
    "Publishing is blocked: publishing @qrsuisse/sdk, qrsuisse or @qrsuisse/mcp on npm is decided by Skyday Sàrl.\n" +
      "Once it is decided, publish with QRSUISSE_PUBLISH_APPROVED=yes set for that command only.",
  );
  process.exit(1);
}
