import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { Maid } from '../../Universal/Modules/Maid.ts';
import { Signal } from '../../Universal/Modules/Signal.ts';
import { attributionParts } from '../../Universal/Modules/LyricsAttribution.ts';

class Element {
  children = []; parent; listeners = new Map();
  style = {setProperty(){}};
  classList = { values: new Set(), add(...names) { names.forEach(name => this.values.add(name)); },
    remove(...names) { names.forEach(name => this.values.delete(name)); }, contains(name) { return this.values.has(name); } };
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  addEventListener(type,callback) { this.listeners.set(type,callback); }
  remove() { if(this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  set textContent(value) { this.children = []; this.text = value; }
  get textContent() { return this.text ?? this.children.map(child => child.textContent).join(''); }
  set innerText(value) { this.textContent=value; }
}
class Anchor extends Element {}
const document = { createElement: tag => tag === 'a' ? new Anchor() : new Element(), createTextNode: text => ({textContent:text}) };
async function load(path, mocks, name) {
  const source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode:'transform' })
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/^import\s+["'][^"']+["'];?\s*$/gm,'').replace(/\bexport\s+(?:default\s+)?/g,'');
  return new Function(...Object.keys(mocks), source + `\nreturn ${name}`)(...Object.values(mocks));
}
const attribution = {provider:'spicylyrics',source:'spicy_lyrics',uploader:{id:'1',username:'<up>',url:'https://spicylyrics.org/uid/1'},maker:{id:'2',username:'maker',url:'https://spicylyrics.org/uid/2'}};
const SetLyricText = await load('../Source/Modules/LyricsRenderer/LyricText.ts', {attributionParts,document},'SetLyricText');
class Spring { constructor(value) { this.Final=value; } Set(value){ this.Final=value; } Update(){return this.Final;} IsSleeping(){return true;} }
const LineVocals = await load('../Source/Modules/LyricsRenderer/Components/LineVocals.ts', {Maid,Signal,SetLyricText,Spring,GetSpline:()=>({at:()=>1}),Clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),document},'LineVocals');
const globals = { Element:globalThis.Element, MutationObserver:globalThis.MutationObserver, ResizeObserver:globalThis.ResizeObserver };
Object.assign(globalThis,{Element,MutationObserver:class{},ResizeObserver:class{}});

test('credits are inline safe links inside an ordinary lead lyric, without seeking on link clicks', () => {
  const parent = new Element(), vocal = new LineVocals(parent,{StartTime:19.9,EndTime:20,Text:'credits'},attribution);
  const container=parent.children[0],span=container.children[0],links=span.children.filter(child=>child instanceof Anchor);
  assert.ok(container.classList.contains('Lead'));
  assert.ok(span.classList.contains('Synced') && span.classList.contains('Line'));
  assert.deepEqual(links.map(link=>[link.textContent,link.href]),[['🔗 <up>','https://spicylyrics.org/uid/1'],['🔗 maker','https://spicylyrics.org/uid/2']]);
  assert.ok(links.every(link=>link.target==='_blank'&&link.rel==='noopener noreferrer'));
  let stopped=false;links[0].listeners.get('click')({stopPropagation(){stopped=true;}});assert.equal(stopped,true);
  vocal.Destroy();assert.equal(parent.children.length,0);
});
test('the normal lyric animator highlights only the final 100ms and resets when seeking back', () => {
  const parent=new Element(),vocal=new LineVocals(parent,{StartTime:19.9,EndTime:20,Text:'credits'},attribution);
  for(const [time,active,sung] of [[19.89,false,false],[19.9,true,false],[19.99,true,false],[20,true,false],[20.01,false,true],[2,false,false],[19.95,true,false]]) {
    vocal.Animate(time,1/60,true);assert.equal(vocal.IsActive(),active);
    assert.equal(parent.children[0].classList.contains('Active'),active);
    assert.equal(parent.children[0].classList.contains('Sung'),sung);
  }
  vocal.Destroy();
});
test('unsafe contributor URLs remain text inside the lyric', () => {
  for(const url of ['javascript:alert(1)','data:text/html,hi','/relative','https://user:pass@spicylyrics.org/']) {
    const span=new Element();SetLyricText(span,'credits',{...attribution,uploader:{...attribution.uploader,url},maker:undefined});
    assert.equal(span.children.some(child=>child instanceof Anchor),false);
  }
});
test('renderers consume the Worker credit row once, without appending a client footer', async () => {
  for(const Type of ['Static','Line','Syllable']) {
    const measured=[],vocals=[],time=new Signal(),offset=new Signal();
    class Scroller { constructor(scroll,lyrics,groups) { measured.push(groups); } SetLyricsEnded(){} ForceToActive(){} Destroy(){} }
    class Vocal { RequestedTimeSkip=new Signal().GetEvent(); constructor(parent,metadata,attr){vocals.push({metadata,attr});} Animate(){} Destroy(){} }
    const Renderer=await load('../Source/Modules/LyricsRenderer.ts',{document,Maid,StaticVocals:Vocal,LineVocals:Vocal,SyllableVocals:Vocal,InterludeVisual:Vocal,
      LyricsScroller:Scroller,TimeStepped:time.GetEvent(),LyricsOffsetChanged:offset.GetEvent(),Timestamp:0,GetLyricsOffset:()=>0,SeekTo:()=>{},OnPreRender:()=>()=>{}},'LyricsRenderer');
    const row={Type:'Vocal',Text:'credits',IsAttribution:true,StartTime:19.9,EndTime:20,OppositeAligned:false,Lead:{StartTime:19.9,EndTime:20,Syllables:[{Text:'credits',StartTime:19.9,EndTime:20,IsPartOfWord:false}]}};
    const parent=new Element(),renderer=new Renderer(parent,{Type,NaturalAlignment:'Left',EndTime:20,Content:[row],Lines:[row],Attribution:attribution});
    assert.equal(measured[0].length,1);assert.equal(vocals.length,1);assert.deepEqual(vocals[0].attr,attribution);
    assert.equal(measured[0][0].GroupContainer.classList.contains('AttributionLine'),false);
    renderer.Destroy();assert.equal(parent.children.length,0);
  }
});
process.on('exit',()=>Object.assign(globalThis,globals));
