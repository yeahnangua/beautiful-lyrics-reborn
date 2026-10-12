import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Exercise the production conversion/analysis code without booting Spotify or React.
async function load(file, names, mocks = {}) {
  const source = stripTypeScriptTypes(await readFile(new URL(`../Folia/src/${file}.ts`, import.meta.url), 'utf8'), { mode: 'transform' })
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '').replace(/\bexport\s+/g, '');
  return new Function(...Object.keys(mocks), source + `\nreturn {${names}};`)(...Object.values(mocks));
}
const { convertLyrics, lyricSeekTime, activeLineIndex } = await load('lyrics', 'convertLyrics,lyricSeekTime,activeLineIndex');
const { TrackAnalysis, SILENT_AUDIO } = await load('audio', 'TrackAnalysis,SILENT_AUDIO');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const analysis = { segments: [{start:0,duration:10,loudness_start:-60,loudness_max:-10,loudness_max_time:2,loudness_end:-40}], beats: [{start:2,duration:1,confidence:1}] };

test('Folia conversion retains syllable text, spacing, overlapping timings, agents and backing vocals', () => {
  const s = (Text, StartTime, EndTime, IsPartOfWord) => ({Text,StartTime,EndTime,IsPartOfWord});
  const input = {Type:'Syllable',NaturalAlignment:'Right',Content:[
    {Type:'Interlude',StartTime:0,EndTime:2},
    {Type:'Vocal',OppositeAligned:true,Lead:{StartTime:2,EndTime:8,Syllables:[s('你',2,4,true),s('好',3,5,false),s('world!',5,8,false)]},Background:[{StartTime:3,EndTime:6,Syllables:[s('哦',3,6,false)]}]},
    {Type:'Vocal',OppositeAligned:false,Lead:{StartTime:3,EndTime:4,Syllables:[s('重复',3,4,false)]}},
  ]};
  const before = structuredClone(input), result = convertLyrics(input, true);
  assert.deepEqual(input, before); assert.equal(result.direction,'rtl'); assert.equal(result.lines.length,2);
  assert.equal(result.lines[0].fullText,'你好 world!'); assert.equal(result.lines[0].agentId,'opposite');
  assert.deepEqual(result.lines[0].words.map(w=>[w.startTime,w.endTime]),[[2,4],[3,5],[5,8]]);
  assert.equal(result.lines[0].backgroundVocals[0].text,'哦');
  assert.equal(activeLineIndex(result.lines,3.5),1); assert.equal(activeLineIndex(result.lines,6),0); assert.equal(activeLineIndex(result.lines,9),-1);
});
test('line lyrics preserve original text while static/missing/loading/instrumental have distinct states', () => {
  assert.equal(convertLyrics(undefined,false).status,'loading'); assert.equal(convertLyrics(undefined,true).status,'missing');
  const staticLyrics = convertLyrics({Type:'Static',Lines:[{Text:'a  a，中文'},{Text:''}]},true);
  assert.equal(staticLyrics.status,'static'); assert.deepEqual(staticLyrics.lines,[]); assert.deepEqual(staticLyrics.staticLines,['a  a，中文','']);
  assert.equal(convertLyrics({Type:'Line',Content:[]},true).status,'instrumental');
  const line = convertLyrics({Type:'Line',Content:[{Type:'Vocal',Text:'a  a，中文',StartTime:1,EndTime:5,OppositeAligned:false}]},true).lines[0];
  assert.equal(line.fullText,'a  a，中文'); assert.equal(line.words[0].text,line.fullText);
  assert.equal(lyricSeekTime(10,0.6,20),9.4); assert.equal(lyricSeekTime(0,1,20),0); assert.equal(lyricSeekTime(30,-1,20),20);
});
test('audio analysis samples the raw playback clock, handles pause/seek and makes no FFT',async()=>{
  const audio = new TrackAnalysis(async()=>analysis);
  await audio.setSong('spotify:track:audio-sample'); assert.equal(audio.status,'available');
  const sample = audio.sample(2,true); assert.ok(sample.power>200); assert.equal(sample.bass,255); assert.equal(sample.mid,sample.power);
  assert.equal('spectrum' in sample,false); assert.deepEqual(audio.sample(2,false),SILENT_AUDIO); assert.deepEqual(audio.sample(15,true),SILENT_AUDIO);
  assert.ok(audio.sample(0,true).power < audio.sample(2,true).power); audio.destroy();
});
test('late analysis cannot replace a newer song or survive destroy, and cached songs avoid requests',async()=>{
  const first=deferred(),next=deferred();let calls=0;
  const audio=new TrackAnalysis(uri=>{calls++;return uri.endsWith('first')?first.promise:next.promise;});
  const old=audio.setSong('spotify:track:race-first'), fresh=audio.setSong('spotify:track:race-next');
  next.resolve(analysis); await fresh; first.resolve({segments:[]}); await old;
  assert.equal(audio.status,'available'); await audio.setSong('spotify:track:race-next'); assert.equal(calls,2);
  const pending=audio.setSong('spotify:track:race-first');audio.destroy();await pending; assert.equal(audio.status,'unavailable');
});
test('analysis missing, failure, timeout and unsupported tracks all fall back to silence',async()=>{
  for(const fetch of [undefined,async()=>{throw Error('offline');},async()=>({segments:[{start:NaN}]}),()=>new Promise(()=>{})]){
    const audio=new TrackAnalysis(fetch,5);await audio.setSong('spotify:track:failure-'+Math.random());
    assert.equal(audio.status,'unavailable');assert.deepEqual(audio.sample(2,true),SILENT_AUDIO);audio.destroy();
  }
  let requests=0;const audio=new TrackAnalysis(async()=>{requests++;return analysis;});
  await audio.setSong('spotify:local:track');assert.equal(requests,0);audio.destroy();
});
test('settings validation preserves supported selections and repairs corrupt preferences',async()=>{
  const source=stripTypeScriptTypes(await readFile(new URL('../Folia/vendor/src/types/visualizerModes.ts',import.meta.url),'utf8'))
    .replace(/^import.*\n/gm,'').replace(/\bexport\s+/g,'');
  const constants=new Function(source+'\nreturn {BUILTIN_VISUALIZER_MODES,BUILTIN_VISUALIZER_BACKGROUND_MODES};')();
  assert.equal(constants.BUILTIN_VISUALIZER_MODES.length,13);assert.equal(constants.BUILTIN_VISUALIZER_BACKGROUND_MODES.length,5);
  assert.equal(constants.BUILTIN_VISUALIZER_MODES.includes('fume'),false);
  const {validateSettings}=await load('settings','validateSettings',constants);
  assert.deepEqual(validateSettings({mode:'unknown',background:'url',fontScale:Infinity,showLyrics:'false'}),{mode:'classic',background:'latent',fontScale:1,showLyrics:true,showSubtitles:false});
  assert.equal(validateSettings({mode:'fume'}).mode,'classic');
  assert.equal(validateSettings(null).showSubtitles,false);
  assert.equal(validateSettings({showSubtitles:true}).showSubtitles,true);
  assert.equal(validateSettings({mode:'sonnet',background:'sora',fontScale:3}).fontScale,2);
});
