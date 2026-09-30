import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../', import.meta.url));
const config = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
const configured = /database_id\s*=\s*"([^"]+)"/.exec(config)?.[1];
const databaseId = process.env.FEEDBACK_DATABASE_ID || configured;
if (!databaseId || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(databaseId) || databaseId === '00000000-0000-0000-0000-000000000000') {
  throw new Error('Set FEEDBACK_DATABASE_ID or replace the local D1 placeholder before deployment.');
}
const temporary = new URL(`../wrangler.feedback.${process.pid}.toml`, import.meta.url);
try {
  await writeFile(temporary, config.replace(/database_id\s*=\s*"[^"]+"/, `database_id = "${databaseId}"`));
  for (const args of [ ['d1', 'migrations', 'apply', 'FEEDBACK_DB', '--remote'], ['deploy'] ]) {
    const result = spawnSync('npx', ['wrangler', ...args, '--config', fileURLToPath(temporary)], { cwd: directory, stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Wrangler ${args[0]} failed (${result.status})`);
  }
} finally { await unlink(temporary).catch(() => {}); }
