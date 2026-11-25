import ts from 'typescript';
import { readdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('vendor/src/components/visualizer');
const entries = [];
for (const name of await readdir(root)) entries.push({ key: name, path: resolve(root, name, 'tuning.ts') });
for (const name of await readdir(resolve(root, 'backgrounds'))) entries.push({ key: 'background:' + name, path: resolve(root, 'backgrounds', name, 'tuning.ts') });
const files = entries.filter(entry => ts.sys.fileExists(entry.path));
const program = ts.createProgram(files.map(entry => entry.path), { target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, skipLibCheck: true });
const checker = program.getTypeChecker();
function shape(type, node, depth = 0) {
  if (depth > 5) return { type: 'unknown' };
  const members = type.isUnion() ? type.types.filter(t => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null))) : [type];
  if (members.every(t => t.isStringLiteral() || t.isNumberLiteral())) return { type: 'choice', choices: members.map(t => t.value) };
  if (checker.isArrayType(type)) return { type: 'array', item: shape(checker.getTypeArguments(type)[0], node, depth + 1) };
  if (type.flags & ts.TypeFlags.Object) return { type: 'object', fields: Object.fromEntries(type.getProperties().map(property => [property.name, shape(checker.getTypeOfSymbolAtLocation(property, node), node, depth + 1)])) };
  return { type: checker.typeToString(type) };
}
const result = {};
for (const entry of files) {
  const file = program.getSourceFile(entry.path);
  const exported = checker.getExportsOfModule(checker.getSymbolAtLocation(file)).find(symbol => symbol.name === 'default');
  const type = checker.getTypeOfSymbolAtLocation(exported, file);
  const defaults = type.getProperty('defaults');
  if (defaults) result[entry.key] = shape(checker.getTypeOfSymbolAtLocation(defaults, file), file).fields ?? {};
}
await writeFile('src/tuning-schema.json', JSON.stringify(result, null, 2) + '\n');

// Optional upstream checkout is used only when refreshing the schema, never by a build.
const upstream=resolve('../../Server/.wrangler/folia-upstream-080');
if(ts.sys.directoryExists(upstream)){
 const labels={};
 const locale=ts.sys.readFile(resolve(upstream,'src/i18n/locales/zh-CN.ts'))??'';
 const strings=new Map([...locale.matchAll(/["']?([\w]+)["']?:\s*['"]([^'"\n]+)['"]/g)].map(m=>[m[1],m[2]]));
 for(const entry of files){
  const rel=entry.path.slice(root.length+1);const dir=resolve(upstream,'src/components/visualizer',rel,'..');
  if(!ts.sys.directoryExists(dir))continue;
  for(const name of await readdir(dir)){if(!/Settings.*\.tsx$/.test(name))continue;const text=await readFile(resolve(dir,name),'utf8');
   for(const match of text.matchAll(/label=\{t\('options\.([^']+)'\)\}[\s\S]{0,350}?(?:value|checked)=\{tuning\.(\w+)\}/g)){const value=strings.get(match[1]);if(value)(labels[entry.key]??={})[match[2]]=value;}
  }
 }
 await writeFile('src/tuning-labels.zh.json',JSON.stringify(labels,null,2)+'\n');
}
