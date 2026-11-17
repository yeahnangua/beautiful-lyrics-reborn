import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { Abortable, CreateAbortScope } from '../../Universal/Modules/Async.ts';

const source = await readFile(new URL('../Spices/Spicetify/Services/Player/mod.ts', import.meta.url), 'utf8');
const filter = source.slice(source.indexOf('const SongNameFilters ='), source.indexOf('const LoadSongDetails ='));
const resolver = source.slice(source.indexOf('const ResolveAppleMusicId ='), source.indexOf('let lyricsController:'));
const js = stripTypeScriptTypes(filter + resolver, { mode: 'transform' });
const candidate = (extra = {}) => ({ trackId: 222, trackName: 'Home', artistName: 'Expected Singer', trackTimeMillis: 180000, ...extra });
const url = (name = 'Home', artists = ['Expected Singer'], duration = 180) => {
  const request = new URL('https://lyrics.test/lyrics/track');
  request.searchParams.set('track_name', name);
  for (const artist of artists) request.searchParams.append('artist_name', artist);
  if (duration !== undefined) request.searchParams.set('duration', String(duration));
  return request.href;
};
function fixture(results, timeoutMs = 4000) {
  const requests = [];
  const resolve = new Function('Abortable', 'CreateAbortScope', 'SimplifySearchText', 'fetch', js + ';return ResolveAppleMusicId;')(
    Abortable, (ms, parent) => CreateAbortScope(Math.min(ms, timeoutMs), parent), text => text,
    async (input, init) => { requests.push({ input, init }); return typeof results === 'function' ? results() : Response.json({ results }); },
  );
  return { requests, resolve: (input = url(), signal = new AbortController().signal) => resolve(input, signal) };
}

test('same title and duration cannot select the wrong artist or a substring artist', async () => {
  const app = fixture([candidate({trackId:111, artistName:'Wrong Singer'}), candidate({trackId:112, artistName:'Expected Singer Tribute Band'}), candidate()]);
  assert.deepEqual(await app.resolve(), { id: '222', title: 'Home' });
});

test('title normalization keeps live, remix and cover versions distinct', async () => {
  const app = fixture([candidate({trackId:111, trackName:'Home (Live)'}), candidate({trackId:112, trackName:'Home (Remix)'}),
    candidate({trackId:113, trackName:'Home Again'}), candidate({trackId:114, trackName:'Home (Cover)'}), candidate()]);
  assert.equal((await app.resolve()).id, '222');
  assert.equal((await app.resolve(url('Home (Live)'))).id, '111');
  assert.equal((await app.resolve(url('HOME - Remastered 2020'))).id, '222');
  assert.equal((await app.resolve(url('Ｈｏｍｅ', ['EXPECTED SINGER']))).id, '222');
});

test('collaborations can match any supplied artist but missing metadata is rejected', async () => {
  const app = fixture([null, candidate({trackId:-1}), candidate({artistName:undefined}), candidate({trackTimeMillis:undefined}),
    candidate({trackTimeMillis:190000}), candidate({artistName:'Expected Singer & Guest'})]);
  assert.equal((await app.resolve(url('Home', ['Other', 'Guest']))).id, '222');
  assert.equal(await app.resolve(url('Home', [])), undefined);
  assert.equal(app.requests.length, 1);
});

test('search failure, stalled bodies and cancellation allow other lyric providers to proceed', async () => {
  const failed = fixture(() => { throw Error('Offline'); });
  assert.equal(await failed.resolve(), undefined);
  const stalled = fixture(() => ({ ok: true, json: () => new Promise(() => {}) }), 10);
  assert.equal(await stalled.resolve(), undefined);
  const controller = new AbortController(); controller.abort();
  const cancelled = fixture([candidate()]);
  assert.equal(await cancelled.resolve(url(), controller.signal), undefined);
  assert.equal(cancelled.requests.length, 0);
});
