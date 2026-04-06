// Remove @ghostwater/vault-engine from devDependencies before packing.
// The package is bundled into dist/ so we don't need it as a dependency.
// This prevents npm install failures when installing the packed tarball.
import { readFile, writeFile } from 'node:fs/promises';

const pkgPath = new URL('./package.json', import.meta.url).pathname;
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));

if (pkg.devDependencies?.['@ghostwater/vault-engine']) {
  // Save original for postpack restoration
  await writeFile(
    new URL('./.prepack-devdeps.json', import.meta.url).pathname,
    JSON.stringify(pkg.devDependencies, null, 2)
  );

  delete pkg.devDependencies['@ghostwater/vault-engine'];
  if (Object.keys(pkg.devDependencies).length === 0) {
    delete pkg.devDependencies;
  }
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}
