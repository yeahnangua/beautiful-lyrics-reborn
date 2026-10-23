import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source=stripTypeScriptTypes(await readFile(new URL('../Source/Modules/Metrics.ts',import.meta.url),'utf8'),{mode:'transform'}).replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/\bexport\s+/g,'');
function fixture(){
 let time=0,next=0;const events=[],frames=new Map(),observers=[],listeners=new Map();
 const document={hidden:false,addEventListener:(key,fn)=>listeners.set(fn,key),removeEventListener:(_key,fn)=>listeners.delete(fn)};
 class Observer{constructor(fn){this.fn=fn;observers.push(this)}observe(){}disconnect(){this.closed=true}show(visible){if(!this.closed)this.fn([{isIntersecting:visible}])}}
 const client={emit:(kind,fields)=>events.push({kind,...fields}),destroy(){}};
 const mocks={createMetricsClient:()=>client,GlobalMaid:{Give(){}},document,IntersectionObserver:Observer,performance:{now:()=>time},requestAnimationFrame:fn=>{frames.set(++next,fn);return next},cancelAnimationFrame:id=>frames.delete(id)};
 const api=new Function(...Object.keys(mocks),source+'\nreturn {BeginLyricsMeasurement,MeasureLyricsDisplay,CancelLyricsDisplay};')(...Object.values(mocks));
 const element={isConnected:true,getClientRects:()=>[{}]};
 return {...api,events,observers,element,document,advance:value=>time=value,paint(){for(let i=0;i<2;i++){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn())}},visibility(hidden){document.hidden=hidden;for(const [fn,key] of listeners)if(key==='visibilitychange')fn()}};
}
test('visible waiting spans loading to paint and duplicates across views are excluded',()=>{
 const f=fixture();f.BeginLyricsMeasurement();const stop=f.MeasureLyricsDisplay(f.element,'page');f.observers.at(-1).show(true);
 f.advance(100);stop();f.MeasureLyricsDisplay(f.element,'page','Line');f.observers.at(-1).show(true);f.advance(120);f.paint();
 const rows=f.events.filter(e=>e.kind==='lyrics_display');assert.equal(rows.length,1);assert.equal(rows[0].durationMs,120);
 f.MeasureLyricsDisplay(f.element,'card','Line');f.observers.at(-1).show(true);f.paint();assert.equal(f.events.filter(e=>e.kind==='lyrics_display').length,1);
});
test('hidden, cancelled and stale generations cannot report a display',()=>{
 const f=fixture();f.BeginLyricsMeasurement();const stop=f.MeasureLyricsDisplay(f.element,'page','Line');f.observers.at(-1).show(true);stop();f.paint();assert.equal(f.events.length,1);
 f.MeasureLyricsDisplay(f.element,'page','Line');f.observers.at(-1).show(true);f.BeginLyricsMeasurement();f.paint();assert.equal(f.events.length,1);
 f.MeasureLyricsDisplay(f.element,'page');f.observers.at(-1).show(true);f.advance(100);f.visibility(true);f.advance(1000);f.visibility(false);
 f.MeasureLyricsDisplay(f.element,'page','Line');f.observers.at(-1).show(true);f.advance(1020);f.paint();assert.equal(f.events.at(-1).durationMs,20);
});
