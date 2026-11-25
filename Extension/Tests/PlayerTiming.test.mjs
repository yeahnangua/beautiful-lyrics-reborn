import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { Abortable, CreateAbortScope } from '../../Universal/Modules/Async.ts';
import { Signal } from '../../Universal/Modules/Signal.ts';

const source = await readFile(new URL('../Spices/Spicetify/Services/Player/mod.ts', import.meta.url), 'utf8');
const start = source.indexOf('// Handle position syncing');
const clockSource = source.slice(start, source.indexOf('\n\t\t}', start));
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(t, { resume = async () => {}, local = false, timeoutMs = 2000 } = {}) {
  const tasks = new Map(), frames = [], songChanged = new Signal(), playingChanged = new Signal();
  let clock = 0, destroyed = false;
  const dispose = item => { if (typeof item === 'function') item(); else item?.Disconnect?.(); };
  const maid = {
    Give(item, key = Symbol()) {
      if (destroyed) { dispose(item); return item; }
      dispose(tasks.get(key)); tasks.set(key, item); return item;
    },
    Clean(key) { dispose(tasks.get(key)); tasks.delete(key); },
    Destroy() { destroyed = true; for (const item of tasks.values()) dispose(item); tasks.clear(); },
  };
  t.after(() => maid.Destroy());
  const platform = { PlaybackAPI: { _isLocal: local }, PlayerAPI: {
    _events:{addListener(){},removeListener(){}}, _contextPlayer: { resume }, _state: { positionAsOfTimestamp: 10000, timestamp: 100000 },
  } };
  const mocks = {
    SpotifyPlatform: platform, PlayerMaid: maid, SongChangedSignal: songChanged, IsPlayingChangedSignal: playingChanged,
    TimeSteppedSignal: { Fire: (...args) => frames.push(args) },
    Abortable, CreateAbortScope: (ms, parent) => CreateAbortScope(Math.min(ms, timeoutMs), parent),
    Date: { now: () => 100000 + clock }, performance: { now: () => clock },
    Timeout: (seconds, callback) => ({ seconds, callback }), Defer: callback => ({ callback }),
  };
  const body = stripTypeScriptTypes('let IsPlaying = true, Timestamp = 0; let Song = {Uri:"A"};\n' + clockSource, { mode: 'transform' });
  const app = new Function(...Object.keys(mocks), body + `
    return {
      snapshot: () => ({ Timestamp, syncedPosition }),
      changeSong() { Song = {Uri:'B'}; Timestamp = 0; SongChangedSignal.Fire(); },
      pause() { IsPlaying = false; IsPlayingChangedSignal.Fire(); },
    };`)(...Object.values(mocks));
  return { ...app, platform, tasks, frames, destroy: () => maid.Destroy(),
    advance: ms => { clock += ms; },
    run(key) { const task = tasks.get(key); assert.ok(task, `Missing ${key}`); tasks.delete(key); return task.callback(); },
  };
}

test('first resync failure leaves the frame loop alive and retries recover playback', async t => {
  let attempts = 0;
  const app = fixture(t, { resume: async () => { if (++attempts === 1) throw Error('Disconnected'); } });
  assert.ok(app.tasks.has('Timestep'));
  await flush();
  assert.equal(app.tasks.get('TimestampPositionSync').seconds, 1);
  app.advance(100); app.run('Timestep');
  assert.equal(app.snapshot().Timestamp, 0.1);
  app.run('TimestampPositionSync'); await flush(); app.run('Timestep');
  assert.equal(attempts, 2); assert.equal(app.snapshot().Timestamp, 10.1);
});

test('a stalled or synchronously throwing resync stays bounded and can recover', async t => {
  let attempts = 0;
  const app = fixture(t, { timeoutMs: 10, resume: () => {
    if (++attempts === 1) return new Promise(() => {});
    if (attempts === 2) throw Error('Device gone');
    return Promise.resolve();
  } });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(app.tasks.has('Timestep'));
  app.run('TimestampPositionSync'); await flush();
  app.run('TimestampPositionSync'); await flush(); app.run('Timestep');
  assert.equal(attempts, 3); assert.equal(app.snapshot().Timestamp, 10);
});

test('resync latency is counted once, using the timestamp captured with the sample', async t => {
  const pending = deferred();
  const app = fixture(t, { resume: () => pending.promise });
  await flush(); app.advance(500); pending.resolve(); await flush();
  assert.deepEqual(app.snapshot().syncedPosition, { Position: 10500, StartedSyncAt: 500 });
  app.advance(100); app.run('Timestep');
  assert.equal(app.snapshot().Timestamp, 10.6);
});

test('local and paused playback use state directly without remote resume calls', async t => {
  let calls = 0;
  const app = fixture(t, { local: true, resume: async () => { calls++; } });
  app.run('Timestep'); assert.equal(app.snapshot().Timestamp, 10);
  app.platform.PlayerAPI._state.positionAsOfTimestamp = 25000; app.pause(); app.advance(300);
  await flush();
  assert.equal(app.tasks.has('TimestampPositionSync'),false);
  assert.equal(app.tasks.has('Timestep'),false);
  assert.equal(app.snapshot().Timestamp, 25); assert.equal(calls, 0);
});

test('old song syncs and teardown cannot publish late positions or restart timers', async t => {
  const pending = deferred();
  const app = fixture(t, { resume: () => pending.promise });
  await flush(); app.platform.PlayerAPI._contextPlayer.resume = () => new Promise(() => {}); app.changeSong(); pending.resolve(); await flush();
  assert.equal(app.snapshot().syncedPosition, undefined);
  const later = deferred(); app.platform.PlayerAPI._contextPlayer.resume = () => later.promise;
  app.changeSong(); await flush(); app.destroy(); later.resolve(); await flush();
  assert.equal(app.snapshot().syncedPosition, undefined); assert.equal(app.tasks.size, 0);
});

test('playing seeks emit a zero-delta skip in both directions', async t => {
  const app = fixture(t, {local:true});
  app.run('Timestep'); await flush();
  app.platform.PlayerAPI._state.positionAsOfTimestamp = 30000;
  app.run('TimestampPositionSync'); await flush(); app.run('Timestep');
  assert.deepEqual(app.frames.at(-1),[0,true]);
  app.platform.PlayerAPI._state.positionAsOfTimestamp = 29900;
  app.run('TimestampPositionSync'); await flush(); app.run('Timestep');
  assert.deepEqual(app.frames.at(-1),[0,true]);
  assert.equal(app.snapshot().Timestamp,29.9);
});
