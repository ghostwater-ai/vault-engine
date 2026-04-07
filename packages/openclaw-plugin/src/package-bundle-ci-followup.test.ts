import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');
const pluginPackageDir = resolve(repoRoot, 'packages/openclaw-plugin');
const pluginRuntimeDistPath = resolve(pluginPackageDir, 'dist/runtime.js');
const workspacePackageName = '@ghostwater/vault-engine';

function hasRuntimeImportEdge(source: string): boolean {
  const sourceFile = ts.createSourceFile('runtime.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let hasEdge = false;

  const isWorkspaceLiteral = (node: ts.Expression | undefined): boolean =>
    Boolean(node && ts.isStringLiteral(node) && node.text === workspacePackageName);

  const visit = (node: ts.Node): void => {
    if (hasEdge) {
      return;
    }

    if (ts.isImportDeclaration(node) && isWorkspaceLiteral(node.moduleSpecifier)) {
      hasEdge = true;
      return;
    }

    if (ts.isExportDeclaration(node) && isWorkspaceLiteral(node.moduleSpecifier)) {
      hasEdge = true;
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      isWorkspaceLiteral(node.arguments[0])
    ) {
      hasEdge = true;
      return;
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      isWorkspaceLiteral(node.arguments[0])
    ) {
      hasEdge = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return hasEdge;
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
              pnpm: {
                overrides: {
                  chokidar: '5.0.0',
                  'gray-matter': '4.0.3',
                  minisearch: '7.2.0',
                  stemmer: '2.0.1',
                },
              },
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
