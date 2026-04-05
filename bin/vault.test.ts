import { beforeAll, describe, expect, it } from "vitest";
import { execSync, spawnSync } from "node:child_process";
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

function splitArgs(args: string): string[] {
  return args.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((token) => token.replace(/^"|"$/g, "")) ?? [];
}

function runCli(args: string, envOverrides?: NodeJS.ProcessEnv): string {
  const result = spawnSync("node", [distBinPath, ...splitArgs(args)], {
    cwd: rootDir,
    encoding: "utf-8",
    env: {
      ...process.env,
      ...envOverrides,
    },
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || `CLI failed with exit code ${result.status ?? "unknown"}`);
  }

  return result.stdout;
}

function runCliResult(args: string, envOverrides?: NodeJS.ProcessEnv) {
  return spawnSync("node", [distBinPath, ...splitArgs(args)], {
    cwd: rootDir,
    encoding: "utf-8",
    env: {
      ...process.env,
      ...envOverrides,
    },
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

  it("vault index stats prints document count and type distribution", () => {
    const output = runCli(`index stats --vault-path "${fixtureVaultPath}"`);

    expect(output).toContain("Index stats:");
    expect(output).toContain("Document count: 11");
    expect(output).toContain("Type distribution:");
    expect(output).toContain("belief: 1");
    expect(output).toContain("experience: 2");
    expect(output).toContain("research: 3");
    expect(output).toContain("topic: 2");
    expect(output).toContain("Index size (bytes):");
    expect(output).toContain("Last rebuild:");
  });

  it("vault index rebuild performs full rebuild and prints completion plus stats", () => {
    const output = runCli(`index rebuild --vault-path "${fixtureVaultPath}"`);

    expect(output).toContain("Rebuild complete.");
    expect(output).toContain("Index stats:");
    expect(output).toContain("Document count: 11");
    expect(output).toContain("Type distribution:");
  });

  it("vault --help lists query flags and index subcommands", () => {
    const output = runCli("--help");

    expect(output).toContain("--vault-path <path>");
    expect(output).toContain("query [options] <text>");
    expect(output).toContain("index");
    expect(output).toContain("--json");
    expect(output).toContain("--explain");
    expect(output).toContain("--context <text>");
    expect(output).toContain("--types <types>");
    expect(output).toContain("--max-results <count>");
    expect(output).toContain("--min-score <score>");
    expect(output).toContain("--dry-run");
    expect(output).toContain("index stats");
    expect(output).toContain("index rebuild");
  });

  it("CLI errors with helpful message when vault path is missing", () => {
    const result = runCliResult(`index stats`, {
      ...process.env,
      VAULT_PATH: "",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Vault path is required. Provide --vault-path <path> or set VAULT_PATH in your environment.");
  });
});
