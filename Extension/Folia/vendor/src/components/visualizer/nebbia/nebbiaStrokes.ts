// src/components/visualizer/nebbia/nebbiaStrokes.ts
// 中日文的笔顺：AnimCJK 的笔画中线（1024 方格、y 向下），构建时由 dev/nebbia/nebbiaStrokesPlugin.mjs 生成成产物根目录的
// nebbia-strokes.json，授权文本随附在 licenses/nebbia-strokes/。
// @note 数据是 Arphic Public License（AnimCJK 的 graphics 文本文件只给了 APL），随应用分发并附授权文本，但不进仓库：每次构建从钉死的 AnimCJK commit 下载生成。
// Reborn 的正式构建要求笔顺资源完整；运行时下载失败时退回字体骨架追踪。

export type NebbiaStrokeData = Record<string, [number, number][][]>;

// Reborn pins auxiliary bytes exactly like the fullscreen runtime.
declare const __NEBBIA_ASSET__: {file:string;sha256:string};
declare const __NEBBIA_INLINE__: string | undefined;
let loading: Promise<NebbiaStrokeData | null> | null = null;
let loaded: NebbiaStrokeData | null = null;
const bounded=async<T>(operation:()=>Promise<T>):Promise<T>=>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([operation(),new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(Error('Storage timed out')),2000)})])}finally{clearTimeout(timer)}
};
const verify=async(response:Response)=>{
 if(!response.ok)throw Error('Stroke download failed');
 const bytes=await response.arrayBuffer();
 if(bytes.byteLength>16*1024*1024)throw Error('Stroke resource too large');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==__NEBBIA_ASSET__.sha256)throw Error('Stroke checksum mismatch');
 return new TextDecoder().decode(bytes);
};
export const loadNebbiaStrokes=():Promise<NebbiaStrokeData|null>=>{
 loading??=(async()=>{
  if(typeof __NEBBIA_INLINE__==='string')return JSON.parse(__NEBBIA_INLINE__) as NebbiaStrokeData;
  const urls=['https://lyrics.txw.qzz.io/Release/','https://lyrics.20050129.xyz/Release/','https://cdn.jsdelivr.net/gh/yeahnangua/beautiful-lyrics-reborn@releases/Extension/Builds/Release/'];
  const key=urls[0]+__NEBBIA_ASSET__.file;
  let cache:Cache|undefined;
  try{cache=await bounded(()=>caches.open('BeautifulLyrics/Auxiliary/v1'));const cached=await bounded(()=>cache!.match(key));if(cached){try{return JSON.parse(await bounded(()=>verify(cached))) as NebbiaStrokeData}catch{await bounded(()=>cache!.delete(key))}}}catch{}
  for(const base of urls){try{const text=await verify(await fetch(base+__NEBBIA_ASSET__.file,{signal:AbortSignal.timeout(10000)}));
    const parsed=JSON.parse(text) as NebbiaStrokeData;
    try{await bounded(async()=>cache?.put(key,new Response(text)));for(const old of (await bounded(async()=>cache?.keys())??[]).filter(r=>r.url!==key).slice(0,-2))await cache?.delete(old)}catch{}
    return parsed;
  }catch{}}
  return null;
 })().catch(()=>null).then(value=>{loaded=value;return value});
 return loading;
};

/** 已经读到的一个字的笔画中线；没读到、没有这个字时 null。 */
export const getNebbiaStrokeMedians = (ch: string): [number, number][][] | null => loaded?.[ch] ?? null;
