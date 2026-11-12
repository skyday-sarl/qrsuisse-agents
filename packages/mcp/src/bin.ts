#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { main } from "./main.js";

const exitCode = await main(process.argv.slice(2), {
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  createTransport: () => new StdioServerTransport(),
});
if (exitCode !== undefined) process.exitCode = exitCode;
