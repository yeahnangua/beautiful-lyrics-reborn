// Restore the last published assets before building; main no longer accumulates bundles.
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const run=args=>spawnSync('git',args,{cwd:root,encoding:'utf8'});
const remote=run(['ls-remote','--heads','origin','releases']);
if(remote.status!==0)throw Error('Cannot inspect release branch');
if(remote.stdout.trim()){
 const fetched=run(['fetch','origin','releases:refs/remotes/origin/releases']);
 if(fetched.status!==0)throw Error('Cannot fetch published assets');
 const directory='Extension/Builds/Release';
 const files=run(['ls-tree','-r','--name-only','origin/releases','--',directory]);
 if(files.status!==0)throw Error('Cannot list published assets');
 await mkdir(join(root,directory),{recursive:true});
 for(const file of files.stdout.trim().split('\n')){
  if(!/^Extension\/Builds\/Release\/beautiful-lyrics-reborn(?:-fullscreen|-nebbia)?\.[a-f0-9]{16}\.(?:mjs|json)$/.test(file))continue;
  const blob=spawnSync('git',['show','origin/releases:'+file],{cwd:root,maxBuffer:30*1024*1024});
  if(blob.status!==0)throw Error('Cannot restore '+file);
  await writeFile(join(root,file),blob.stdout);
 }
}
