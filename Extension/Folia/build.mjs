import { build } from 'vite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateNebbiaFiles } from './nebbia-strokes-build.mjs';
import { createHash } from 'node:crypto';

// Build a self-contained ES module; CSS stays inside its Shadow DOM, never in Spotify's document.
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
const auxiliary = await generateNebbiaFiles();
const strokes = auxiliary.get('nebbia-strokes.json');
if (!strokes) throw Error('Missing Nebbia stroke data');
const strokeHash = createHash('sha256').update(strokes).digest('hex');
const strokeAsset = { file: `beautiful-lyrics-reborn-nebbia.${strokeHash.slice(0,16)}.json`, sha256: strokeHash };
const bundledPackages = new Set();
await build({ define: { __NEBBIA_ASSET__: JSON.stringify(strokeAsset),
  __NEBBIA_INLINE__: process.env.FOLIA_INLINE_ASSETS === '1' ? JSON.stringify(strokes.toString('utf8')) : 'undefined' }, plugins: [{
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
await writeFile('dist/' + strokeAsset.file, strokes);
await writeFile('dist/auxiliary.json', JSON.stringify({ nebbia: strokeAsset }));
await writeFile('dist/folia.d.mts', "export { mountFolia } from '../src/runtime';\n");
let notices = 'Folia visualizers, chthollyphile and Folia contributors\nSource: https://github.com/chthollyphile/folia-major\nRevision: 3b91924f1e2da7b7f8f9cf1e0cd0b25d4a789e6d\n\n';
notices += await readFile('vendor/LICENSE', 'utf8');
for (const file of ['src/components/visualizer/cappella/avatar/README.md', 'src/components/visualizer/cappella/emo/README.md',
  'src/components/visualizer/nebbia/nebbiaRaindrop.LICENSE.txt']) {
  notices += `\n--- ${file} ---\n` + await readFile('vendor/' + file, 'utf8');
}
for (const [name, content] of auxiliary) if (name !== 'nebbia-strokes.json') notices += `\n--- ${name} ---\n` + content.toString('utf8');
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
