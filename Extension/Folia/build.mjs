import { build } from 'vite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Build a self-contained ES module; CSS stays inside its Shadow DOM, never in Spotify's document.
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
const bundledPackages = new Set();
await build({ plugins: [{
  name: 'folia-license-inventory',
  generateBundle() {
    for (const id of this.getModuleIds()) {
      const suffix = id.split('/node_modules/').at(-1);
      if (suffix === id || !suffix) continue;
      const parts = suffix.split('/');
      bundledPackages.add(parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
    }
  },
}] });
await writeFile('dist/folia.d.mts', "export { mountFolia } from '../src/runtime';\n");
let notices = 'Folia visualizers, chthollyphile and Folia contributors\nSource: https://github.com/chthollyphile/folia-major\nRevision: 43605cd8e562b7aa0e5897478856ce3604a054a1\n\n';
notices += await readFile('vendor/LICENSE', 'utf8');
for (const name of [...bundledPackages].sort()) {
  const directory = join('node_modules', name);
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  notices += `\n\n--- ${name} ${pkg.version} (${pkg.license ?? 'see package license'}) ---\n`;
  for (const file of (await readdir(directory)).filter(file => /^(licen[cs]e|copying|notice)(\.|$)/i.test(file)).sort()) {
    notices += await readFile(join(directory, file), 'utf8');
  }
}
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices);
const runtime = await readFile('dist/folia.mjs', 'utf8');
await writeFile('dist/folia.mjs', `/*!\n${notices.replaceAll('*/', '* /')}\n*/\n${runtime}`);
