import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createAccessTokenProvider, getPlatformToken } from '../Spices/Spicetify/Services/AccessToken.ts';
import { Abortable, CreateAbortScope } from '../../Universal/Modules/Async.ts';
import { Revision } from '../../Universal/Modules/Revision.ts';
import { compileWithStyles, injectStyles } from '../Spices/Build/Styles.mjs';
import { Maid } from '../../Universal/Modules/Maid.ts';
import { Signal } from '../../Universal/Modules/Signal.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const token = () => ({accessToken:'valid',expiresAtTime:Date.now()+60000,tokenType:'Bearer'});
const fast = {timeoutMs:10,retryDelayMs:1};
const read = path => readFile(new URL(path,import.meta.url),'utf8');
const evaluate = (source, mocks, result) => new Function(...Object.keys(mocks), stripTypeScriptTypes(source, { mode: "transform" }).replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/\bexport\s+/g,'') + `\nreturn ${result};`)(...Object.values(mocks));
const lyricsLoader = source => source.slice(source.indexOf('let lyricsController:'),source.indexOf('export const RetrySongLyricsIfMissing'));

test('token shares in-flight work, retries once, and reuses valid cache', async () => {
 let calls=0; const ready=deferred();
 const get=createAccessTokenProvider(async()=>{if(++calls===1) throw new Error('temporary'); return ready.promise;},()=>undefined,fast);
 const a=get(); assert.equal(get(),a); await new Promise(r=>setTimeout(r,3)); ready.resolve(token());
 assert.equal(await a,'valid'); assert.equal(await get(),'valid'); assert.equal(calls,2);
});
test('final token failure clears pending request and permits recovery',async()=>{
 let fail=true,calls=0; const get=createAccessTokenProvider(async()=>{calls++;if(fail)throw Error('offline');return token();},()=>undefined,fast);
 await assert.rejects(get(),/offline/); assert.equal(calls,2);fail=false;assert.equal(await get(),'valid');assert.equal(calls,3);
});
test('hanging token attempts time out and a later request can recover',async()=>{
 let hung=true,calls=0;const get=createAccessTokenProvider(()=>{calls++;return hung?new Promise(()=>{}):Promise.resolve(token());},()=>undefined,fast);
 await assert.rejects(get(),/timed out/);assert.equal(calls,2);hung=false;assert.equal(await get(),'valid');
});
test('resolver fallback and expired token rejection',async()=>{
 const get=createAccessTokenProvider(async()=>{throw Error('Resolver not found');},token,fast);assert.equal(await get(),'valid');
 const expired=createAccessTokenProvider(async()=>({...token(),expiresAtTime:0}),()=>undefined,fast);await assert.rejects(expired(),/expired/);
});
test('cancelling one token waiter does not cancel the shared token',async()=>{
 const pending=deferred();const get=createAccessTokenProvider(()=>pending.promise,()=>undefined,{...fast,timeoutMs:100});
 const controller=new AbortController();const one=Abortable(controller.signal,get);const two=get();controller.abort();await assert.rejects(one);pending.resolve(token());assert.equal(await two,'valid');
});
test('deadline includes stalled body read and teardown cancels outstanding work',async()=>{
 const scope=CreateAbortScope(5);await assert.rejects(Abortable(scope.Signal,()=>new Promise(()=>{})),{name:'TimeoutError'});scope.Destroy();
 const parent=new AbortController();const child=CreateAbortScope(1000,parent.signal);const waiting=Abortable(child.Signal,()=>new Promise(()=>{}));parent.abort();await assert.rejects(waiting);child.Destroy();
});
const meta={inputs:{main:{imports:[{path:'first'},{path:'second'}]},first:{imports:[]},second:{imports:[]}},outputs:{bundle:{entryPoint:'main'}}};
test('CSS waits for build discovery and delayed styles in import order',async()=>{
 const first=deferred(),second=deferred(),styles=new Map();let done=false;
 const compiled=compileWithStyles(async()=>{await Promise.resolve();styles.set('second',second.promise);styles.set('first',first.promise);return {metafile:meta};},styles).then(value=>{done=true;return value;});
 second.resolve('B');await new Promise(r=>setTimeout(r,2));assert.equal(done,false);first.resolve('A');assert.equal((await compiled).css,'A\nB');
});
test('CSS and build errors reject instead of publishing incomplete output',async()=>{
 await assert.rejects(compileWithStyles(async()=>{throw Error('build failed');},new Map()),/build failed/);
 const css=deferred();const result=compileWithStyles(async()=>({metafile:meta}),new Map([['first',css.promise]]));css.reject(Error('sass failed'));await assert.rejects(result,/sass failed/);
});
test('CSS injection preserves template literals, backslashes and quotes as text',()=>{
 const css='a::after{content:"` ${globalThis.pwned=true} \\\\ \\""}\n';let appended;
 new Function('document',injectStyles('a"b',css))({createElement:()=>({}),body:{appendChild:x=>appended=x}});
 assert.equal(appended.textContent,css);assert.equal(appended.id,'a"b');assert.equal(globalThis.pwned,undefined);
});
test('out-of-order searches, close and destroy invalidate pending callbacks',async()=>{
 const revision=new Revision();let rendered=[];const old=deferred(),fresh=deferred();
 const render=async p=>{const current=revision.Begin();const value=await p;if(current())rendered.push(value);};
 const a=render(old.promise),b=render(fresh.promise);fresh.resolve('new');await b;old.resolve('old');await a;assert.deepEqual(rendered,['new']);
 const late=deferred();const c=render(late.promise);revision.Invalidate();late.resolve('closed');await c;assert.deepEqual(rendered,['new']);
 const reopened=revision.Begin();assert.equal(reopened(),true);revision.Destroy();assert.equal(reopened(),false);assert.equal(revision.Begin()(),false);
});
test('actual lyric transform preserves original words, overlapping timing, and interludes',async()=>{
 const source=await read('../Spices/Spicetify/Services/Player/LyricUtilities.ts');
 const transform=evaluate(source,{franc:()=> 'arb'},'TransformProviderLyrics');
 const vocal=(text,start,end)=>({Type:'Vocal',Text:text,StartTime:start,EndTime:end,OppositeAligned:false});
 const input={Type:'Line',StartTime:3,EndTime:12,Content:[vocal('原文',3,9),vocal('translation',3,5),vocal('next',11,12)]};
 const output=await transform(input);assert.equal(output.NaturalAlignment,'Right');assert.equal(input.Content.length,3);
 assert.deepEqual(output.Content.filter(x=>x.Type==='Interlude'),[{Type:'Interlude',StartTime:0,EndTime:2.75},{Type:'Interlude',StartTime:9,EndTime:10.75}]);
 assert.deepEqual((await transform(output)).Content,output.Content);assert.deepEqual((await transform({...input,Content:[]})).Content,[]);
 assert.equal((await transform({Type:'Static',Lines:[{Text:'中文'}]})).Lines[0].Text,'中文');
});

test('actual player empty-state handler clears state and keeps one cancellable startup task',async()=>{
 const source=await read('../Spices/Spicetify/Services/Player/mod.ts');
 const handler=source.slice(source.indexOf('const OnSongChange = () => {'),source.indexOf('// Make sure that this is a Song and not any other type of track'))+'}\n';
 for(const data of [null,{}, {item:null}]){
  const fired=[];const signals=Object.fromEntries(['SongChangedSignal','SongContextChangedSignal','IsPlayingChangedSignal','IsLikedChangedSignal'].map(k=>[k,{Fire:()=>fired.push(k)}]));
  const get=evaluate('let Song={},Timestamp=20,IsPlaying=true,SongContext={},HasIsLikedLoaded=false,IsLiked=true;'+handler+'OnSongChange();',{SpotifyPlayer:{data},PlayerMaid:{Clean(){}},LoadSongDetails:()=>fired.push('details'),LoadSongLyrics:()=>fired.push('lyrics'),...signals},'({Song,Timestamp,IsPlaying,SongContext,HasIsLikedLoaded,IsLiked})');
  assert.deepEqual(get,{Song:undefined,Timestamp:0,IsPlaying:false,SongContext:undefined,HasIsLikedLoaded:true,IsLiked:false});assert.equal(fired.length,6);
 }
 const tasks=new Map();const handlerFn=evaluate(handler,{SpotifyPlayer:{data:undefined},PlayerMaid:{Clean:k=>tasks.delete(k),Give:(v,k)=>tasks.set(k,v)},Defer:fn=>fn},'OnSongChange');
 for(let i=0;i<50;i++)handlerFn();assert.equal(tasks.size,1);
});

test('dynamic background uses bounded tasks, releases replaced textures and cleans repeated views',async()=>{
 const source=await read('../Source/LyricViews/Shared.ts');const frames=new Map();let id=0;const objects={texture:[],material:[],renderer:[],geometry:[]};
 const resource=kind=>class{disposed=0;constructor(){objects[kind].push(this)}dispose(){this.disposed++}};
 class Element {classList={toggle(){},add(){}};clientWidth=500;clientHeight=500;prepend(){}remove(){}}
 class Observer{observe(){}disconnect(){}}
 const saved={};for(const [key,value]of Object.entries({Element,MutationObserver:Observer,ResizeObserver:Observer,cancelAnimationFrame:handle=>frames.delete(handle)})){saved[key]=globalThis[key];globalThis[key]=value;}
 try{
  const Texture=resource('texture'),Material=resource('material'),Geometry=resource('geometry'),Renderer=resource('renderer');
  class WebGLRenderer extends Renderer{domElement=new Element();setPixelRatio(){}setSize(){}render(){assert.equal(this.disposed,0)}forceContextLoss(){this.lost=true}}
  const THREE={CanvasTexture:Texture,ShaderMaterial:Material,PlaneGeometry:Geometry,WebGLRenderer,Mesh:class{},Scene:class{add(){}remove(){}},OrthographicCamera:class{position={}}};
  const store={Items:{CardLyricsVisible:true,PlaybarDetailsHidden:true,obsolete:true},SaveChanges(){this.saved=true}};
  const uniforms=()=>Object.fromEntries(['BlurredCoverArt','Time','BackgroundCircleOrigin','BackgroundCircleRadius','CenterCircleOrigin','CenterCircleRadius','LeftCircleOrigin','LeftCircleRadius','RightCircleOrigin','RightCircleRadius'].map(k=>[k,{value:{set(){}}}]));
  const shared=evaluate(source,{THREE,Signal,seedrandom:()=>()=>0,Song:undefined,SongContext:undefined,SongChanged:new Signal(),SongContextChanged:new Signal(),GetInstantStore:()=>store,Image:class{decode(){return new Promise(()=>{})}},GetShaderUniforms:uniforms,VertexShader:'',FragmentShader:'',MutationObserver:Observer,ResizeObserver:Observer,OnPreRender:callback=>{frames.set(++id,callback);return [2,id];}},'({ApplyDynamicBackground,update:()=>{Blurred_CovertArt={};CoverArtBlurred.Fire()},signal:CoverArtBlurred})');
  assert.deepEqual(store.Items,{CardLyricsVisible:true,PlaybarDetailsHidden:true});assert.equal(store.saved,true);
  for(let cycle=0;cycle<10;cycle++){
   const maid=new Maid();shared.ApplyDynamicBackground(new Element(),maid);const initial=maid.Items.size;
   for(let frame=0;frame<100;frame++){const pending=[...frames];frames.clear();for(const [,callback]of pending)callback();assert.ok(maid.Items.size<=initial);assert.equal(frames.size,1);}
   shared.update();shared.update();maid.Destroy();assert.equal(frames.size,0);shared.update();
  }
  for(const kind of ['texture','material','renderer'])for(const item of objects[kind])assert.equal(item.disposed,1);
  assert.ok(objects.renderer.every(x=>x.lost));assert.equal(objects.geometry[0].disposed,0);
 }finally{for(const[key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('permanent authentication errors do not retry',async()=>{
 let calls=0;const get=createAccessTokenProvider(async()=>{calls++;throw Object.assign(Error('forbidden'),{status:403});},()=>undefined,fast);
 await assert.rejects(get(),/forbidden/);assert.equal(calls,1);
});

test('playlist bridge ignores stale track mutations, bounds metadata and cancels closed views', async () => {
 const source = await read('../Source/LyricViews/Page/PlaylistBridge.ts');
 const Bridge = evaluate(source, { Abortable, CreateAbortScope }, 'PlaylistBridge');
 let track = 'track:first'; const pending = [], added = [], details = [];
 const bridge = new Bridge({
   list: async () => [{Type:'Folder',Uri:'folder',Name:'Folder'}, {Type:'Playlist',Uri:'read-only',CanAddTo:false}, {Type:'Playlist',Uri:'editable',CanAddTo:true}],
   details: () => { const p=deferred(); details.push(p); return p.promise; },
   contents: () => { const p=deferred(); pending.push(p); return p.promise; },
   add: async (_, tracks) => { added.push(tracks); }, create: async () => {},
 }, () => track);
 assert.equal((await bridge.List('', '')).length, 2);
 const stale = bridge.Add('playlist', track); await Promise.resolve(); track = 'track:second'; pending.shift().resolve({Items:[]});
 await assert.rejects(stale, /Track changed/); assert.deepEqual(added, []);
 const current = bridge.Add('playlist', track); await Promise.resolve(); pending.shift().resolve({Items:[]}); await current;
 assert.deepEqual(added, [['track:second']]);
 const duplicate = bridge.Add('playlist', track); await Promise.resolve(); pending.shift().resolve({Items:[{uri:track}]}); await duplicate;
 assert.equal(added.length, 1);
 const queued = Array.from({length:9},(_,i)=>bridge.Details('playlist:'+i));
 await Promise.resolve(); assert.equal(details.length, 6);
 const settled = Promise.allSettled(queued); bridge.Destroy();
 assert.ok((await settled).every(result=>result.status==='rejected'));
 await assert.rejects(bridge.Add('playlist', track));
});

test('cache template migration fills missing view settings and preserves stored offsets',async()=>{
 const source=await read('../Spices/Spicetify/Services/Cache.ts');const data=new Map([
 ['view',JSON.stringify({Version:1,Items:{CardLyricsVisible:true}})],
 ['offset',JSON.stringify({Version:1,Items:{Songs:{abc:0.4}}})]
 ]);
 const get=evaluate(source,{IsDevelopment:false,localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}},'GetInstantStore');
 const view=get('view',1,{CardLyricsVisible:false,PlaybarDetailsHidden:false});assert.deepEqual(view.Items,{CardLyricsVisible:true,PlaybarDetailsHidden:false});view.SaveChanges();
 assert.deepEqual(get('offset',1,{Songs:{}}).Items,{Songs:{abc:0.4}});
});


test('desktop AuthorizationAPI fallback handles clients without Session credentials', async () => {
 const platform = {Session: {}, AuthorizationAPI: {getState: async () => ({token: {accessToken: 'desktop', accessTokenExpirationTimestampMs: Date.now()+60000}})}};
 const get=createAccessTokenProvider(async()=>{throw Error('Resolver not found');},()=>getPlatformToken(platform),fast);
 assert.equal(await get(),'desktop');
 assert.equal((await getPlatformToken({Session:{accessToken:'legacy',accessTokenExpirationTimestampMs:Date.now()+60000}})).accessToken,'legacy');
 assert.equal(await getPlatformToken({Session:{}}),undefined);
});

test('lyric transform carries provenance unchanged while retaining the original snapshot', async()=>{
 const transform=evaluate(await read('../Spices/Spicetify/Services/Player/LyricUtilities.ts'),{franc:()=> 'eng'},'TransformProviderLyrics');
 const input={Type:'Line',StartTime:3,EndTime:4,Source:{Provider:'netease',Transport:'direct',TrackId:'123'},RequestId:'request-a',LyricsHash:'hash-a',RetrievedAt:'2026-09-30T00:00:00Z',Content:[{Type:'Vocal',Text:'word',StartTime:3,EndTime:4,OppositeAligned:false}]};
 const saved=structuredClone(input), output=await transform(input);
 for(const key of ['Source','RequestId','LyricsHash','RetrievedAt'])assert.deepEqual(output[key],input[key]);
 assert.deepEqual(input,saved);assert.equal(output.Content[0].Type,'Interlude');
});

test('feedback captures the current song and lyrics before a song change',async()=>{
 const source=await read('../Source/Modules/LyricsFeedback.ts');
 const capture=source.slice(source.indexOf('export const CaptureLyricsFeedback'),source.indexOf('export const BindLyricsFeedbackButton'));
 const snapshot={Type:'Static',Lines:[{Text:'original'}],Source:{Provider:'spotify',Transport:'direct'},RequestId:'request-a',LyricsHash:'hash-a'};
 const state=evaluate('let Song=initialSong,SongDetails=initialDetails,SongProviderLyrics=original,SongLyrics=displayed,HaveSongLyricsLoaded=true,SongLyricsFromCache=true,Timestamp=10;'+capture,
 {initialSong:{Type:'Streamed',Id:'songA'},initialDetails:{IsLocal:false,Name:'Song A',Artists:[{Name:'Artist A'}]},original:snapshot,displayed:structuredClone(snapshot),SpotifyPlayer:{data:{}},Build:{Version:'5.2.2'},GetLyricsOffset:()=>.2},
 '({capture:CaptureLyricsFeedback,change:()=>{Song={Type:"Streamed",Id:"songB"};SongLyrics.Lines[0].Text="new";SongProviderLyrics=undefined}})');
 const captured=state.capture();state.change();assert.equal(captured.track.id,'songA');assert.equal(captured.original.Lines[0].Text,'original');assert.equal(captured.displayed.Lines[0].Text,'original');assert.equal(captured.playbackPosition,10);assert.equal(captured.lyricsOffset,.2);assert.equal(captured.fromCache,true);assert.equal(state.capture(),undefined);
});

test('actual lyric loader regenerates mismatched transformed caches and never publishes after switching songs', async()=>{
 const source=await read('../Spices/Spicetify/Services/Player/mod.ts');
 const loader=lyricsLoader(source);
 assert.match(source,/"Player_ProviderLyrics", 9/);assert.match(source,/"Player_TransformedLyrics", 9/);
 const raw={Type:'Static',Lines:[{Text:'correct'}],RequestId:'A',LyricsHash:'a',Source:{Provider:'spotify',Transport:'direct'}};
 const wrong={...raw,RequestId:'B',Lines:[{Text:'wrong'}]};
 let transforms=0;
 function setup(providerPromise){
  const ready=deferred();
  const state=evaluate('let Song=initialSong,SongLyrics,SongProviderLyrics,SongLyricsFromCache=false,HaveSongLyricsLoaded=false;'+loader,
   {initialSong:{Type:'Streamed',Id:'songA'},PlayerMaid:{Give(){}},SpotifyPlayer:{data:{nextItems:[]}},ProviderLyricsStore:{GetItem:()=>providerPromise},TransformedLyricsStore:{GetItem:async()=>wrong,SetItem:async()=>{}},
    BuildLyricsRequestURL:()=> 'https://example.test/lyrics/songA',TransformProviderLyrics:async value=>{transforms++;return {...structuredClone(value),Language:'eng'}},SongLyricsLoadedSignal:{Fire:()=>ready.resolve()},
    GetSpotifyAccessToken:()=>{throw Error('cache must not fetch')},ResolveAppleMusicId:()=>{},ShouldRefreshCachedLyrics:async()=>false,Abortable,CreateAbortScope,LyricsCacheExpiration:()=>{},Delay:()=>{}},
   '({load:LoadSongLyrics,state:()=>({SongLyrics,SongProviderLyrics,SongLyricsFromCache,HaveSongLyricsLoaded}),switch:()=>{Song={Type:"Streamed",Id:"songB"}}})');
  return {...state,ready:ready.promise};
 }
 const loaded=setup(Promise.resolve(raw));loaded.load();await loaded.ready;
 assert.equal(transforms,1);assert.equal(loaded.state().SongLyrics.RequestId,'A');assert.equal(loaded.state().SongLyrics.Lines[0].Text,'correct');assert.deepEqual(loaded.state().SongProviderLyrics,raw);assert.equal(loaded.state().SongLyricsFromCache,true);
 const pending=deferred(),stale=setup(pending.promise);stale.load();stale.switch();pending.resolve(raw);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(stale.state().SongLyrics,undefined);assert.equal(stale.state().SongProviderLyrics,undefined);
});

const flushLyrics = () => new Promise(resolve => setImmediate(resolve));
const prefetchLyrics = id => ({Type:'Static',Lines:[{Text:id}],RequestId:id,LyricsHash:id});
async function setupLyricsPrefetch({queue=['B','C'],cache=new Map(),readCache=id=>Promise.resolve(cache.get(id))}={}) {
 const code=lyricsLoader(await read('../Spices/Spicetify/Services/Player/mod.ts'));
 const requests=[],published=[],cached=[],cleanup=[];
 const track=id=>({type:'track',isLocal:false,uri:'spotify:track:'+id,name:id,duration:{milliseconds:180000}});
 const player={data:{nextItems:queue.map(track)}};
 const state=evaluate('let Song={Type:"Streamed",Id:"A",Duration:180},SongLyrics,SongProviderLyrics,SongLyricsFromCache=false,HaveSongLyricsLoaded=false;'+code,
  {PlayerMaid:{Give:fn=>cleanup.push(fn)},SpotifyPlayer:player,SpotifyURI:{from:uri=>({id:uri.split(':').at(-1)})},track,
   ProviderLyricsStore:{GetItem:readCache,SetItem:async(id,value)=>{cached.push(id);cache.set(id,value)}},
   TransformedLyricsStore:{GetItem:async()=>undefined,SetItem:async()=>{}},
   BuildLyricsRequestURL:id=>'https://example.test/lyrics/'+id,TransformProviderLyrics:async value=>({...value,Language:'eng'}),
   SongLyricsLoadedSignal:{Fire:()=>published.push(state.state())},ShouldRefreshCachedLyrics:async()=>false,
   SpotifyPlatform:{PlatformData:{app_platform:'test'},version:'test'},GetSpotifyAccessToken:async()=> 'token',ResolveAppleMusicId:async()=>undefined,
   fetch:(url,{signal})=>{const pending=deferred();requests.push({id:new URL(url).pathname.split('/').at(-1),signal,resolve:value=>pending.resolve(Response.json(value)),reject:pending.reject});return pending.promise;},
   Abortable,CreateAbortScope,LyricsCacheExpiration:()=>{},Delay:async()=>{}},
  '({prefetch:PrefetchUpcomingLyrics,load:(id,queue)=>{Song=id===undefined?undefined:{Type:"Streamed",Id:id,Duration:180};SpotifyPlayer.data={nextItems:queue.map(track)};LoadSongLyrics()},state:()=>({SongLyrics,SongProviderLyrics,SongLyricsFromCache,HaveSongLyricsLoaded})})');
 return {...state,player,requests,published,cached,destroy:()=>cleanup.forEach(fn=>fn())};
}

test('switching to a pending prefetch reuses it and preserves overlapping upcoming requests',async()=>{
 const app=await setupLyricsPrefetch();
 try {
  app.prefetch();await flushLyrics();assert.deepEqual(app.requests.map(x=>x.id),['B','C']);
  app.load('B',['C','D']);await flushLyrics();
  assert.deepEqual(app.requests.map(x=>x.id),['B','C','D']);
  assert.ok(app.requests.every(x=>!x.signal.aborted));
  app.prefetch();await flushLyrics();assert.equal(app.requests.length,3);
  app.requests[0].resolve(prefetchLyrics('B'));await flushLyrics();
  assert.deepEqual(app.cached,['B']);assert.equal(app.published.length,1);
  assert.equal(app.state().SongLyrics.RequestId,'B');assert.equal(app.state().SongLyricsFromCache,false);
 } finally { app.destroy(); }
});

test('rapid switching cancels obsolete requests, ignores late replies, and teardown cancels all remaining work',async()=>{
 const app=await setupLyricsPrefetch();
 try {
  app.prefetch();await flushLyrics();app.load('B',['C','D']);await flushLyrics();
  app.load('X',['C','E']);await flushLyrics();
  const b=app.requests.find(x=>x.id==='B');assert.equal(b.signal.aborted,true);
  assert.equal(app.requests.filter(x=>x.id==='C').length,1);
  assert.equal(app.requests.find(x=>x.id==='C').signal.aborted,false);
  assert.equal(app.requests.find(x=>x.id==='D').signal.aborted,true);
  b.resolve(prefetchLyrics('B'));await flushLyrics();
  assert.deepEqual(app.cached,[]);assert.deepEqual(app.published,[]);
  app.destroy();await flushLyrics();assert.ok(app.requests.every(x=>x.signal.aborted));
  for(const request of app.requests)request.resolve(prefetchLyrics(request.id));
  await flushLyrics();assert.deepEqual(app.cached,[]);assert.deepEqual(app.published,[]);
 } finally { app.destroy(); }
});

test('foreground retries failed or empty prefetches instead of failing the lyric load',async()=>{
 for(const fail of [request=>request.reject(Error('offline')),request=>request.resolve(false)]) {
  const app=await setupLyricsPrefetch({queue:['B']});
  try {
   app.prefetch();await flushLyrics();app.load('B',[]);await flushLyrics();
   assert.equal(app.requests.length,1);fail(app.requests[0]);await flushLyrics();
   assert.equal(app.requests.length,2);app.requests[1].resolve(prefetchLyrics('recovered'));await flushLyrics();
   assert.equal(app.state().SongLyrics.RequestId,'recovered');assert.equal(app.published.length,1);
  } finally { app.destroy(); }
 }
});

test('pending cache reads deduplicate repeated queue items and can be promoted or cancelled before fetching',async()=>{
 const gate=deferred(),reads=[];
 const app=await setupLyricsPrefetch({queue:['B','B'],readCache:id=>{reads.push(id);return gate.promise}});
 try {
  app.prefetch();app.prefetch();assert.deepEqual(reads,['B']);
  app.load('B',[]);await flushLyrics();gate.resolve(undefined);await flushLyrics();
  assert.deepEqual(app.requests.map(x=>x.id),['B']);
  app.requests[0].resolve(prefetchLyrics('B'));await flushLyrics();assert.equal(app.published.length,1);
 } finally { app.destroy(); }
 const cancelled=deferred(),stopped=await setupLyricsPrefetch({queue:['B'],readCache:()=>cancelled.promise});
 stopped.prefetch();stopped.destroy();cancelled.resolve(undefined);await flushLyrics();assert.deepEqual(stopped.requests,[]);
 const cached=await setupLyricsPrefetch({queue:['B'],cache:new Map([['B',prefetchLyrics('B')]])});
 try {
  cached.prefetch();await flushLyrics();cached.load('B',[]);await flushLyrics();
  assert.deepEqual(cached.requests,[]);assert.equal(cached.state().SongLyricsFromCache,true);
 } finally { cached.destroy(); }
});

test('source policy matches platform and actual type across transports and refreshes unknown provenance',async()=>{
 const code=await read('../Spices/Spicetify/Services/Player/LyricsPolicy.ts');
 const {IsCachedLyricsBlocked:blocked}=evaluate(code,{Abortable,CreateAbortScope},'({IsCachedLyricsBlocked})');
 for(const Type of ['Syllable','Line','Static'])for(const Transport of ['direct','lyrically']){
  const raw={Type,Source:{Provider:'netease',Transport}},rules=[{provider:'netease',lyricsType:Type}];
  assert.equal(blocked(raw,rules),true);assert.equal(blocked(raw,[{provider:'qqmusic',lyricsType:Type}]),false);
  assert.equal(blocked(raw,[{provider:'netease',lyricsType:Type==='Line'?'Syllable':'Line'}]),false);
  assert.equal(blocked({Type},rules),true);assert.equal(blocked({Type},[]),false);
 }
});

test('actual policy query handles errors, validates payloads, and bounds stalled bodies to two seconds',async()=>{
 const code=await read('../Spices/Spicetify/Services/Player/LyricsPolicy.ts');
 const raw={Type:'Syllable',Source:{Provider:'qqmusic',Transport:'direct'}};
 const query=fetch=>evaluate(code,{fetch,Abortable,CreateAbortScope},'ShouldRefreshCachedLyrics');
 const parent=new AbortController();
 let requests=0;
 const good=query(async(url,options)=>{requests++;assert.equal(url,'https://lyrics.txw.qzz.io/lyrics-policy/songA');assert.equal(options.cache,'no-store');assert.equal(options.headers,undefined);return Response.json({blocks:[{provider:'qqmusic',lyricsType:'Syllable'}]})});
 assert.equal(await good('songA',raw,parent.signal),true);assert.equal(requests,1);
 for(const fetch of [async()=>{throw Error('offline')},async()=>new Response('',{status:503}),async()=>new Response('',{status:404}),async()=>Response.json({}),async()=>Response.json({blocks:[{provider:'qqmusic',lyricsType:'bad'}]})]){
  assert.equal(await query(fetch)('songA',raw,parent.signal),false);
 }
 const start=performance.now();let signal;
 assert.equal(await query(async(_url,options)=>{signal=options.signal;return {ok:true,json:()=>new Promise(()=>{})}})('songA',raw,parent.signal),false);
 assert.equal(signal.aborted,true);assert.ok(performance.now()-start>=1900);assert.ok(performance.now()-start<3500);
 const cancelled=new AbortController();const pending=query(()=>new Promise(()=>{}))('songA',raw,cancelled.signal);cancelled.abort();await assert.rejects(pending,{name:'AbortError'});
});

test('actual loader removes only blocked track caches, retains unaffected/restored caches, and ignores late policy replies',async()=>{
 const code=await read('../Spices/Spicetify/Services/Player/mod.ts');
 const loader=lyricsLoader(code);
 const policyCode=await read('../Spices/Spicetify/Services/Player/LyricsPolicy.ts');
 const raw={Type:'Syllable',StartTime:0,EndTime:1,Content:[],Source:{Provider:'qqmusic',Transport:'direct'},RequestId:'old',LyricsHash:'oldhash'};
 const fresh={Type:'Line',StartTime:0,EndTime:1,Content:[],Source:{Provider:'netease',Transport:'lyrically'},RequestId:'new',LyricsHash:'newhash'};
 function setup(blocks){
  const ready=deferred(),deleted=[],requests=[],cached=[],transforms=[];
  const fetch=async(url,options)=>{
   requests.push(url);
   if(url.includes('/lyrics-policy/'))return {ok:true,json:async()=>({blocks:await blocks})};
   assert.equal(options.headers.Authorization,'Bearer token');return Response.json(fresh);
  };
  const shouldRefresh=evaluate(policyCode,{fetch,Abortable,CreateAbortScope},'ShouldRefreshCachedLyrics');
  const state=evaluate('let Song=initialSong,SongLyrics,SongProviderLyrics,SongLyricsFromCache=false,HaveSongLyricsLoaded=false;'+loader,
   {initialSong:{Type:'Streamed',Id:'songA'},PlayerMaid:{Give(){}},SpotifyPlayer:{data:{nextItems:[]}},ShouldRefreshCachedLyrics:shouldRefresh,fetch,
    ProviderLyricsStore:{GetItem:async()=>structuredClone(raw),DeleteItem:async id=>{deleted.push('raw:'+id)},SetItem:async(id,value)=>{cached.push(value)}},
    TransformedLyricsStore:{GetItem:async()=>({...raw,Language:'eng'}),DeleteItem:async id=>{deleted.push('transformed:'+id)},SetItem:async()=>{}},
    BuildLyricsRequestURL:()=> 'https://lyrics.txw.qzz.io/lyrics/songA',TransformProviderLyrics:async value=>{transforms.push(value);return {...structuredClone(value),Language:'eng'}},SongLyricsLoadedSignal:{Fire:()=>ready.resolve()},
    SpotifyPlatform:{PlatformData:{app_platform:'Win32_x86_64'},version:'test'},GetSpotifyAccessToken:async()=> 'token',ResolveAppleMusicId:async()=>undefined,
    Abortable,CreateAbortScope,LyricsCacheExpiration:()=>{},Delay:async()=>{}},
   '({load:LoadSongLyrics,state:()=>({SongLyrics,SongProviderLyrics,SongLyricsFromCache}),switch:()=>{Song={Type:"Local",Id:"songB"};LoadSongLyrics()}})');
  return {...state,ready:ready.promise,deleted,requests,cached,transforms};
 }
 const blocked=setup([{provider:'qqmusic',lyricsType:'Syllable'}]);blocked.load();await blocked.ready;
 assert.deepEqual(blocked.deleted,['raw:songA','transformed:songA']);assert.equal(blocked.state().SongLyricsFromCache,false);assert.equal(blocked.state().SongLyrics.RequestId,'new');assert.deepEqual(blocked.cached,[fresh]);assert.equal(blocked.transforms.length,1);
 for(const rules of [[],[{provider:'qqmusic',lyricsType:'Line'}],[{provider:'netease',lyricsType:'Syllable'}]]){
  const retained=setup(rules);retained.load();await retained.ready;assert.deepEqual(retained.deleted,[]);assert.equal(retained.requests.length,1);assert.equal(retained.transforms.length,0);assert.equal(retained.state().SongLyricsFromCache,true);
 }
 const late=deferred(),stale=setup(late.promise);stale.load();await new Promise(resolve=>setImmediate(resolve));stale.switch();late.resolve([{provider:'qqmusic',lyricsType:'Syllable'}]);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(stale.state().SongProviderLyrics,undefined);assert.deepEqual(stale.deleted,[]);
});
