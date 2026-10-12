// @ts-types="../src/runtime.d.ts"
import { mountFolia } from '../dist/folia.mjs';
import type { FoliaActions, FoliaHandle, PlayerSnapshot } from '../src/contracts';

// Browser fixture uses the actual compiled payload and host contracts, with local song data.
const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g"><stop stop-color="#fdba74"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><circle cx="256" cy="256" r="120" fill="#18181b"/></svg>');
const calls: { type: string; value?: unknown }[] = [];
let player: PlayerSnapshot = {
  key:'spotify:track:fixture',title:'星河与回声',artist:'Folia integration',album:'Reborn',coverUrl:cover,duration:80,
  playing:true,shuffle:false,loop:'off',liked:false,volume:0.65,canSeek:true,canLike:true,canPlaylist:true,canFeedback:true,fullscreen:false,audioStatus:'available',
  lyrics:{status:'synced',staticLines:[],direction:'ltr',lines:Array.from({length:20},(_,i)=>({id:String(i),fullText:i%2?'Echo echo, into the night':'星河流过，你我之间',agentId:i%2?'opposite':'lead',startTime:i*4,endTime:i*4+3.8,words:(i%2?['Echo ','echo, ','into ','the ','night']:['星河','流过，','你我','之间']).map((text,j)=>({text,startTime:i*4+j*.7,endTime:i*4+j*.7+.65})),backgroundVocals:i===5?[{text:'回声',startTime:20,endTime:23,words:[{text:'回声',startTime:20,endTime:23}]}]:undefined}))},
};
let handle: FoliaHandle;
let clock=20.6, timer: ReturnType<typeof setInterval> | undefined;
const log = (type: string, value?: unknown) => calls.push({type,value});
const update = (patch: Partial<PlayerSnapshot>) => { player={...player,...patch};handle?.update(player); };
const actions: FoliaActions = {
  close:()=>{log('close');destroy();},toggleFullscreen:()=>{log('fullscreen');update({fullscreen:!player.fullscreen});},
  prev:()=>log('prev'),next:()=>log('next'),togglePlay:()=>{log('play');update({playing:!player.playing});},
  seek:value=>{log('seek',value);clock=value;},setVolume:volume=>{log('volume',volume);update({volume});},
  toggleShuffle:()=>{log('shuffle');update({shuffle:!player.shuffle});},toggleLoop:()=>{log('loop');update({loop:player.loop==='off'?'all':player.loop==='all'?'one':'off'});},
  toggleLike:()=>{log('like');update({liked:!player.liked});},feedback:()=>log('feedback'),offset:()=>offset,
  adjustOffset:delta=>{offset+=delta;log('offset',offset);},resetOffset:()=>{offset=0;},
  listFolder:async(uri,filter)=>filter==='error'?Promise.reject(Error('Library offline')):[{type:'playlist',uri:'spotify:playlist:fixture',name:'Fixture playlist'},...(!uri?[{type:'folder' as const,uri:'folder',name:'Fixture folder'}]:[])],
  playlistDetails:async uri=>({type:'playlist',uri,name:'Fixture playlist',cover}),
  addToPlaylist:async(uri,track)=>{log('playlist',{uri,track});},createLibraryItem:async(type,name,parent)=>{log('create',{type,name,parent});},
};
let offset=0;
function mount(){
  const host=document.createElement('div');host.id='fixture-host';document.body.append(host);
  handle=mountFolia(host,player,actions,'en');
  timer=setInterval(()=>{if(player.playing)clock+=1/30;handle.step(clock,offset,{power:100,bass:120,lowMid:100,mid:100,vocal:100,treble:100});},1000/30);
}
function destroy(){clearInterval(timer);handle.destroy();document.querySelector('#fixture-host')?.remove();}
window.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();if(!handle.closePanel())actions.close();}});
mount();
Object.assign(window,{testFolia:{calls,update,setTime:(value:number)=>{clock=value;},mount,destroy,getPlayer:()=>player}});
