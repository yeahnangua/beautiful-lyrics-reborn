import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configureDatabases } from './DatabaseConfig.ts';
const directory = fileURLToPath(new URL('../', import.meta.url));
const config = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
const configured = configureDatabases(config, process.env, name => {
  const result = spawnSync('npx', ['wrangler', 'd1', 'list', '--json'], {
    cwd: directory, encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'inherit']
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Cannot resolve the lyrics-cache database. Set LYRICS_CACHE_DATABASE_ID explicitly.');
  const matches = JSON.parse(result.stdout).filter(database => database.name === name);
  if (matches.length !== 1) throw new Error(`Expected exactly one D1 database named ${name}. Set LYRICS_CACHE_DATABASE_ID explicitly.`);
  return matches[0].uuid;
});
const temporary = new URL(`../wrangler.databases.${process.pid}.toml`, import.meta.url);
try {
  await writeFile(temporary, configured);
  for (const args of [
    ['d1', 'migrations', 'apply', 'FEEDBACK_DB', '--remote'],
    ['d1', 'migrations', 'apply', 'LYRICS_CACHE_DB', '--remote'],
    ['deploy']
  ]) {
    const result = spawnSync('npx', ['wrangler', ...args, '--config', fileURLToPath(temporary)], { cwd: directory, stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Wrangler ${args[0]} failed (${result.status})`);
  }
} finally { await unlink(temporary).catch(() => {}); }
