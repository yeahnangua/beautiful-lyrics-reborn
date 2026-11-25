export const VOCAL_FPS=50;
export interface VocalEnvelope {fps:number;db:Float32Array;top:number;onsets:Uint32Array;from?:number}
export const getVocalEnvelope = (_key:string|null):VocalEnvelope|null => null;
