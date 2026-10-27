import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { Maid } from '../../Universal/Modules/Maid.ts';
import { Signal } from '../../Universal/Modules/Signal.ts';
import { contributorUrl } from '../../Universal/Modules/LyricsAttribution.ts';

class Element {
  children = []; style = {}; parent;
  classList = { values: new Set(), add(...names) { names.forEach(name => this.values.add(name)); },
    toggle(name, enabled) { if(enabled) this.values.add(name); else this.values.delete(name); }, contains(name) { return this.values.has(name); } };
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  remove() { if(this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  set textContent(value) { this.children = []; this.text = value; }
  get textContent() { return this.text ?? this.children.map(child => child.textContent).join(''); }
}
class Anchor extends Element {}
const document = { createElement: tag => tag === 'a' ? new Anchor() : new Element(), createTextNode: text => ({textContent:text}) };
async function load(path, mocks, name) {
  const source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode:'transform' })
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/^import\s+["'][^"']+["'];?\s*$/gm,'').replace(/\bexport\s+default\s+/g,'');
  return new Function(...Object.keys(mocks), source + `\nreturn ${name}`)(...Object.values(mocks));
}
const attribution = {provider:'spicylyrics',source:'spicy_lyrics',uploader:{id:'1',username:'<up>',url:'https://spicylyrics.org/uid/1'},maker:{id:'2',username:'maker',url:'https://spicylyrics.org/uid/2'}};
const AttributionVocals = await load('../Source/Modules/LyricsRenderer/Components/AttributionVocals.ts', {Maid,Signal,contributorUrl,document,HTMLAnchorElement:Anchor},'AttributionVocals');
const globals = { Element:globalThis.Element, MutationObserver:globalThis.MutationObserver, ResizeObserver:globalThis.ResizeObserver };
Object.assign(globalThis,{Element,MutationObserver:class{},ResizeObserver:class{}});

test('each contributor icon and username form one safe link and clean up together', () => {
  const parent = new Element(), vocal = new AttributionVocals(parent,attribution);
  const links = parent.children[0].children.filter(child => child instanceof Anchor);
  assert.deepEqual(links.map(link => [link.textContent,link.href]),[['🔗 <up>','https://spicylyrics.org/uid/1'],['🔗 maker','https://spicylyrics.org/uid/2']]);
  assert.ok(links.every(link => link.target === '_blank' && link.rel === 'noopener noreferrer'));
  vocal.Destroy(); assert.equal(parent.children.length,0);
});
test('footer becomes active for the final 100ms, then sung, and resets on seek', () => {
  const parent = new Element(), vocal = new AttributionVocals(parent,attribution,10), changes=[];
  vocal.ActivityChanged.Connect(value=>changes.push(value));
  for(const [time,active,sung] of [[9.89,false,false],[9.9,true,false],[9.99,true,false],[10,false,true],[2,false,false],[9.95,true,false]]) {
    vocal.Animate(time,1/60,true); assert.equal(vocal.IsActive(),active);
    assert.equal(parent.children[0].classList.contains('Active'),active);
    assert.equal(parent.children[0].classList.contains('Sung'),sung);
  }
  assert.deepEqual(changes,[true,false,true]);vocal.Destroy();
});
test('script/data/relative/credential URLs cannot become clickable credits', () => {
  for(const url of ['javascript:alert(1)','data:text/html,hi','/relative','https://user:pass@spicylyrics.org/']) {
    const parent=new Element(),vocal=new AttributionVocals(parent,{...attribution,uploader:{...attribution.uploader,url},maker:undefined});
    assert.equal(parent.children[0].children.some(child=>child instanceof Anchor),false);vocal.Destroy();
  }
});
test('static and timed renderers register the footer before scroller construction', async () => {
  for(const Type of ['Static','Line','Syllable']) {
    const measured=[],frames=[],time=new Signal(),offset=new Signal();
    class Scroller { constructor(scroll,lyrics,groups,synced) { measured.push({groups:[...groups],synced}); } SetLyricsEnded(){} ForceToActive(){} Destroy(){} }
    class Vocal { Destroy(){} }
    const Renderer=await load('../Source/Modules/LyricsRenderer.ts',{document,Maid,AttributionVocals,StaticVocals:Vocal,LineVocals:Vocal,SyllableVocals:Vocal,InterludeVisual:Vocal,
      LyricsScroller:Scroller,TimeStepped:time.GetEvent(),LyricsOffsetChanged:offset.GetEvent(),Timestamp:0,GetLyricsOffset:()=>0,SeekTo:()=>{},OnPreRender:fn=>{frames.push(fn);return ()=>{};}},'LyricsRenderer');
    const parent=new Element(), renderer=new Renderer(parent,{Type,NaturalAlignment:'Left',EndTime:10,Content:[],Lines:[{Text:'words'}],Attribution:attribution});
    const footer=measured[0].groups.at(-1);
    assert.equal(footer.GroupContainer.classList.contains('AttributionLine'),true);
    assert.equal(footer.Vocals.length,1);
    if(Type==='Static') assert.equal(measured[0].groups.length,2);
    else {
      frames.forEach(fn=>fn());offset.Fire(9.95);assert.equal(footer.Vocals[0].IsActive(),true);
      offset.Fire(0);assert.equal(footer.Vocals[0].IsActive(),false);
    }
    renderer.Destroy();assert.equal(parent.children.length,0);
  }
});
process.on('exit',()=>Object.assign(globalThis,globals));
