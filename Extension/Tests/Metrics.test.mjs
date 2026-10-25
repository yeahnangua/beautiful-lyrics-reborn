import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetricsClient } from '../Spices/AutoUpdate/MetricsClient.mjs';
test('metrics use a fixed allowlist, batch at twenty, omit credentials and never retry',async()=>{
 const requests=[],listeners=new Map();let tick,cleared=false;
 const client=createMetricsClient({fetch:async(...args)=>{requests.push(args);throw Error('offline')},setInterval:fn=>{tick=fn;return 1},clearInterval:()=>{cleared=true},addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)},'5.2.3');
 client.emit('unrecognized',{song:'secret'});
 for(let i=0;i<20;i++)client.emit('session',{song:'secret',account:'secret',token:'secret'});
 await new Promise(r=>setImmediate(r));assert.equal(requests.length,1);
 const options=requests[0][1];assert.equal(options.credentials,'omit');assert.equal(JSON.parse(options.body).events.length,20);assert.doesNotMatch(options.body,/secret/);
 assert.equal(options.headers['User-Agent'],'beautiful-lyrics-reborn');
 tick();await new Promise(r=>setImmediate(r));assert.equal(requests.length,1);
 client.emit('fullscreen_first');listeners.get('pagehide')();await new Promise(r=>setImmediate(r));assert.equal(requests[1][1].keepalive,true);
 client.destroy();assert.equal(cleared,true);assert.equal(listeners.size,0);
});
