import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),assetsOnly=args.includes('--assets-only'),cdnOnly=args.includes('--cdn-only');
const expectedPath=args.includes('--expected')?args[args.indexOf('--expected')+1]:new URL('../Builds/Release/latest.json',import.meta.url);
const expected=JSON.parse(await readFile(expectedPath,'utf8'));
const local=args.find(arg=>/^https?:/.test(arg));
const hosts=local?[local]:['https://beautiful-lyrics-reborn-server.1135746060.workers.dev','https://lyrics.txw.qzz.io','https://lyrics.20050129.xyz'];
const cdn='https://cdn.jsdelivr.net/gh/yeahnangua/beautiful-lyrics-reborn@releases/Extension/Builds/Release/';
async function get(url){const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(60000)});assert.equal(response.status,200,'HTTP status '+url);return response}
async function payload(base,item){
 const response=await get(new URL(item.file,base));
 assert.match(response.headers.get('content-type')??'',item.file.endsWith('.json')?/json/:/javascript/);
 if(!cdnOnly){assert.match(response.headers.get('cache-control')??'',/immutable/);assert.equal(response.headers.get('access-control-allow-origin'),'*')}
 assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),item.sha256,'Checksum '+item.file);
}
async function verify(){
 const files=[expected,expected.fullscreen,...Object.values(expected.fullscreen?.assets??{})].filter(Boolean);
 if(cdnOnly){for(const item of files)await payload(cdn,item);return}
 for(const host of hosts){
  for(const prefix of ['/Release/','/extension/']){
   const base=new URL(prefix,host);
   if(!assetsOnly){const pointer=await get(new URL('latest.json',base));assert.equal(pointer.headers.get('cache-control'),'no-store');assert.equal(pointer.headers.get('access-control-allow-origin'),'*');assert.deepEqual(await pointer.json(),expected)}
   for(const item of files){if(prefix==='/extension/'&&item.file.endsWith('.json'))continue;await payload(base,item)}
  }
  if(!assetsOnly){const loader=await get(new URL('/Release/beautiful-lyrics-reborn.mjs',host));assert.equal(loader.headers.get('cache-control'),'no-store');assert.equal(loader.headers.get('access-control-allow-origin'),'*');assert.match(loader.headers.get('content-type')??'',/javascript/);await loader.body?.cancel()}
 }
}
for(let attempt=0;;attempt++){
 try{await verify();console.log('Verified release '+expected.version+' '+expected.sha256.slice(0,16));break}
 catch(error){if(attempt===3)throw error;console.warn(error.message);await new Promise(resolve=>setTimeout(resolve,5000))}
}
