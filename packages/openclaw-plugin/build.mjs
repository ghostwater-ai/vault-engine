import * as esbuild from 'esbuild';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Get all .js files in dist (these are the tsc outputs)
const distDir = new URL('./dist/', import.meta.url).pathname;
const files = await readdir(distDir);
const entryPoints = files
  .filter(f => f.endsWith('.js'))
  .map(f => join(distDir, f));

// Bundle each entry point, inlining @ghostwater/vault-engine
// but keeping other deps external (they're listed in package.json dependencies)
await esbuild.build({
  entryPoints,
  outdir: distDir,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  allowOverwrite: true,
  // Externalize runtime dependencies and openclaw (peerDep)
  // Do NOT externalize @ghostwater/vault-engine - it gets bundled in
  external: [
    'chokidar',
    'gray-matter',
    'minisearch',
    'stemmer',
    'openclaw',
    'openclaw/*',
    'node:*',
  ],
});
