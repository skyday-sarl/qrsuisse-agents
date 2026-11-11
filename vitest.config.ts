import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The CLI tests run against the SDK sources, without a prior build.
    alias: { "@qrsuisse/sdk": fileURLToPath(new URL("./packages/sdk/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
