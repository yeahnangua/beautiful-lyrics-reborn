import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createAccessTokenProvider } from '../Spices/Spicetify/Services/AccessToken.ts';
import { Abortable, CreateAbortScope } from '../../Universal/Modules/Async.ts';
import { Revision } from '../../Universal/Modules/Revision.ts';
import { compileWithStyles, injectStyles } from '../Spices/Build/Styles.mjs';
import { Maid } from '../../Universal/Modules/Maid.ts';
import { Signal } from '../../Universal/Modules/Signal.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const token = () => ({accessToken:'valid',expiresAtTime:Date.now()+60000,tokenType:'Bearer'});
const fast = {timeoutMs:10,retryDelayMs:1};
const read = path => readFile(new URL(path,import.meta.url),'utf8');
const evaluate = (source, mocks, result) => new Function(...Object.keys(mocks), stripTypeScriptTypes(source).replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/\bexport\s+/g,'') + `\nreturn ${result};`)(...Object.values(mocks));

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

test('actual playlist renderer ignores stale lists/details, retries failures and captures clicked track',async()=>{
 const source=await read('../Source/LyricViews/Page/Fullscreen.ts');
 const start=source.indexOf('const RenderFolderItems =');const end=source.indexOf('// Store branch state here',start);
 const code='let currentRenderedTextFilter;'+source.slice(start,end);
 const revision=new Revision(), pending=[],status=[],buttons=[],added=[],nodes=[];const Song={Uri:'track:first'};
 class Node {children=new Map();classList={toggle(){}};style={};textContent='';querySelector(key){if(!this.children.has(key))this.children.set(key,new Node());return this.children.get(key)}addEventListener(_,fn){this.click=fn}prepend(){}remove(){}}
 const grid={items:[],appendChild(item){this.items.push(item)}};
 const renderMaid={Give:x=>x,Clean(){},CleanUp(){grid.items=[]}};
 class Button{Clicked={Connect:fn=>this.click=fn};constructor(){buttons.push(this)}}
 const render=evaluate(code,{renderRevision:revision,renderMaid,grid,Song,isAddToPlaylistCoverOpen:true,LoadFolderItems:()=>{const p=deferred();pending.push(p);return p.promise},GetPlaylistContents:()=>{const p=deferred();status.push(p);return p.promise},CreateElement:()=>{const node=new Node();nodes.push(node);return node},FolderGridItemTemplate:'',PlaylistGridItemTemplate:'',TextScroller:class{},Button,document:{createElement:()=>new Node()},pathChangeRequested:{Fire(){}},RunAnimation(){},AddedAnimation:{},RemovedAnimation:{},AddToPlaylist:(uri,tracks)=>{added.push(tracks);return Promise.resolve()},RemoveFromPlaylist:()=>{throw Error('unexpected removal')},LoadPlaylistDetails:()=>Promise.resolve({images:[{url:'cover'}],name:'name',collaborators:{items:[]}}),Defer:fn=>fn,console:{warn(){}}},'RenderFolderItems');
 const flush=()=>new Promise(r=>setImmediate(r));
 render({});render({});pending[1].resolve([{Type:'Folder',Name:'new'}]);await flush();assert.equal(grid.items.length,1);const current=grid.items[0];pending[0].resolve([{Type:'Folder',Name:'old'}]);await flush();assert.equal(grid.items[0],current);
 render({});revision.Invalidate();pending[2].resolve([{Type:'Folder',Name:'closed'}]);await flush();assert.equal(grid.items.length,0);
 render({});pending[3].reject(Error('offline'));await flush();assert.match(grid.items[0].textContent,/retry/);grid.items[0].click();pending[4].resolve([]);await flush();assert.equal(grid.items.length,0);
 const details=deferred();render({});pending[5].resolve([{Type:'Playlist',Uri:'playlist',LoadedDetails:details.promise}]);await flush();status[0].resolve({Items:[]});await flush();const row=nodes.at(-1);const button=buttons.at(-1);
 button.click();Song.Uri='track:second';status[1].resolve({Items:[]});await flush();assert.deepEqual(added,[]);
 revision.Invalidate();details.resolve({images:[{url:'cover'}],name:'late',collaborators:{items:[]}});await flush();assert.equal(row.querySelector('.Details .Name').querySelector('span').textContent,'');
 revision.Destroy();
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
