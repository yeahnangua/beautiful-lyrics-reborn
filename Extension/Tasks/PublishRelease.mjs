import { readFile, writeFile, mkdir, cp, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = join(root, 'Extension/Builds/Release');
const state = join(root, 'Server/.wrangler/publication');
const path = 'Extension/Builds/Release';
const command = (binary, args, cwd = root) => {
  const result = spawnSync(binary, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error || result.status) throw result.error ?? Error(`${binary} failed (${result.status})`);
};
const gitText = args => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status) throw Error(result.stderr);
  return result.stdout.trim();
};
const sourceHead = gitText(['rev-parse','HEAD']);
if (gitText(['ls-remote','origin','refs/heads/main']).split(/\s/)[0] !== sourceHead) throw Error('Main advanced; rebuild the latest source before publication');
const descriptor = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [descriptor, descriptor.fullscreen, ...Object.values(descriptor.fullscreen?.assets ?? {})].filter(Boolean);
for (const item of files) {
  if (!/^beautiful-lyrics-reborn(?:-fullscreen|-nebbia)?\.[a-f0-9]{16}\.(?:mjs|json)$/.test(item.file) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw Error('Invalid release descriptor');
  if (digest(await readFile(join(directory, item.file))) !== item.sha256) throw Error(`Invalid build ${item.file}`);
}
await mkdir(state, { recursive: true });
await writeFile(join(state, 'next.json'), JSON.stringify(descriptor, null, 2) + '\n');
const nextLoader = await readFile(join(directory, 'beautiful-lyrics-reborn.mjs'));
const live = await fetch('https://lyrics.txw.qzz.io/Release/latest.json', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
if (!live.ok) throw Error(`Cannot read current publication (${live.status})`);
const previous = await live.json();
if (!/^[a-f0-9]{64}$/.test(previous.sha256)) throw Error('Invalid previous publication');
for (const item of [previous, previous.fullscreen, ...Object.values(previous.fullscreen?.assets ?? {})].filter(Boolean)) {
  if (!/^beautiful-lyrics-reborn(?:-fullscreen|-nebbia)?\.[a-f0-9]{16}\.(?:mjs|json)$/.test(item.file) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw Error('Invalid previous asset');
  const local = join(directory,item.file);
  if (!existsSync(local)) {
    const response=await fetch('https://lyrics.txw.qzz.io/Release/'+item.file,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error('Cannot preserve previous asset');
    const bytes=Buffer.from(await response.arrayBuffer());
    if(digest(bytes)!==item.sha256)throw Error('Previous asset checksum mismatch');
    await writeFile(local,bytes);
  }
}
await writeFile(join(state, 'previous.json'), JSON.stringify(previous, null, 2) + '\n');

// New server/assets first, but keep the user-visible pointer at the known-good build.
const loaderResult = spawnSync('git',['show','HEAD:Extension/Builds/Release/beautiful-lyrics-reborn.mjs'],{cwd:root});
if (loaderResult.status !== 0) throw Error('Cannot preserve stable loader');
const previousLoader = loaderResult.stdout;
await writeFile(join(directory,'beautiful-lyrics-reborn.mjs'),previousLoader);
await writeFile(join(directory, 'latest.json'), JSON.stringify(previous, null, 2) + '\n');
try {
  command(process.execPath, ['Server/Tasks/Deploy.mjs']);
  command(process.execPath, ['Extension/Tasks/VerifyPublishedRelease.mjs', '--assets-only', '--expected', join(state, 'next.json')]);
} finally {
  await writeFile(join(directory,'beautiful-lyrics-reborn.mjs'),nextLoader);
  await writeFile(join(directory, 'latest.json'), JSON.stringify(descriptor, null, 2) + '\n');
}

const worktree = join(state, 'releases');
if (!existsSync(join(worktree, '.git'))) {
  const remote = gitText(['ls-remote', '--heads', 'origin', 'releases']);
  if (remote) {
    command('git', ['fetch', 'origin', 'releases']);
    command('git', ['worktree', 'add', '--detach', worktree, 'FETCH_HEAD']);
  } else {
    command('git', ['worktree', 'add', '--detach', worktree, 'HEAD']);
    command('git', ['switch', '--orphan', `codex/release-artifacts-${process.pid}`], worktree);
  }
}
const target = join(worktree, path);
await mkdir(target, { recursive: true });
await writeFile(join(worktree,'.gitattributes'),'Extension/Builds/Release/* -text\n');
// This checkout owns only release artifacts; remove obsolete assets from its tree,
// while Git history retains every published immutable version.
const stagedNames = new Set(await readdir(directory));
for (const name of await readdir(target)) {
  if (/^beautiful-lyrics-reborn(?:-fullscreen|-nebbia)?\.[a-f0-9]{16}\.(?:mjs|json)$/.test(name) && !stagedNames.has(name)) await unlink(join(target,name));
}
for (const name of await readdir(directory)) {
  if (/^beautiful-lyrics-reborn(?:-fullscreen|-nebbia)?\.[a-f0-9]{16}\.(?:mjs|json)$/.test(name)) await cp(join(directory,name),join(target,name));
}
const commitRelease = message => {
  command('git', ['add', path, '.gitattributes'], worktree);
  const changed = spawnSync('git',['diff','--cached','--quiet'],{cwd:worktree}).status !== 0;
  if (changed) command('git', ['-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','-m',message],worktree);
  command('git', ['push','origin','HEAD:refs/heads/releases'],worktree);
};
commitRelease(`build: stage immutable assets ${descriptor.sha256.slice(0,16)}`);
command(process.execPath, ['Extension/Tasks/VerifyPublishedRelease.mjs','--assets-only','--cdn-only','--expected',join(state,'next.json')]);
// Atomically switch the assets and pointer together in one Worker deployment.
try {
 command(process.execPath, ['Server/Tasks/Deploy.mjs']);
 command(process.execPath, ['Extension/Tasks/VerifyPublishedRelease.mjs']);
} catch (error) {
 await writeFile(join(directory,'latest.json'),JSON.stringify(previous,null,2)+'\n');
 await writeFile(join(directory,'beautiful-lyrics-reborn.mjs'),previousLoader);
 try { command(process.execPath,['Server/Tasks/Deploy.mjs']); }
 finally { await writeFile(join(directory,'latest.json'),JSON.stringify(descriptor,null,2)+'\n');await writeFile(join(directory,'beautiful-lyrics-reborn.mjs'),nextLoader); }
 throw error;
}
await cp(join(directory,'latest.json'),join(target,'latest.json'));
await writeFile(join(target,'beautiful-lyrics-reborn.mjs'),nextLoader);
commitRelease(`build: publish ${descriptor.version}`);
// Main keeps the stable Marketplace entry; old hashed files remain for old loaders.
command('git',['add',`${path}/beautiful-lyrics-reborn.mjs`,`${path}/latest.json`]);
if (spawnSync('git',['diff','--cached','--quiet'],{cwd:root}).status !== 0) {
  command('git',['-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','-m','build: update stable extension loader']);
  command('git',['push','origin','HEAD:main']);
}
