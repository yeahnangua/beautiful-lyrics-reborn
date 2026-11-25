import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const source=(await readFile(new URL('../Tasks/PublishRelease.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function publication(fail){
 const root=path.resolve('publication-fixture'),directory=path.join(root,'Extension/Builds/Release'),files=new Map(),events=[];
 const build=code=>{const sha256=digest(code);return {schema:1,version:'5.4.0',file:`beautiful-lyrics-reborn.${sha256.slice(0,16)}.mjs`,sha256}};
 const previous=build('old'),next=build('new');
 files.set(path.join(directory,previous.file),Buffer.from('old'));files.set(path.join(directory,next.file),Buffer.from('new'));
 files.set(path.join(directory,'latest.json'),Buffer.from(JSON.stringify(next)));files.set(path.join(directory,'beautiful-lyrics-reborn.mjs'),Buffer.from('new loader'));
 let deployments=0;
 const spawnSync=(_bin,args,options={})=>{
  const command=args.join(' ');events.push({command,pointer:JSON.parse(files.get(path.join(directory,'latest.json')).toString()).sha256});
  let stdout='';
  if(command==='rev-parse HEAD')stdout='source';
  if(command==='ls-remote origin refs/heads/main')stdout='source\trefs/heads/main';
  if(command.startsWith('show HEAD:'))return {status:0,stdout:Buffer.from('old loader')};
  if(command.includes('Server/Tasks/Deploy.mjs')){deployments++;if(fail==='stage'&&deployments===1)return {status:1};}
  if(command.includes('VerifyPublishedRelease.mjs')&&((fail==='cdn'&&command.includes('--cdn-only'))||(fail==='promotion'&&!command.includes('--assets-only'))))return {status:1};
  if(command==='diff --cached --quiet')return {status:1};
  return {status:0,stdout,stderr:''};
 };
 const execute=new AsyncFunction('readFile','writeFile','mkdir','cp','readdir','unlink','existsSync','spawnSync','resolve','join','fileURLToPath','createHash','fetch',source.replaceAll('import.meta.url',JSON.stringify('file:///fixture/Extension/Tasks/PublishRelease.mjs')));
 let error;
 try{await execute(async file=>files.get(String(file)),async(file,bytes)=>files.set(String(file),Buffer.from(bytes)),async()=>{},async(from,to)=>files.set(to,files.get(from)),async dir=>[...files.keys()].filter(file=>path.dirname(file)===dir).map(file=>path.basename(file)),async file=>files.delete(file),file=>files.has(file),spawnSync,path.resolve,path.join,()=>root,createHash,async()=>Response.json(previous));}catch(caught){error=caught;}
 return {events,error,previous,next,deployments};
}
test('publication stages assets before pointers and publishes main last',async()=>{
 const result=await publication();assert.equal(result.error,undefined);
 const deploys=result.events.filter(event=>event.command.includes('Server/Tasks/Deploy.mjs'));
 assert.deepEqual(deploys.map(event=>event.pointer),[result.previous.sha256,result.next.sha256]);
 const cdn=result.events.findIndex(event=>event.command.includes('--cdn-only'));
 const promote=result.events.findIndex(event=>event.command==='Server/Tasks/Deploy.mjs'&&event.pointer===result.next.sha256);
 assert.ok(cdn<promote);assert.equal(result.events.at(-1).command,'push origin HEAD:main');
});
test('failed staging or CDN verification cannot publish a new pointer',async()=>{
 for(const fail of ['stage','cdn']){const result=await publication(fail);assert.ok(result.error);assert.equal(result.deployments,1);assert.ok(!result.events.some(event=>event.command==='push origin HEAD:main'));}
});
test('failed promotion verification deploys the previous pointer again',async()=>{
 const result=await publication('promotion');assert.ok(result.error);
 assert.deepEqual(result.events.filter(event=>event.command.includes('Server/Tasks/Deploy.mjs')).map(event=>event.pointer),[result.previous.sha256,result.next.sha256,result.previous.sha256]);
 assert.ok(!result.events.some(event=>event.command==='push origin HEAD:main'));
});
