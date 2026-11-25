import { useSyncExternalStore } from 'react';
import type { LyricRenderQuality, SmartBeatSettings } from '../types';
type State = {lyricRenderQuality:LyricRenderQuality;smartBeat:SmartBeatSettings;[key:string]:unknown};
let state = {lyricRenderQuality:{scale:1,antialias:'auto'},smartBeat:{mode:'off',effects:{}},visualizerFrameRate:'off'} as unknown as State;
const listeners=new Set<()=>void>();
export const updateVisualizerHostSettings=(patch:Partial<State>)=>{state={...state,...patch};listeners.forEach(f=>f())};
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};
export const useVisualizerSettingsStore=Object.assign(<T>(select:(s:State)=>T):T=>select(useSyncExternalStore(subscribe,()=>state)),{getState:()=>state});
