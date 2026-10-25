import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { startReleaseLoader } from "../Spices/AutoUpdate/ReleaseLoader.mjs";

const worker = "https://lyrics.txw.qzz.io/extension/";
const domestic = "https://lyrics.20050129.xyz/extension/";
const cdn = "https://cdn.jsdelivr.net/gh/yeahnangua/beautiful-lyrics-reborn@main/Extension/Builds/Release/";
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const bytes = code => new TextEncoder().encode(code).buffer;

function release(code) {
  const sha256 = createHash("sha256").update(code).digest("hex");
  return { schema: 1, version: "5.2.1", sha256, file: `beautiful-lyrics-reborn.${sha256.slice(0, 16)}.mjs` };
}
function fixture() {
  const oldCode = "export default 'old';", newCode = "export default 'new';";
  const old = release(oldCode), fresh = release(newCode);
  const stored = new Map();
  const calls = [], notifications = [], closedNotifications = [], imports = [];
  let interval;
  const runtime = {
    crypto: webcrypto, URL,
    console: { warn() {}, error() {}, info() {} },
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    setInterval: callback => { interval = callback; },
    Spicetify: {
      showNotification: (...args) => notifications.push(args),
      Snackbar: {
        enqueueSnackbar: (message, options) => { notifications.push({ message, options }); return "update-notice"; },
        closeSnackbar: key => closedNotifications.push(key),
      },
      React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    },
    importModule: async url => imports.push(await (await fetch(url)).text()),
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("latest.json")) return Response.json(fresh);
      if (url.endsWith(fresh.file)) return new Response(newCode);
      if (url.endsWith(old.file)) return new Response(oldCode);
      return new Response("Not found", { status: 404 });
    },
  };
  return { runtime, old, fresh, imports, notifications, closedNotifications, calls, stored, tick: () => interval() };
}
test("loads latest once and keeps one update notice visible until its close button is clicked", async () => {
  const f = fixture();
  await Promise.all([startReleaseLoader(f.old, f.runtime), startReleaseLoader(f.old, f.runtime)]);
  assert.equal(f.imports.length, 1);
  assert.equal(f.runtime.__beautifulLyricsRebornLoader.build, f.fresh.sha256);
  assert.equal(f.calls[0].options.cache, "no-store");
  assert.ok(f.calls.every(call => call.options.headers["User-Agent"] === "beautiful-lyrics-reborn"));
  assert.deepEqual(f.calls.filter(call => call.url.endsWith("latest.json")).map(call => call.url), [`${worker}latest.json`]);
  f.runtime.fetch = async () => Response.json(f.old); // Rollback is also an update.
  await f.tick(); await f.tick();
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].options.persist, true);
  assert.equal(f.notifications[0].options.autoHideDuration, undefined);
  assert.equal(f.notifications[0].message.children[0].children[0], "Beautiful Lyrics Reborn has an update. Reload Spotify to apply it.");
  const closeButton = f.notifications[0].message.children[1];
  assert.equal(closeButton.type, "button");
  assert.equal(closeButton.props["aria-label"], "Dismiss update notification");
  closeButton.props.onClick();
  assert.deepEqual(f.closedNotifications, ["update-notice"]);
  f.runtime.fetch = async () => Response.json(release("export default 'newer';"));
  await f.tick();
  assert.equal(f.notifications.length, 1);
  assert.equal(f.imports.length, 1);
});
test("reloading Spotify resets update notice dismissal", async () => {
  const first = fixture();
  await startReleaseLoader(first.old, first.runtime);
  first.runtime.fetch = async () => Response.json(first.old);
  await first.tick();
  first.notifications[0].message.children[1].props.onClick();

  const reloaded = fixture();
  await startReleaseLoader(reloaded.old, reloaded.runtime);
  reloaded.runtime.fetch = async () => Response.json(reloaded.old);
  await reloaded.tick();
  assert.equal(reloaded.notifications.length, 1);
});
test("a stale loader uses last successful release when pointer is unavailable", async () => {
  const f = fixture();
  f.stored.set("beautiful-lyrics-reborn:last-release", JSON.stringify(f.fresh));
  const fetcher = f.runtime.fetch;
  f.runtime.fetch = async (url, options) => url.endsWith("latest.json") ? new Response("Offline", { status: 503 }) : fetcher(url, options);
  await startReleaseLoader(f.old, f.runtime);
  assert.equal(f.runtime.__beautifulLyricsRebornLoader.build, f.fresh.sha256);
});

test("existing schema-one loader accepts a split release without requesting its fullscreen runtime", async () => {
  const f = fixture();
  f.fresh.fullscreen = { api: 1, sha256: 'a'.repeat(64), file: 'beautiful-lyrics-reborn-fullscreen.aaaaaaaaaaaaaaaa.mjs' };
  await startReleaseLoader(f.old, f.runtime);
  assert.deepEqual(f.imports, ["export default 'new';"]);
  assert.equal(f.runtime.__beautifulLyricsRebornLoader.build, f.fresh.sha256);
  assert.ok(f.calls.every(call => !call.url.includes('beautiful-lyrics-reborn-fullscreen.')));
});
test("rejects corrupt payloads and falls back before evaluating any code", async () => {
  const f = fixture();
  const fetcher = f.runtime.fetch;
  f.runtime.fetch = async (url, options) => url.endsWith(f.fresh.file) ? new Response("wrong code") : fetcher(url, options);
  await startReleaseLoader(f.old, f.runtime);
  assert.deepEqual(f.imports, ["export default 'old';"]);
  assert.equal(f.runtime.__beautifulLyricsRebornLoader.build, f.old.sha256);
});
test("uses jsDelivr only after both program routes fail", async () => {
  const f = fixture();
  const fetcher = f.runtime.fetch, payloadRequests = [];
  f.runtime.fetch = async (url, options) => {
    if (url.endsWith(".mjs")) payloadRequests.push(url);
    return url.startsWith("https://lyrics.") && url.endsWith(".mjs") ? new Response("Unavailable", { status: 503 }) : fetcher(url, options);
  };
  await startReleaseLoader(f.old, f.runtime);
  assert.equal(f.runtime.__beautifulLyricsRebornLoader.build, f.fresh.sha256);
  assert.deepEqual(payloadRequests, [worker + f.fresh.file, domestic + f.fresh.file, cdn + f.fresh.file]);
});

for (const winningOrigin of [worker, domestic]) {
  test(`races both routes and cancels the stalled body when ${winningOrigin} wins`, async () => {
    const f = fixture(), fetcher = f.runtime.fetch;
    const pending = new Map([worker, domestic].map(origin => [origin, { body: deferred() }]));
    f.runtime.fetch = async (url, options) => {
      if (url.endsWith("latest.json")) return fetcher(url, options);
      const origin = [worker, domestic].find(value => url.startsWith(value));
      assert.ok(origin, "jsDelivr must not be requested when a route succeeds");
      const request = pending.get(origin);
      request.signal = options.signal;
      return { ok: true, arrayBuffer: () => request.body.promise };
    };
    const loading = startReleaseLoader(f.old, f.runtime);
    await nextTurn();
    for (const request of pending.values()) assert.equal(request.signal.aborted, false);
    pending.get(winningOrigin).body.resolve(bytes("export default 'new';"));
    await loading;
    assert.deepEqual(f.imports, ["export default 'new';"]);
    assert.equal(pending.get(winningOrigin).signal.aborted, false);
    const losingOrigin = winningOrigin === worker ? domestic : worker;
    assert.equal(pending.get(losingOrigin).signal.aborted, true);
    pending.get(losingOrigin).body.resolve(bytes("late response"));
    await nextTurn();
    assert.equal(f.imports.length, 1);
  });
}

test("a fast corrupt response does not beat the other route's valid payload", async () => {
  const f = fixture(), fetcher = f.runtime.fetch, valid = deferred();
  f.runtime.fetch = async (url, options) => {
    if (url === worker + f.fresh.file) return new Response("corrupt");
    if (url === domestic + f.fresh.file) return { ok: true, arrayBuffer: () => valid.promise };
    assert.ok(!url.startsWith(cdn), "fallback must wait for both routes to fail");
    return fetcher(url, options);
  };
  const loading = startReleaseLoader(f.old, f.runtime);
  await nextTurn();
  assert.equal(f.imports.length, 0);
  valid.resolve(bytes("export default 'new';"));
  await loading;
  assert.deepEqual(f.imports, ["export default 'new';"]);
});

test("the winner must complete checksum verification, and late verification cannot execute again", async () => {
  const f = fixture(), digest = deferred();
  let verifications = 0;
  f.runtime.crypto = { subtle: { digest: (...args) => ++verifications === 1 ? digest.promise : webcrypto.subtle.digest(...args) } };
  await startReleaseLoader(f.old, f.runtime);
  assert.equal(verifications, 2);
  assert.deepEqual(f.imports, ["export default 'new';"]);
  digest.resolve(await webcrypto.subtle.digest("SHA-256", bytes("export default 'new';")));
  await nextTurn();
  assert.equal(f.imports.length, 1);
});

test("both stalled bodies time out before jsDelivr runs, and all timers are cleared", async () => {
  const f = fixture(), fetcher = f.runtime.fetch, timers = [], signals = [];
  f.runtime.setTimeout = (callback, duration) => {
    const timer = { callback, duration, cleared: false };
    timers.push(timer);
    return timer;
  };
  f.runtime.clearTimeout = timer => { timer.cleared = true; };
  f.runtime.fetch = async (url, options) => {
    if (url.endsWith(".mjs") && !url.startsWith(cdn)) {
      signals.push(options.signal);
      return { ok: true, arrayBuffer: () => new Promise(() => {}) };
    }
    return fetcher(url, options);
  };
  const loading = startReleaseLoader(f.old, f.runtime);
  await nextTurn();
  assert.equal(timers.length, 2);
  assert.ok(timers.every(timer => timer.duration === 60000));
  timers[0].callback();
  await nextTurn();
  assert.equal(f.imports.length, 0);
  assert.equal(timers.length, 2);
  timers[1].callback();
  await loading;
  assert.deepEqual(f.imports, ["export default 'new';"]);
  assert.ok(signals.every(signal => signal.aborted && signal.reason.name === "TimeoutError"));
  assert.equal(timers.length, 3);
  assert.equal(timers[2].duration, 60000);
  assert.ok(timers.every(timer => timer.cleared));
});
test("never executes a fallback after a module partially evaluates and throws", async () => {
  const f = fixture(); let evaluations = 0;
  f.runtime.importModule = async () => { evaluations++; throw new Error("Evaluation failure"); };
  await startReleaseLoader(f.old, f.runtime);
  assert.equal(evaluations, 1);
  assert.equal(f.runtime.__beautifulLyricsRebornLoader.status, "failed");
  assert.equal(f.stored.size, 0);
});
test("malformed pointer and inaccessible storage still allow embedded fallback", async () => {
  const f = fixture(); const fetcher = f.runtime.fetch;
  f.runtime.localStorage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  f.runtime.fetch = async (url, options) => url.endsWith("latest.json") ? Response.json({ file: "https://other.invalid/code.mjs" }) : fetcher(url, options);
  await startReleaseLoader(f.old, f.runtime);
  assert.equal(f.runtime.__beautifulLyricsRebornLoader.build, f.old.sha256);
});
