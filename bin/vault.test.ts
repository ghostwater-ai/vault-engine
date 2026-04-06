import { beforeAll, describe, expect, it } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const distBinPath = join(rootDir, "packages", "core", "dist", "bin", "vault.js");
const corePackageDir = join(rootDir, "packages", "core");
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

  it("vault query --json prints parseable JSON ScoredDocument[] array", () => {
    const output = runCli(`query "test" --vault-path "${fixtureVaultPath}" --json`);
    const parsed = JSON.parse(output) as Array<{
      score: number;
      doc: { title: string };
    }>;

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(typeof parsed[0]?.score).toBe("number");
    expect(typeof parsed[0]?.doc?.title).toBe("string");
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

  it("vault query --dry-run enforces top-3 results even when --max-results is larger", () => {
    const output = runCli(`query "test" --vault-path "${fixtureVaultPath}" --dry-run --max-results 10`);

    const headers = output
      .split("\n")
      .filter((line) => /^\[[a-z]+\|[^\]]+\]\s.+/.test(line));

    expect(headers.length).toBeLessThanOrEqual(3);
  });

  it("vault query --dry-run emits no output when no results pass thresholds", () => {
    const output = runCli(`query "zzzznomatch" --vault-path "${fixtureVaultPath}" --dry-run`);
    expect(output).toBe("");
  });

  it("vault query accepts plural entities note type", () => {
    const output = runCli(`query "test" --vault-path "${fixtureVaultPath}" --types entities`);
    expect(output).toContain("Query: test");
  });

  it("vault query rejects malformed numeric option values", () => {
    const maxResultsResult = runCliResult(
      `query "test" --vault-path "${fixtureVaultPath}" --max-results 1.5`
    );
    expect(maxResultsResult.status).not.toBe(0);
    expect(maxResultsResult.stderr).toContain("Expected a positive integer, received: 1.5");

    const minScoreResult = runCliResult(
      `query "test" --vault-path "${fixtureVaultPath}" --min-score 0.3oops`
    );
    expect(minScoreResult.status).not.toBe(0);
    expect(minScoreResult.stderr).toContain("Expected a score between 0 and 1, received: 0.3oops");
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
    expect(output).toContain("openclaw");
    expect(output).toContain("openclaw install");
    expect(output).toContain("--config <path>");
    expect(output).toContain("--allow <session-key>");
    expect(output).toContain("--deny <session-key>");
  });

  it("vault openclaw install bootstraps missing openclaw.json with plugin entry and config", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vault-engine-openclaw-bootstrap-"));
    const configPath = join(tempDir, "openclaw.json");

    try {
      runCli(
        `openclaw install --config "${configPath}" --vault-path "/tmp/abidan-vault" --allow "agent:cpto:*" --deny "agent:cpto:slack:sandbox:*"`
      );

      const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as {
        plugins: {
          entries: {
            "vault-engine": {
              enabled: boolean;
              package: string;
              config: {
                vaultPath: string;
                scope: {
                  allowSessionKeys: string[];
                  denySessionKeys: string[];
                };
              };
            };
          };
        };
      };

      const entry = parsed.plugins.entries["vault-engine"];
      expect(entry.enabled).toBe(true);
      expect(entry.package).toBe("@ghostwater/vault-engine-openclaw");
      expect(entry.config.vaultPath).toBe("/tmp/abidan-vault");
      expect(entry.config.scope.allowSessionKeys).toEqual(["agent:cpto:*"]);
      expect(entry.config.scope.denySessionKeys).toEqual(["agent:cpto:slack:sandbox:*"]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("vault openclaw install updates package/vaultPath and preserves unrelated config fields", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vault-engine-openclaw-update-"));
    const configPath = join(tempDir, "openclaw.json");

    try {
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            telemetry: {
              enabled: true,
            },
            plugins: {
              entries: {
                "vault-engine": {
                  enabled: false,
                  package: "legacy-package",
                  config: {
                    vaultPath: "/tmp/old-vault",
                    scope: {
                      allowSessionKeys: ["agent:cpto:*"],
                      denySessionKeys: [],
                    },
                    injection: {
                      maxResults: 2,
                    },
                  },
                },
                "another-plugin": {
                  enabled: true,
                },
              },
            },
          },
          null,
          2
        ),
        "utf-8"
      );

      runCli(
        `openclaw install --config "${configPath}" --vault-path "/tmp/new-vault" --package "@ghostwater/vault-engine-openclaw"`
      );

      const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as {
        telemetry: { enabled: boolean };
        plugins: {
          entries: {
            "vault-engine": {
              enabled: boolean;
              package: string;
              config: {
                vaultPath: string;
                injection: { maxResults: number };
              };
            };
            "another-plugin": { enabled: boolean };
          };
        };
      };

      expect(parsed.telemetry.enabled).toBe(true);
      expect(parsed.plugins.entries["another-plugin"].enabled).toBe(true);
      expect(parsed.plugins.entries["vault-engine"].enabled).toBe(true);
      expect(parsed.plugins.entries["vault-engine"].package).toBe("@ghostwater/vault-engine-openclaw");
      expect(parsed.plugins.entries["vault-engine"].config.vaultPath).toBe("/tmp/new-vault");
      expect(parsed.plugins.entries["vault-engine"].config.injection.maxResults).toBe(2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("vault openclaw install resolves relative vault path to an absolute path in config", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vault-engine-openclaw-relative-vault-"));
    const configPath = join(tempDir, "openclaw.json");

    try {
      runCli(`openclaw install --config "${configPath}" --vault-path "./vault"`);

      const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as {
        plugins: {
          entries: {
            "vault-engine": {
              config: {
                vaultPath: string;
              };
            };
          };
        };
      };

      expect(parsed.plugins.entries["vault-engine"].config.vaultPath).toBe(resolve(rootDir, "vault"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("vault openclaw install appends allow/deny rules idempotently without duplicates", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vault-engine-openclaw-idempotent-"));
    const configPath = join(tempDir, "openclaw.json");

    try {
      runCli(
        `openclaw install --config "${configPath}" --vault-path "/tmp/vault" --allow "agent:cpto:*" --allow "agent:cpto:*" --deny "agent:cpto:slack:sandbox:*"`
      );
      runCli(
        `openclaw install --config "${configPath}" --vault-path "/tmp/vault" --allow "agent:cpto:*" --deny "agent:cpto:slack:sandbox:*"`
      );

      const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as {
        plugins: {
          entries: {
            "vault-engine": {
              config: {
                scope: {
                  allowSessionKeys: string[];
                  denySessionKeys: string[];
                };
              };
            };
          };
        };
      };

      expect(parsed.plugins.entries["vault-engine"].config.scope.allowSessionKeys).toEqual([
        "agent:cpto:*",
      ]);
      expect(parsed.plugins.entries["vault-engine"].config.scope.denySessionKeys).toEqual([
        "agent:cpto:slack:sandbox:*",
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("vault openclaw install --dry-run prints resulting config and does not write file", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vault-engine-openclaw-dry-run-"));
    const configPath = join(tempDir, "openclaw.json");

    try {
      const output = runCli(
        `openclaw install --config "${configPath}" --vault-path "/tmp/vault" --allow "agent:cpto:*" --dry-run`
      );

      expect(output).toContain('"vault-engine"');
      expect(output).toContain('"vaultPath": "/tmp/vault"');
      expect(output).toContain('"allowSessionKeys": [');
      expect(existsSync(configPath)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("vault openclaw install --print writes config and prints resulting JSON", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vault-engine-openclaw-print-"));
    const configPath = join(tempDir, "openclaw.json");

    try {
      const output = runCli(
        `openclaw install --config "${configPath}" --vault-path "/tmp/vault" --allow "agent:cpto:*" --print`
      );

      const written = JSON.parse(readFileSync(configPath, "utf-8")) as {
        plugins: {
          entries: {
            "vault-engine": {
              config: {
                vaultPath: string;
                scope: {
                  allowSessionKeys: string[];
                };
              };
            };
          };
        };
      };

      expect(output).toContain('"vault-engine"');
      expect(output).toContain('"vaultPath": "/tmp/vault"');
      expect(written.plugins.entries["vault-engine"].config.vaultPath).toBe("/tmp/vault");
      expect(written.plugins.entries["vault-engine"].config.scope.allowSessionKeys).toEqual([
        "agent:cpto:*",
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("vault openclaw install reports no changes needed when rerun with same inputs", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vault-engine-openclaw-no-change-"));
    const configPath = join(tempDir, "openclaw.json");

    try {
      runCli(
        `openclaw install --config "${configPath}" --vault-path "/tmp/vault" --allow "agent:cpto:*" --deny "agent:cpto:slack:sandbox:*"`
      );

      const output = runCli(
        `openclaw install --config "${configPath}" --vault-path "/tmp/vault" --allow "agent:cpto:*" --deny "agent:cpto:slack:sandbox:*"`
      );

      expect(output).toContain(`No changes needed: ${configPath}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("vault openclaw install fails with helpful message when openclaw.json is invalid JSON", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vault-engine-openclaw-invalid-json-"));
    const configPath = join(tempDir, "openclaw.json");

    try {
      writeFileSync(configPath, "{invalid-json", "utf-8");

      const result = runCliResult(
        `openclaw install --config "${configPath}" --vault-path "/tmp/vault"`
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`Failed to read OpenClaw config at ${configPath}:`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("CLI errors with helpful message when vault path is missing", () => {
    const result = runCliResult(`index stats`, {
      ...process.env,
      VAULT_PATH: "",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Vault path is required. Provide --vault-path <path> or set VAULT_PATH in your environment.");
  });

  it("publishes vault bin from an in-package dist path", () => {
    const packageJson = JSON.parse(
      readFileSync(join(corePackageDir, "package.json"), "utf-8")
    ) as { bin?: { vault?: string } };
    const vaultBinPath = packageJson.bin?.vault;

    expect(vaultBinPath).toBe("./dist/bin/vault.js");

    const packDir = mkdtempSync(join(tmpdir(), "vault-engine-pack-"));

    try {
      execSync(`pnpm pack --pack-destination "${packDir}"`, {
        cwd: corePackageDir,
        encoding: "utf-8",
      });

      const tarballName = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
      expect(tarballName).toBeTruthy();

      const tarballPath = join(packDir, tarballName ?? "");
      const tarContents = execSync(`tar -tzf "${tarballPath}"`, {
        cwd: rootDir,
        encoding: "utf-8",
      });
      expect(tarContents).toContain("package/dist/bin/vault.js");

      const packedPackageJson = JSON.parse(
        execSync(`tar -xOf "${tarballPath}" package/package.json`, {
          cwd: rootDir,
          encoding: "utf-8",
        })
      ) as { bin?: { vault?: string } };

      expect(packedPackageJson.bin?.vault).toBe("./dist/bin/vault.js");
    } finally {
      rmSync(packDir, { recursive: true, force: true });
    }
  });
});
