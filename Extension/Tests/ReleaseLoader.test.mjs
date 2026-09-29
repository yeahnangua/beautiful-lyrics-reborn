import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { startReleaseLoader } from "../Spices/AutoUpdate/ReleaseLoader.mjs";

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
test("rejects corrupt payloads and falls back before evaluating any code", async () => {
  const f = fixture();
  const fetcher = f.runtime.fetch;
  f.runtime.fetch = async (url, options) => url.endsWith(f.fresh.file) ? new Response("wrong code") : fetcher(url, options);
  await startReleaseLoader(f.old, f.runtime);
  assert.deepEqual(f.imports, ["export default 'old';"]);
  assert.equal(f.runtime.__beautifulLyricsRebornLoader.build, f.old.sha256);
});
test("uses CDN if Worker bundle is unavailable", async () => {
  const f = fixture();
  const fetcher = f.runtime.fetch;
  f.runtime.fetch = async (url, options) => url.startsWith("https://lyrics.") && url.endsWith(".mjs") ? new Response("Unavailable", { status: 503 }) : fetcher(url, options);
  await startReleaseLoader(f.old, f.runtime);
  assert.equal(f.runtime.__beautifulLyricsRebornLoader.build, f.fresh.sha256);
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
