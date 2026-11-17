import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../Spices/Spicetify/Services/Cache.ts', import.meta.url), 'utf8');
const js = stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[^\n]*\n/gm, '').replace(/\bexport\s+/g, '');
function fixture(storage) {
  return new Function('localStorage', 'IsDevelopment', js + ';return GetInstantStore;')(storage, false);
}

test('corrupt JSON and invalid store envelopes restore independent defaults', () => {
  for (const raw of ['{', 'null', '[]', '{}', '{"Version":1}', '{"Version":1,"Items":null}', '{"Version":1,"Items":[]}', '{"Version":2,"Items":{"enabled":true}}']) {
    const data = new Map([['a', raw], ['b', raw]]);
    const get = fixture({ getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) });
    const template = { enabled: false, Songs: {} };
    const a = get('a', 1, template), b = get('b', 1, template);
    assert.deepEqual(a.Items, template);
    a.Items.Songs.track = 0.4; a.SaveChanges();
    assert.deepEqual(JSON.parse(data.get('a')).Items.Songs, { track: 0.4 });
    assert.deepEqual(b.Items.Songs, {}); assert.deepEqual(template.Songs, {});
  }
});

test('repairing one malformed preference preserves valid siblings and song offsets', () => {
  const saved = { Version: 1, Items: { enabled: true, view: { hidden: 'bad', scale: 1.5 }, Songs: { track: 0.4 }, list: null } };
  let persisted;
  const get = fixture({ getItem: () => JSON.stringify(saved), setItem: (_, value) => { persisted = JSON.parse(value); } });
  const store = get('settings', 1, { enabled: false, view: { hidden: false, scale: 1 }, Songs: {}, list: [] });
  assert.deepEqual(store.Items, { enabled: true, view: { hidden: false, scale: 1.5 }, Songs: { track: 0.4 }, list: [] });
  store.SaveChanges(); assert.deepEqual(persisted.Items, store.Items);
  for (const bad of [null, [], 'bad']) {
    const load = fixture({ getItem: () => JSON.stringify({Version:1,Items:{Songs:bad,view:bad}}) });
    assert.deepEqual(load('settings',1,{Songs:{},view:{hidden:false}}).Items,{Songs:{},view:{hidden:false}});
  }
});

test('blocked reads and quota failures keep edits available in memory and can later persist', () => {
  let blocked = true, saved;
  const get = fixture({
    getItem() { throw new DOMException('Blocked', 'SecurityError'); },
    setItem(_, value) { if (blocked) throw new DOMException('Full', 'QuotaExceededError'); saved = JSON.parse(value); },
  });
  const store = get('offsets', 1, { Songs: {} });
  store.Items.Songs.track = 0.8;
  assert.doesNotThrow(() => store.SaveChanges()); assert.equal(store.Items.Songs.track, 0.8);
  blocked = false; store.SaveChanges(); assert.equal(saved.Items.Songs.track, 0.8);
});
