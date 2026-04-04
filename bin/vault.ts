#!/usr/bin/env node

/**
 * Vault Engine CLI
 *
 * A retrieval engine for structured Markdown knowledge vaults
 * using BM25 + epistemic scoring.
 */

const HELP_TEXT = `
vault - Retrieval engine for structured Markdown knowledge vaults

USAGE:
  vault <command> [options]

COMMANDS:
  query <text>        Search the vault for relevant documents
  index rebuild       Force a full reindex of the vault
  index stats         Show index statistics

OPTIONS:
  --vault-path <path> Path to the vault directory
  --help, -h          Show this help message
  --version, -v       Show version information

EXAMPLES:
  vault query "what do we think about memory systems?"
  vault query --explain "retrieval architecture"
  vault index stats

For more information, visit: https://github.com/ghostwater-ai/vault-engine
`.trim();

const VERSION = "0.1.0";

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`vault ${VERSION}`);
    process.exit(0);
  }

  // Stub: actual command handling will be implemented in future stories
  console.log(HELP_TEXT);
}

main();
