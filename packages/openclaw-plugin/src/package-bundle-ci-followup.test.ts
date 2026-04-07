import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');
const pluginPackageDir = resolve(repoRoot, 'packages/openclaw-plugin');
const pluginRuntimeDistPath = resolve(pluginPackageDir, 'dist/runtime.js');
const runtimeImportEdgePatterns = [
  /(?:^|[^\w$])import\s*['"]@ghostwater\/vault-engine['"]/,
  /(?:^|[^\w$])from\s*['"]@ghostwater\/vault-engine['"]/,
  /(?:^|[^\w$])import\s*\(\s*['"]@ghostwater\/vault-engine['"]\s*\)/,
  /(?:^|[^\w$])require\s*\(\s*['"]@ghostwater\/vault-engine['"]\s*\)/,
];

function hasRuntimeImportEdge(source: string): boolean {
  return runtimeImportEdgePatterns.some((pattern) => pattern.test(source));
}

describe('openclaw plugin packaging CI follow-up', () => {
  it(
    'packs runtime artifacts without @ghostwater/vault-engine edges and loads in an external install',
    () => {
      const packDir = mkdtempSync(join(tmpdir(), 'openclaw-plugin-pack-'));
      const installDir = mkdtempSync(join(tmpdir(), 'openclaw-plugin-install-'));

      try {
        execSync('pnpm build', {
          cwd: pluginPackageDir,
          stdio: 'pipe',
        });

        execSync(`pnpm pack --pack-destination "${packDir}"`, {
          cwd: pluginPackageDir,
          stdio: 'pipe',
        });

        const tarball = readdirSync(packDir).find((name) => name.endsWith('.tgz'));
        expect(tarball).toBeTruthy();

        const tarballPath = join(packDir, tarball ?? '');
        const packedRuntime = execSync(`tar -xOf "${tarballPath}" package/dist/runtime.js`, {
          encoding: 'utf8',
        });
        expect(hasRuntimeImportEdge(packedRuntime)).toBe(false);
        expect(packedRuntime).toContain('@ghostwater/vault-engine-openclaw');

        writeFileSync(
          join(installDir, 'package.json'),
          JSON.stringify(
            {
              name: 'openclaw-plugin-pack-test',
              private: true,
              type: 'module',
            },
            null,
            2
          ) + '\n',
          'utf8'
        );

        execSync(`pnpm install "${tarballPath}"`, {
          cwd: installDir,
          stdio: 'pipe',
        });

        expect(() =>
          execSync(
            [
              'node --input-type=module -e',
              `"import { pathToFileURL } from 'node:url';`,
              "import { resolve } from 'node:path';",
              "const runtimePath = resolve('node_modules/@ghostwater/vault-engine-openclaw/dist/runtime.js');",
              'await import(pathToFileURL(runtimePath).href);"',
            ].join(' '),
            { cwd: installDir, stdio: 'pipe' }
          )
        ).not.toThrow();
      } finally {
        rmSync(packDir, { recursive: true, force: true });
        rmSync(installDir, { recursive: true, force: true });
      }
    },
    120_000
  );
});
