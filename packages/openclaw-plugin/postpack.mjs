// Restore devDependencies after packing
import { readFile, writeFile, unlink } from 'node:fs/promises';

const backupPath = new URL('./.prepack-devdeps.json', import.meta.url).pathname;
const pkgPath = new URL('./package.json', import.meta.url).pathname;

try {
  const savedDevDeps = JSON.parse(await readFile(backupPath, 'utf8'));
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.devDependencies = savedDevDeps;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  await unlink(backupPath);
} catch {
  // No backup file means prepack didn't modify anything
}
