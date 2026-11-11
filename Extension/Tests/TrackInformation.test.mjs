import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrackInformationLoader, getTrackIsrc, resolveTrackIsrc } from '../Spices/Spicetify/Services/TrackInformation.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const information = (id = 'A', isrc = 'USABC2400001') => ({ gid: id, name: id, external_id: isrc === undefined ? [] : [{ type: 'isrc', id: isrc }] });
function fixture(t, overrides = {}) {
  const cache = new Map(), reads = [], requests = [], writes = [];
  const loader = createTrackInformationLoader({
    getCached: async id => { reads.push(id); return cache.get(id); },
    fetchTrack: async id => { requests.push(id); return information(id); },
    setCached: async (id, value) => { writes.push(id); cache.set(id, value); },
    ...overrides
  });
  t.after(() => loader.destroy());
  return { loader, cache, reads, requests, writes };
}

test('details, current lyrics and prefetch share one cache read and request per song', async t => {
  const ready = deferred(); let calls = 0;
  const app = fixture(t, { fetchTrack: () => { calls++; return ready.promise; } });
  const details = app.loader('A');
  assert.equal(app.loader('A'), details);
  const isrc = resolveTrackIsrc(app.loader, 'A', new AbortController().signal);
  await flush();
  assert.deepEqual(app.reads, ['A']); assert.equal(calls, 1);
  ready.resolve(information());
  assert.equal((await details).gid, 'A');
  assert.equal(await isrc, 'USABC2400001');
  await flush();
  assert.equal(await resolveTrackIsrc(app.loader, 'A', new AbortController().signal), 'USABC2400001');
  assert.equal(calls, 1); assert.deepEqual(app.writes, ['A']);
});

test('each song uses its own cached ISRC and a cache hit sends no metadata request', async t => {
  const app = fixture(t);
  app.cache.set('A', information('A', ' usabc2400001 '));
  app.cache.set('B', information('B', 'USABC2400002'));
  const parent = new AbortController().signal;
  assert.deepEqual(await Promise.all(['A', 'B'].map(id => resolveTrackIsrc(app.loader, id, parent))), ['USABC2400001', 'USABC2400002']);
  assert.deepEqual(app.requests, []);
});

test('cancelling one lyric waiter preserves metadata awaited by the details view', async t => {
  const ready = deferred(), started = deferred();
  const app = fixture(t, { fetchTrack: () => { started.resolve(); return ready.promise; } });
  const details = app.loader('A'), controller = new AbortController();
  const waiting = resolveTrackIsrc(app.loader, 'A', controller.signal);
  const rejected = assert.rejects(waiting, { name: 'AbortError' });
  await started.promise; controller.abort(); await rejected;
  ready.resolve(information());
  assert.equal((await details).gid, 'A');
  await flush(); assert.equal(app.cache.get('A').gid, 'A');
});

test('short ISRC timeout allows the shared lookup to finish and warm the cache', async t => {
  const ready = deferred();
  const app = fixture(t, { fetchTrack: () => ready.promise });
  const details = app.loader('A');
  assert.equal(await resolveTrackIsrc(app.loader, 'A', new AbortController().signal, 10), undefined);
  ready.resolve(information()); await details; await flush();
  assert.equal(app.cache.get('A').gid, 'A');
});

test('cache failures fall through to metadata and failed requests can be retried', async t => {
  let calls = 0;
  const app = fixture(t, {
    getCached: async () => { throw Error('storage unavailable'); },
    fetchTrack: async id => { if (++calls === 1) throw Error('offline'); return information(id); },
    setCached: async () => { throw Error('storage unavailable'); }
  });
  assert.equal(await resolveTrackIsrc(app.loader, 'A', new AbortController().signal), undefined);
  await flush();
  assert.equal(await resolveTrackIsrc(app.loader, 'A', new AbortController().signal), 'USABC2400001');
  assert.equal(calls, 2);
});

test('slow cache persistence does not delay callers or start a duplicate metadata fetch', async t => {
  const write = deferred(); let calls = 0;
  const app = fixture(t, {
    fetchTrack: async id => { calls++; return information(id); },
    setCached: () => write.promise
  });
  assert.equal((await app.loader('A')).gid, 'A');
  assert.equal((await app.loader('A')).gid, 'A');
  assert.equal(calls, 1);
  write.resolve(); await flush();
});

test('a rejected shared lookup can be retried immediately by its caller', async t => {
  let calls = 0;
  const app = fixture(t, { fetchTrack: async id => { if (++calls === 1) throw Error('offline'); return information(id); } });
  const recovered = await app.loader('A').catch(() => app.loader('A'));
  assert.equal(recovered.gid, 'A'); assert.equal(calls, 2);
});

test('a stuck shared request expires and its late result cannot replace a retry', async t => {
  const late = deferred(); let calls = 0;
  const app = fixture(t, { timeoutMs: 20,
    fetchTrack: async id => ++calls === 1 ? late.promise : information(id, 'USABC2400002') });
  await assert.rejects(app.loader('A'), { name: 'TimeoutError' });
  await flush();
  assert.equal(getTrackIsrc(await app.loader('A')), 'USABC2400002');
  late.resolve(information('A', 'USABC2400001')); await flush();
  assert.equal(getTrackIsrc(app.cache.get('A')), 'USABC2400002');
  assert.equal(calls, 2); assert.deepEqual(app.writes, ['A']);
});

test('a stuck cache read is bounded and cannot start a late network request', async t => {
  const read = deferred();
  const app = fixture(t, { timeoutMs: 20, getCached: () => read.promise });
  await assert.rejects(app.loader('A'), { name: 'TimeoutError' });
  read.resolve(undefined); await flush();
  assert.deepEqual(app.requests, []);
});

test('teardown releases pending callers and prevents further requests', async t => {
  const ready = deferred();
  const app = fixture(t, { fetchTrack: () => ready.promise });
  const waiting = app.loader('A'), rejected = assert.rejects(waiting, { name: 'AbortError' });
  await flush(); app.loader.destroy(); await rejected;
  ready.resolve(information()); await flush();
  assert.deepEqual(app.writes, []);
  await assert.rejects(app.loader('B'), /closed/);
});

test('missing or malformed ISRC is harmless and valid codes are normalized', () => {
  for (const external_id of [undefined, null, [], [{ type: 'isrc', id: '' }], [{ type: 'isrc', id: 'bad' }], [{ type: 'isrc', id: 1 }]]) {
    assert.equal(getTrackIsrc({ external_id }), undefined);
  }
  assert.equal(getTrackIsrc({ external_id: [{ type: 'other', id: 'USABC2400009' }, { type: 'isrc', id: 'bad' }, { type: 'isrc', id: ' usabc2400001 ' }] }), 'USABC2400001');
});
