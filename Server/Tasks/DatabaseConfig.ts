const placeholder = "00000000-0000-0000-0000-000000000000";
const validId = (id: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) && id !== placeholder;

/** Bind each database by its binding name, never by its position in the TOML. */
export function configureDatabases(config: string, env: Record<string, string | undefined>, lookup: (name: string) => string | undefined): string {
  const expected = new Map([["FEEDBACK_DB", "FEEDBACK_DATABASE_ID"], ["LYRICS_CACHE_DB", "LYRICS_CACHE_DATABASE_ID"]]);
  const seen = new Set<string>();
  const result = config.replace(/\[\[d1_databases\]\][\s\S]*?(?=\n\[|$)/g, block => {
    const binding = /binding\s*=\s*"([^"]+)"/.exec(block)?.[1];
    if (!binding || !expected.has(binding)) return block;
    if (seen.has(binding)) throw new Error(`Duplicate database binding: ${binding}`);
    seen.add(binding);
    const variable = expected.get(binding)!;
    const configured = /database_id\s*=\s*"([^"]+)"/.exec(block)?.[1];
    let id = env[variable] || configured;
    if (!env[variable] && (!id || id === placeholder) && binding === "LYRICS_CACHE_DB") {
      const name = /database_name\s*=\s*"([^"]+)"/.exec(block)?.[1];
      if (name) id = lookup(name);
    }
    if (!id || !validId(id)) throw new Error(`Set ${variable} or configure a valid database_id for ${binding}.`);
    return block.replace(/database_id\s*=\s*"[^"]+"/, `database_id = "${id}"`);
  });
  for (const binding of expected.keys()) if (!seen.has(binding)) throw new Error(`Missing database binding: ${binding}`);
  const ids = [...result.matchAll(/database_id\s*=\s*"([^"]+)"/g)].map(match => match[1]);
  if (new Set(ids).size !== ids.length) throw new Error("Feedback and lyrics cache must use different databases.");
  return result;
}
