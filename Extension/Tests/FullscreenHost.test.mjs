import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { Maid } from '../../Universal/Modules/Maid.ts';
import { Signal } from '../../Universal/Modules/Signal.ts';

// Test the real Spotify host lifecycle and input handling independently of browser renderers.
const source=stripTypeScriptTypes(await readFile(new URL('../Source/LyricViews/Page/Fullscreen.ts',import.meta.url),'utf8'),{mode:'transform'})
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace('export default class PageView','class PageView');
async function fixture(run) {
  class Element { style={};children=[];innerHTML='';hidden=false;removed=false;
    append(child){this.children.push(child);}remove(){this.removed=true;}querySelector(){return null;}matches(){return false;} }
  class Observer {disconnect(){}}
  const changes={Element,HTMLElement:Element,MutationObserver:Observer,ResizeObserver:Observer};
  const old=Object.fromEntries(Object.keys(changes).map(key=>[key,globalThis[key]]));Object.assign(globalThis,changes);
  const signals=Object.fromEntries(['SongChanged','SongDetailsLoaded','SongContextChanged','SongLyricsLoaded','IsPlayingChanged','IsShufflingChanged','LoopModeChanged','IsLikedChanged','TimeStepped','LyricsOffsetChanged'].map(key=>[key,new Signal()]));
  const listeners=new Map(),main=new Element(),body=new Element();main.style.display='grid';
  let view,panel=false,closed=0,updates=[],steps=[],destroyed=0,requested=0,exited=0;
  const document={body,fullscreenElement:null,querySelector:key=>key==='#main'?main:null,createElement:()=>new Element(),
    documentElement:{requestFullscreen:async()=>{requested++;document.fullscreenElement={};}},
    exitFullscreen:async()=>{exited++;document.fullscreenElement=null;},
    addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);},
  };
  const history={entries:[{pathname:'/album/previous'},{pathname:'/BeautifulLyrics/Fullscreen'}],push:()=>{closed++;view?.Destroy();}};
  const player={getVolume:()=>0.5,data:{item:{name:'Song',artists:[],album:{name:'Album'}}},back(){},next(){},setVolume(){}};
  const mocks={Maid,document,navigator:{language:'en'},Spotify:{Locale:{getLocale:()=> 'en'}},SpotifyHistory:history,SpotifyPlayer:player,
    ...signals,Song:{Type:'Streamed',Uri:'spotify:track:fixture',Duration:60},SongDetails:undefined,SongLyrics:undefined,SongProviderLyrics:undefined,HaveSongLyricsLoaded:false,
    Timestamp:12,IsPlaying:true,IsShuffling:false,LoopMode:'Off',IsLiked:false,
    SetIsPlaying(){},SetIsShuffling(){},SetLoopMode(){},SetIsLiked(){},SeekTo(){},RetrySongLyricsIfMissing(){},
    GetPlaylistsAndFolders(){},GetPlaylistDetails(){},GetPlaylistContents(){},AddToPlaylist(){},CreateFolder(){},CreatePlaylist(){},
    GetLyricsOffset:()=>0.6,AdjustLyricsOffset(){},SetLyricsOffset(){},BindLyricsFeedbackButton(){},LyricsFeedbackButton:'<button></button>',GetCoverArtForSong:()=>['cover'],
    convertLyrics:()=>({status:'loading',lines:[],staticLines:[],direction:'ltr'}),
    TrackAnalysis:class{status='unavailable';async setSong(){}sample(){return {power:0,bass:0,lowMid:0,mid:0,vocal:0,treble:0};}destroy(){}},
    PlaylistBridge:class{Destroy(){}},
    mountFolia:(_,snapshot)=>{updates.push(snapshot);return {update:s=>updates.push(s),step:(...values)=>steps.push(values),closePanel:()=>{const was=panel;panel=false;return was;},destroy:()=>destroyed++};},
  };
  const PageView=new Function(...Object.keys(mocks),source+'\nreturn PageView;')(...Object.values(mocks));
  try{
    await run({mount(native){view=new PageView(native?true:undefined);return view;},document,listeners,main,signals,
      setPanel:()=>{panel=true;},state:()=>({closed,destroyed,updates,steps,requested,exited}),
      escape(){listeners.get('keydown')?.({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});}});
  }finally{
    view?.Destroy();for(const signal of Object.values(signals))signal.Destroy();
    for(const [key,value] of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
  }
}
test('actual fullscreen host preserves main display, offsets and tears down listeners exactly once',async()=>{
 await fixture(async f=>{const view=f.mount(false);assert.equal(f.main.style.display,'none');assert.equal(f.state().steps[0][0],12);assert.equal(f.state().steps[0][1],0.6);
 let closedSignals=0;view.Closed.Connect(()=>closedSignals++);view.Destroy();view.Destroy();assert.equal(closedSignals,1);assert.equal(f.main.style.display,'grid');assert.equal(f.listeners.size,0);assert.equal(f.state().destroyed,1);});
});
test('Escape closes a panel before the view; native exit also respects an open panel',async()=>{
 await fixture(async f=>{f.mount(true);f.setPanel();f.escape();assert.equal(f.state().closed,0);f.document.fullscreenElement=null;f.listeners.get('fullscreenchange')();assert.equal(f.state().closed,0);f.escape();assert.equal(f.state().closed,1);});
 await fixture(async f=>{f.mount(true);f.setPanel();f.document.fullscreenElement=null;f.listeners.get('fullscreenchange')();assert.equal(f.state().closed,0);f.escape();assert.equal(f.state().closed,1);});
});
test('native exit returns to Spotify and native fullscreen owned by a destroyed host is released',async()=>{
 await fixture(async f=>{f.mount(true);assert.equal(f.state().requested,1);f.document.fullscreenElement=null;f.listeners.get('fullscreenchange')();assert.equal(f.state().closed,1);});
 await fixture(async f=>{const view=f.mount(true);view.Destroy();assert.equal(f.state().exited,1);});
});
