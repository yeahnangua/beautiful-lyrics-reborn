/** Wait for plugin work and concatenate styles in source import order, not completion order. */
export async function compileWithStyles(build, styles) {
  const result = await build();
  const values = new Map(await Promise.all([...styles].map(async ([path, css]) => [path, await css])));
  const inputs = result.metafile.inputs;
  const ordered = [];
  const visited = new Set();
  const visit = path => {
    if (visited.has(path)) return;
    visited.add(path);
    for (const dependency of inputs[path]?.imports ?? []) {
      if (!dependency.external) visit(dependency.path);
    }
    if (values.has(path)) ordered.push(values.get(path));
  };
  for (const output of Object.values(result.metafile.outputs)) {
    if (output.entryPoint) visit(output.entryPoint);
  }
  // Keep any plugin-generated styles without graph edges deterministic as well.
  for (const path of [...values.keys()].sort()) visit(path);
  return { result, css: ordered.join("\n") };
}

export function injectStyles(name, css) {
  return `{ const style = document.createElement("style"); style.id = ${JSON.stringify(name)}; style.textContent = ${JSON.stringify(css)}; document.body.appendChild(style); };`;
}
