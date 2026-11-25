// Inventory the isolated Folia graph, including Vite glob and lazy entry points.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = fileURLToPath(new URL('./vendor/', import.meta.url));
const kept = new Set();
function resolve(base, name) {
  const target = path.resolve(root, path.dirname(base), name.split('?')[0]);
  return [target, target + '.ts', target + '.tsx', target + '.mjs', path.join(target, 'index.ts'), path.join(target, 'index.tsx')]
    .find(file => fs.existsSync(file) && fs.statSync(file).isFile());
}
function walk(directory, callback) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file, callback); else callback(file);
  }
}
function visit(relative) {
  if (kept.has(relative)) return;
  kept.add(relative);
  if (!/\.(tsx?|mjs)$/.test(relative)) return;
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  const specifier = name => {
    if (!name.startsWith('.')) return;
    const file = resolve(relative, name);
    if (file) visit(path.relative(root, file).replaceAll('\\', '/'));
  };
  for (const imported of ts.preProcessFile(text).importedFiles) specifier(imported.fileName);
  function traverse(node) {
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier(node.arguments[0].text);
      if (node.expression.getText(source) === 'import.meta.glob') {
        const glob = node.arguments[0].text;
        const expression = new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replaceAll('**', '@@').replaceAll('*', '[^/]*').replaceAll('@@', '.*') + '$');
        const directory = path.dirname(path.join(root, relative));
        walk(directory, file => {
          if (expression.test('./' + path.relative(directory, file).replaceAll('\\', '/'))) visit(path.relative(root, file).replaceAll('\\', '/'));
        });
      }
    }
    ts.forEachChild(node, traverse);
  }
  traverse(source);
}
for (const relative of [
  'src/components/visualizer/VisualizerRenderer.tsx', 'src/components/visualizer/still/VisualizerStill.tsx',
  'src/components/visualizer/backgrounds/VisualizerBackgroundRenderer.tsx', 'src/components/visualizer/registry.tsx',
  'src/components/visualizer/backgrounds/registry.tsx', 'src/services/baseThemes.ts',
  'src/components/floating-player/PlayerBottomBarLayoutContext.ts', 'src/types/visualizerModes.ts',
  'src/services/beatFx/beatFxLive.ts', 'src/stores/useVisualizerSettingsStore.ts',
]) visit(relative);
if (process.argv.includes('--prune')) {
  walk(path.join(root, 'src'), file => {
    if (!file.startsWith(path.join(root, 'src') + path.sep)) throw Error('Invalid vendor path');
    if (/\.(tsx?|mjs)$/.test(file) && !kept.has(path.relative(root, file).replaceAll('\\', '/'))) fs.unlinkSync(file);
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'provenance.json'), 'utf8'));
  manifest.files = [...kept].sort();
  fs.writeFileSync(path.join(root, 'provenance.json'), JSON.stringify(manifest, null, 2) + '\n');
}
console.log(`Folia runtime graph: ${kept.size} files`);
