import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createFullscreenLoader } from '../Spices/AutoUpdate/FullscreenLoader.mjs';
const bytes = new TextEncoder().encode('export const mountFolia = () => {};');
const hash = createHash('sha256').update(bytes).digest('hex');
const descriptor = { api: 1, sha256: hash, file: `beautiful-lyrics-reborn-fullscreen.${hash.slice(0,16)}.mjs` };
function fixture(fetch, stored) {
  const calls=[],cache=new Map(stored?[[descriptor.file,stored]]:[]);let imports=0,opens=0;
  const runtime={crypto:webcrypto,fetch:async(...args)=>{calls.push(args);return fetch(...args)},
    caches:{async open(){opens++;return {match:async()=>cache.get(descriptor.file)?.clone(),delete:async()=>cache.delete(descriptor.file),put:async(_key,response)=>cache.set(descriptor.file,response),keys:async()=>[]}}},
    URL:{createObjectURL:()=> 'blob:fullscreen',revokeObjectURL(){}},importModule:async()=>{imports++;return {mountFolia(){}}}};
  return {runtime,calls,cache,state:()=>({imports,opens})};
}
test('startup is inert, concurrent clicks share verified load, memory and persistent cache avoid downloads',async()=>{
 const f=fixture(async()=>new Response(bytes));const load=createFullscreenLoader(descriptor,f.runtime);
 assert.deepEqual(f.state(),{imports:0,opens:0});assert.equal(f.calls.length,0);
 const parent=new AbortController();const [a,b]=await Promise.all([load(parent.signal),load(parent.signal)]);
 assert.equal(a.source,'network');assert.equal(b.mountFolia,a.mountFolia);assert.equal(f.state().imports,1);
 await load(parent.signal);assert.equal(f.calls.length,2);
 const second=createFullscreenLoader(descriptor,f.runtime);assert.equal((await second(parent.signal)).source,'cache');assert.equal(f.calls.length,2);
});
test('corrupt cache and mirror bytes are rejected; verified CDN fallback is cached',async()=>{
 const f=fixture(async url=>new Response(url.includes('jsdelivr')?bytes:'corrupt'),new Response('corrupt'));
 const loaded=await createFullscreenLoader(descriptor,f.runtime)(new AbortController().signal);
 assert.equal(loaded.source,'network');assert.equal(f.calls.length,3);assert.equal(f.state().imports,1);
});
test('cancellation aborts both mirrors and prevents import; a later opening can retry',async()=>{
 let hang=true;const f=fixture(async(_url,{signal})=>hang?new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})):new Response(bytes));
 const load=createFullscreenLoader(descriptor,f.runtime),controller=new AbortController(),pending=load(controller.signal);
 await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(pending,{name:'AbortError'});
 assert.equal(f.state().imports,0);assert.ok(f.calls.every(([,o])=>o.signal.aborted));hang=false;
 assert.equal((await load(new AbortController().signal)).source,'network');
});
test('invalid descriptor and unavailable storage cannot bypass checksum validation',async()=>{
 const f=fixture(async()=>new Response(bytes));f.runtime.caches.open=async()=>{throw Error('restricted')};
 assert.equal((await createFullscreenLoader(descriptor,f.runtime)(new AbortController().signal)).source,'network');
 await assert.rejects(createFullscreenLoader({...descriptor,sha256:'0'.repeat(64)},f.runtime)(new AbortController().signal),/descriptor/);
});

test('a cold opening after rollback fetches the descriptor pinned by that main release',async()=>{
 const previousBytes = new TextEncoder().encode('export const mountFolia = () => "previous release";');
 const previousHash = createHash('sha256').update(previousBytes).digest('hex');
 const previous = { api: 1, sha256: previousHash, file: `beautiful-lyrics-reborn-fullscreen.${previousHash.slice(0,16)}.mjs` };
 const f=fixture(async url=>new Response(url.endsWith(previous.file)?previousBytes:bytes));
 f.runtime.caches=undefined;
 await createFullscreenLoader(descriptor,f.runtime)(new AbortController().signal);
 const before=f.calls.length;
 assert.equal((await createFullscreenLoader(previous,f.runtime)(new AbortController().signal)).source,'network');
 assert.ok(f.calls.slice(before).every(([url])=>url.endsWith(previous.file)));
 assert.equal(f.state().imports,2);
});
