import React from 'react';
import {useTranslation} from 'react-i18next';
import { DEFAULT_MACHI_VIEW, MACHI_VIEW_LIMITS, type MachiSceneId, type MachiTuning, type MachiCameraView } from './types';
type Props = { tuning:MachiTuning;scene:MachiSceneId;onPreview(patch:Partial<MachiTuning>):void;onCommit():void;onClose():void;onTuningChange(patch:Partial<MachiTuning>):void;[key:string]:unknown };
/** Spotify host controls edit the upstream camera tuning without application stores. */
export default function MachiCameraBar({tuning,scene,onPreview,onCommit,onClose,onTuningChange}:Props) {
  const {t}=useTranslation();
  const view=tuning.camera==='custom'?tuning.views[scene]:DEFAULT_MACHI_VIEW;
  return <aside className="absolute left-6 right-6 bottom-32 z-40 rounded-xl bg-black/80 p-4 text-white pointer-events-auto" aria-label="Camera" onPointerUp={onCommit} onKeyUp={onCommit}>
    {(Object.keys(MACHI_VIEW_LIMITS) as (keyof MachiCameraView)[]).map(key=><label key={key} className="inline-flex flex-col m-2">{key}<input type="range" min={MACHI_VIEW_LIMITS[key].min} max={MACHI_VIEW_LIMITS[key].max} step="0.01" value={view[key]} onChange={event=>onPreview({camera:'custom',views:{...tuning.views,[scene]:{...view,[key]:event.target.valueAsNumber}}})}/></label>)}
    <button onClick={()=>onTuningChange({camera:'default',views:{...tuning.views,[scene]:DEFAULT_MACHI_VIEW}})}>{t("reset")}</button>
    <button onClick={()=>{onCommit();onClose()}}>{t("close")}</button>
  </aside>;
}
