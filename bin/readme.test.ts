import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const readmePath = join(__dirname, "..", "README.md");
const readme = readFileSync(readmePath, "utf-8");

describe("README usage docs", () => {
  it("documents CLI query usage with --explain and --json examples", () => {
    expect(readme).toContain("## CLI Usage");
    expect(readme).toContain('vault query "retrieval architecture"');
    expect(readme).toContain("--explain");
    expect(readme).toContain('vault query "byterover" --json');
  });

  it("documents OpenClaw plugin configuration with vaultPath", () => {
    expect(readme).toContain("## OpenClaw Plugin Config");
    expect(readme).toContain("vault openclaw install");
    expect(readme).toContain("--dry-run");
    expect(readme).toContain('"vault-engine"');
    expect(readme).toContain('"vaultPath"');
    expect(readme).toContain("only writes config values under `plugins.entries.vault-engine.config`");
    expect(readme).not.toContain('"enabled": true');
  });

  it("documents that package field is NOT written by openclaw install", () => {
    const configBlockMatch = readme.match(/Resulting config shape[^`]*```json\n([\s\S]*?)```/);
    expect(configBlockMatch).toBeTruthy();
    const configBlock = configBlockMatch?.[1] ?? "";
    expect(configBlock).not.toContain('"package"');
    expect(readme).toContain("package` field for plugin discovery is **not** written");
  });

  it("documents vault_query tool inputs aligned with UAC-021", () => {
    expect(readme).toContain("## `vault_query` Tool Usage");
    expect(readme).toContain("query: string;");
    expect(readme).toContain("maxResults?: number;");
    expect(readme).toContain("noteTypes?: string[];");
    expect(readme).toContain("context?: string;");
  });
});
