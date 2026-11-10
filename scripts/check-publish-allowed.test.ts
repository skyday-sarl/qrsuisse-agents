import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./check-publish-allowed.mjs", import.meta.url));

function runGuard(approved: string | undefined) {
  const env = { ...process.env };
  delete env.QRSUISSE_PUBLISH_APPROVED;
  if (approved !== undefined) env.QRSUISSE_PUBLISH_APPROVED = approved;
  return spawnSync(process.execPath, [script], { env, encoding: "utf8" });
}

describe("publish guard", () => {
  it("blocks publishing without the explicit approval", () => {
    expect(runGuard(undefined).status).toBe(1);
    expect(runGuard("true").status).toBe(1);
    expect(runGuard(undefined).stderr).toContain("Publishing is blocked");
  });

  it("lets publishing go on with QRSUISSE_PUBLISH_APPROVED=yes", () => {
    expect(runGuard("yes").status).toBe(0);
  });
});
