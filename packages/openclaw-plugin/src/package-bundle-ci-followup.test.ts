import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../..");
const coreDistIndex = resolve(repoRoot, "packages/core/dist/index.js");
const pluginPackageDir = resolve(repoRoot, "packages/openclaw-plugin");

describe("openclaw plugin packaging CI isolation", () => {
  it(
    "does not delete core build artifacts when running plugin clean",
    () => {
      execSync("pnpm build", {
        cwd: repoRoot,
        stdio: "pipe",
      });
      expect(existsSync(coreDistIndex)).toBe(true);

      execSync("pnpm clean", {
        cwd: pluginPackageDir,
        stdio: "pipe",
      });

      expect(existsSync(coreDistIndex)).toBe(true);
    },
    120_000
  );
});
