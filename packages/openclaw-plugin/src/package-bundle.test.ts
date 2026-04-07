import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

const packageDir = resolve(fileURLToPath(new URL('..', import.meta.url)));

function fileURLToPath(url: URL): string {
  return decodeURIComponent(url.pathname);
}

describe('openclaw plugin package bundling', () => {
  it(
    'packs runtime artifacts that are self-contained outside the monorepo',
    () => {
      const packDir = mkdtempSync(join(tmpdir(), 'openclaw-plugin-pack-'));

      try {
        execSync(`pnpm pack --pack-destination "${packDir}"`, { cwd: packageDir, stdio: 'pipe' });

        const tarball = readdirSync(packDir).find((name) => name.endsWith('.tgz'));
        expect(tarball).toBeTruthy();

        const tarballPath = join(packDir, tarball ?? '');
        const packedRuntime = execSync(`tar -xOf "${tarballPath}" package/dist/runtime.js`, {
          encoding: 'utf-8',
        });
        expect(packedRuntime).not.toMatch(/from\s+['"]@ghostwater\/vault-engine['"]/);
        expect(packedRuntime).not.toMatch(/require\(['"]@ghostwater\/vault-engine['"]\)/);
      } finally {
        rmSync(packDir, { recursive: true, force: true });
      }
    },
    60_000
  );
});
