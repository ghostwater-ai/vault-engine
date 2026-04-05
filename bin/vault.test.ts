import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const distBinPath = join(rootDir, "dist", "bin", "vault.js");
const fixtureVaultPath = join(
  rootDir,
  "packages",
  "core",
  "src",
  "__fixtures__",
  "vault"
);

function runCli(args: string): string {
  return execSync(`node ${distBinPath} ${args}`, {
    encoding: "utf-8",
    cwd: rootDir,
  });
}

describe("vault CLI", () => {
  beforeAll(() => {
    execSync("pnpm build", {
      encoding: "utf-8",
      cwd: rootDir,
    });
  });

  it("vault query prints ranked terminal output with score and [type|status] title — description", () => {
    const output = runCli(`query "test" --vault-path "${fixtureVaultPath}"`);

    expect(output).toContain("Query: test");
    expect(output).toContain("Tier: 0");
    expect(output).toMatch(/\d+\.\d{3}\s+\[[a-z]+\|[^\]]+\]\s+.+\s—\s.+/);
  });

  it("vault query --json prints parseable JSON with query/tier/latencyMs/results", () => {
    const output = runCli(`query "test" --vault-path "${fixtureVaultPath}" --json`);
    const parsed = JSON.parse(output) as {
      query: string;
      tier: number;
      latencyMs: number;
      results: unknown[];
    };

    expect(parsed.query).toBe("test");
    expect(parsed.tier).toBe(0);
    expect(typeof parsed.latencyMs).toBe("number");
    expect(Array.isArray(parsed.results)).toBe(true);
  });

  it("vault query --explain includes scoring breakdown fields and explanation string", () => {
    const output = runCli(
      `query "test" --vault-path "${fixtureVaultPath}" --context "retrieval architecture" --explain`
    );

    expect(output).toContain("raw BM25:");
    expect(output).toContain("normalized BM25:");
    expect(output).toContain("type boost:");
    expect(output).toContain("confidence modifier:");
    expect(output).toContain("context overlap:");
    expect(output).toContain("BM25 floor status:");
    expect(output).toContain("compound threshold status:");
    expect(output).toContain("final score:");
    expect(output).toContain("explanation:");
    expect(output).toContain("Context terms:");
  });

  it("vault query applies --types, --max-results, --min-score, and --context", () => {
    const output = runCli(
      `query "test" --vault-path "${fixtureVaultPath}" --types belief,research --max-results 5 --min-score 0.2 --context "retrieval architecture"`
    );

    expect(output).toContain("Context terms:");

    const resultLines = output
      .split("\n")
      .filter((line) => /^\d+\.\d{3}\s+\[[a-z]+\|/.test(line));

    expect(resultLines.length).toBeLessThanOrEqual(5);
    expect(resultLines.length).toBeGreaterThan(0);

    for (const line of resultLines) {
      const match = line.match(/\[([a-z]+)\|/);
      expect(match).toBeTruthy();
      expect(["belief", "research"]).toContain(match?.[1]);
    }
  });

  it("vault query --dry-run prints Vault Context blocks and token estimate within budget", () => {
    const output = runCli(`query "test" --vault-path "${fixtureVaultPath}" --dry-run`);

    expect(output).toContain("## Vault Context");
    expect(output).toMatch(/\[[a-z]+\|[^\]]+\]\s.+\n.+/);

    const tokenMatch = output.match(/Token estimate:\s(\d+)\/(\d+)/);
    expect(tokenMatch).toBeTruthy();

    const used = Number(tokenMatch?.[1] ?? "0");
    const budget = Number(tokenMatch?.[2] ?? "0");
    expect(budget).toBe(1500);
    expect(used).toBeLessThanOrEqual(budget);
  });
});
