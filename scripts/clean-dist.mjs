// Empties dist/ of the current package before each build, so that no stale file (old source map,
// renamed module) ends up in the npm package.
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
