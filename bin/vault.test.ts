import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const distBinPath = join(rootDir, "dist", "bin", "vault.js");

describe("vault CLI", () => {
  beforeAll(() => {
    // Build once before all tests
    execSync("pnpm build", {
      encoding: "utf-8",
      cwd: rootDir,
    });
  });

  describe("help text", () => {
    it("prints help when run with no arguments", () => {
      const output = execSync(`node ${distBinPath}`, {
        encoding: "utf-8",
        cwd: rootDir,
      });
      expect(output).toContain("vault - Retrieval engine");
      expect(output).toContain("USAGE:");
      expect(output).toContain("COMMANDS:");
      expect(output).toContain("query <text>");
      expect(output).toContain("index rebuild");
      expect(output).toContain("index stats");
      expect(output).toContain("OPTIONS:");
      expect(output).toContain("--vault-path");
      expect(output).toContain("--help");
    });

    it("prints help when run with --help flag", () => {
      const output = execSync(`node ${distBinPath} --help`, {
        encoding: "utf-8",
        cwd: rootDir,
      });
      expect(output).toContain("vault - Retrieval engine");
      expect(output).toContain("USAGE:");
    });

    it("prints help when run with -h flag", () => {
      const output = execSync(`node ${distBinPath} -h`, {
        encoding: "utf-8",
        cwd: rootDir,
      });
      expect(output).toContain("vault - Retrieval engine");
    });

    it("prints version when run with --version flag", () => {
      const output = execSync(`node ${distBinPath} --version`, {
        encoding: "utf-8",
        cwd: rootDir,
      });
      expect(output).toContain("vault 0.1.0");
    });

    it("prints version when run with -v flag", () => {
      const output = execSync(`node ${distBinPath} -v`, {
        encoding: "utf-8",
        cwd: rootDir,
      });
      expect(output).toContain("vault 0.1.0");
    });
  });

  describe("built CLI", () => {
    it("node dist/bin/vault.js prints help message", () => {
      const output = execSync(`node ${distBinPath}`, {
        encoding: "utf-8",
        cwd: rootDir,
      });
      expect(output).toContain("vault - Retrieval engine");
      expect(output).toContain("USAGE:");
    });
  });
});
