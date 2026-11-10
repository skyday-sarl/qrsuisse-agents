#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { main } from "./main.js";

process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  readFile: (path) => readFile(path, "utf8"),
  readStdin: () => text(process.stdin),
  writeFile: (path, data) => writeFile(path, data),
  randomUUID,
});
