import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configureDatabases } from './DatabaseConfig.ts';
import { checkLyricsAuthDeployment, wranglerBin } from './CheckLyricsAuth.mjs';
// Stop before database migrations or deployment when authentication is not ready.
await checkLyricsAuthDeployment();
const directory = fileURLToPath(new URL('../', import.meta.url));
const config = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
const configured = configureDatabases(config, process.env);
const temporary = new URL(`../wrangler.databases.${process.pid}.toml`, import.meta.url);
try {
  await writeFile(temporary, configured);
  for (const args of [
    ['d1', 'migrations', 'apply', 'FEEDBACK_DB', '--remote'],
    ['deploy']
  ]) {
    const result = spawnSync(process.execPath, [wranglerBin, ...args, '--config', fileURLToPath(temporary)], { cwd: directory, stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Wrangler ${args[0]} failed (${result.status})`);
  }
} finally { await unlink(temporary).catch(() => {}); }
