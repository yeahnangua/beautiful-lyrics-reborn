import { test } from "node:test";
import assert from "node:assert/strict";
import { createLyricsSessionClient, LyricsSessionError } from "../Spices/Spicetify/Services/LyricsSession.ts";
import { createAccessTokenProvider } from "../Spices/Spicetify/Services/AccessToken.ts";
import { LyricsSessionHeader, LyricsSessionLifetimeMs, RetryAfterSeconds } from "../../Universal/Modules/LyricsSession.ts";

const url = "https://lyrics.txw.qzz.io/lyrics/track?track_name=Song&artist_name=Artist";
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(overrides = {}) {
  let time = 1_800_000_000_000;
  let spotifyToken = "spotify-token";
  let invalidations = 0;
  const sessions = [], lyrics = [];
  const fetchImpl = async (destination, init) => {
    const request = { url: String(destination), ...init, headers: new Headers(init.headers) };
    if (request.url.endsWith("/auth/lyrics-session")) {
      sessions.push(request);
      return overrides.session?.(request, sessions.length, time) ?? Response.json({ token: `session-${sessions.length}`, expiresAt: time + LyricsSessionLifetimeMs });
    }
    lyrics.push(request);
    return overrides.lyrics?.(request, lyrics.length) ?? Response.json({ Type: "Static", Lines: [{ Text: "lyrics" }] });
  };
  const client = createLyricsSessionClient({
    getSpotifyToken: async () => spotifyToken,
    getSpotifyClient: () => overrides.client ?? { appPlatform: "OSX_ARM64", appVersion: "1.3.8.620" },
    invalidateSpotifyToken: token => { invalidations++; if (spotifyToken === token) spotifyToken = "refreshed-spotify-token"; },
    fetchImpl, now: () => time, ...(overrides.timeoutMs ? { sessionTimeoutMs: overrides.timeoutMs } : {})
  });
  return { client, sessions, lyrics, advance: ms => { time += ms; }, setToken: token => { spotifyToken = token; }, invalidations: () => invalidations };
}

test("current song and two prefetches share one exchange and reuse the in-memory session", async () => {
  const gate = deferred();
  const app = fixture({ session: (_request, _number, now) => gate.promise.then(() => Response.json({ token: "shared-session", expiresAt: now + LyricsSessionLifetimeMs })) });
  const requests = [app.client(url), app.client(url), app.client(url)];
  await flush();
  assert.equal(app.sessions.length, 1);
  assert.equal(app.sessions[0].headers.get("X-Spotify-App-Platform"), "OSX_ARM64");
  assert.equal(app.sessions[0].headers.get("X-Spotify-App-Version"), "1.3.8.620");
  assert.equal(app.lyrics.length, 0);
  gate.resolve();
  await Promise.all(requests);
  await app.client(url, { headers: { "X-Spotify-App-Platform": "desktop" } });
  assert.equal(app.sessions.length, 1);
  assert.equal(app.lyrics.length, 4);
  for (const request of app.lyrics) {
    assert.equal(request.headers.get("Authorization"), "Bearer spotify-token");
    assert.equal(request.headers.get(LyricsSessionHeader), "shared-session");
    assert.equal(request.cache, "no-store");
    assert.equal(request.credentials, "omit");
    assert.equal(request.redirect, "error");
  }
  assert.equal(app.lyrics.at(-1).headers.get("X-Spotify-App-Platform"), "desktop");
});

test("renews thirty seconds before expiry and whenever Spotify credentials change", async () => {
  const app = fixture();
  await app.client(url);
  app.advance(LyricsSessionLifetimeMs - 30_001);
  await app.client(url);
  assert.equal(app.sessions.length, 1);
  app.advance(1);
  await Promise.all([app.client(url), app.client(url)]);
  assert.equal(app.sessions.length, 2);
  app.setToken("different-spotify-token");
  await app.client(url);
  assert.equal(app.sessions.length, 3);
  assert.equal(app.lyrics.at(-1).headers.get("Authorization"), "Bearer different-spotify-token");
});

test("a late old exchange cannot replace the session for newer Spotify credentials", async () => {
  const old = deferred();
  const app = fixture({ session: (_request, number, now) => number === 1 ? old.promise.then(() => Response.json({ token: "old-session", expiresAt: now + LyricsSessionLifetimeMs })) : undefined });
  const first = app.client(url);
  await flush();
  app.setToken("new-spotify-token");
  await app.client(url);
  old.resolve();
  await first;
  await app.client(url);
  assert.equal(app.sessions.length, 2);
  assert.equal(app.lyrics.at(-1).headers.get(LyricsSessionHeader), "session-2");
  assert.equal(app.lyrics.at(-1).headers.get("Authorization"), "Bearer new-spotify-token");
});

test("a rejected session is recovered once, without an infinite retry loop", async () => {
  for (const persistent of [false, true]) {
    const app = fixture({ lyrics: (_request, number) => number === 1 || persistent ? Response.json({ code: "invalid_session" }, { status: 401 }) : undefined });
    if (persistent) await assert.rejects(app.client(url), error => error instanceof LyricsSessionError && error.code === "invalid_session");
    else assert.equal((await app.client(url)).status, 200);
    assert.equal(app.sessions.length, 2);
    assert.equal(app.lyrics.length, 2);
    assert.equal(app.invalidations(), 0);
  }
});

test("concurrent rejections renew one shared session", async () => {
  const gate = deferred();
  const app = fixture({ lyrics: async request => {
    if (request.headers.get(LyricsSessionHeader) === "session-1") {
      await gate.promise;
      return Response.json({ code: "invalid_session" }, { status: 401 });
    }
    return Response.json({ Type: "Static", Lines: [] });
  } });
  const pending = [app.client(url), app.client(url), app.client(url)];
  await flush();
  gate.resolve();
  await Promise.all(pending);
  assert.equal(app.sessions.length, 2);
  assert.equal(app.lyrics.length, 6);
});

test("invalid Spotify tokens are invalidated and obtained again only once", async () => {
  for (const persistent of [false, true]) {
    const app = fixture({ session: (_request, number) => number === 1 || persistent ? Response.json({ code: "invalid_spotify_token" }, { status: 401 }) : undefined });
    if (persistent) await assert.rejects(app.client(url), error => error.code === "invalid_spotify_token");
    else assert.equal((await app.client(url)).status, 200);
    assert.equal(app.sessions.length, 2);
    assert.equal(app.invalidations(), 1);
    assert.equal(app.sessions[1].headers.get("Authorization"), "Bearer refreshed-spotify-token");
    assert.equal(app.lyrics.length, persistent ? 0 : 1);
  }
});

test("permanent Spotify authorization failures are surfaced without credential refresh or lyrics calls", async () => {
  const app = fixture({ session: () => Response.json({ code: "spotify_forbidden", message: "PRIVATE RESPONSE" }, { status: 403 }) });
  await assert.rejects(app.client(url), error => error.status === 403 && error.code === "spotify_forbidden" && !error.message.includes("PRIVATE"));
  assert.equal(app.invalidations(), 0);
  assert.equal(app.lyrics.length, 0);
});

test("missing client metadata fails without sending a probe with a guessed platform", async () => {
  const app = fixture({ client: { appPlatform: "", appVersion: "" } });
  await assert.rejects(app.client(url), error => error.status === 400 && error.code === "invalid_spotify_client");
  assert.equal(app.sessions.length, 0);
  assert.equal(app.lyrics.length, 0);
  assert.equal(app.invalidations(), 0);
});

test("session and lyrics rate limits suppress all requests until Retry-After has elapsed", async () => {
  for (const phase of ["session", "lyrics"]) {
    const app = fixture({ [phase]: (_request, number) => number === 1 ? Response.json({ code: "rate_limited" }, { status: 429, headers: { "Retry-After": "7" } }) : undefined });
    await assert.rejects(app.client(url), error => error.status === 429 && error.retryAfter === 7);
    const before = app.sessions.length + app.lyrics.length;
    app.advance(6999);
    await assert.rejects(app.client(url), error => error.status === 429);
    assert.equal(app.sessions.length + app.lyrics.length, before);
    app.advance(1);
    assert.equal((await app.client(url)).status, 200);
  }
});

test("cancelling one song does not cancel a shared exchange or the remaining song", async () => {
  const gate = deferred();
  const app = fixture({ session: (_request, _number, now) => gate.promise.then(() => Response.json({ token: "shared", expiresAt: now + LyricsSessionLifetimeMs })) });
  const controller = new AbortController();
  const first = app.client(url, { signal: controller.signal });
  const rejected = assert.rejects(first, { name: "AbortError" });
  const second = app.client(url);
  await flush();
  controller.abort();
  await rejected;
  assert.equal(app.sessions.length, 1);
  assert.equal(app.sessions[0].signal.aborted, false);
  gate.resolve();
  assert.equal((await second).status, 200);
  assert.equal(app.lyrics.length, 1);
});

test("cancellation before a request sends no credentials", async () => {
  const app = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(app.client(url, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(app.sessions.length, 0);
});

test("stalled session response bodies time out and subsequent calls can recover", async () => {
  const app = fixture({ timeoutMs: 20, session: (_request, number) => number === 1 ? { ok: true, json: () => new Promise(() => {}) } : undefined });
  await assert.rejects(app.client(url), error => error.code === "auth_unavailable" && error.status === 503);
  assert.equal(app.lyrics.length, 0);
  assert.equal((await app.client(url)).status, 200);
  assert.equal(app.sessions.length, 2);
});

test("malformed or expired sessions fail without caching a missing lyric result", async () => {
  for (const payload of [{}, { token: "s", expiresAt: 0 }, { token: "", expiresAt: 2_000_000_000_000 }]) {
    const app = fixture({ session: (_request, number) => number === 1 ? Response.json(payload) : undefined });
    await assert.rejects(app.client(url), error => error.code === "auth_unavailable");
    assert.equal(app.lyrics.length, 0);
    assert.equal((await app.client(url)).status, 200);
  }
});

test("Spotify token invalidation preserves a newer cache and shares the refresh", async () => {
  let calls = 0;
  const provider = createAccessTokenProvider(async () => ({ accessToken: `spotify-${++calls}`, expiresAtTime: Date.now() + 60000, tokenType: "Bearer" }), () => undefined);
  assert.equal(await provider(), "spotify-1");
  provider.invalidate("spotify-1");
  assert.deepEqual(await Promise.all([provider(), provider(), provider()]), ["spotify-2", "spotify-2", "spotify-2"]);
  provider.invalidate("spotify-1");
  assert.equal(await provider(), "spotify-2");
  assert.equal(calls, 2);
});

test("credentials cannot be sent to unrelated hosts or routes", async () => {
  const app = fixture();
  for (const target of ["https://example.test/lyrics/song", "https://lyrics.txw.qzz.io/reports", "http://lyrics.txw.qzz.io/lyrics/song"]) {
    await assert.rejects(app.client(target), /Invalid lyrics API destination/);
  }
  assert.equal(app.sessions.length, 0);
  assert.equal(app.lyrics.length, 0);
});

test("Retry-After accepts seconds and HTTP dates and provides a bounded default for invalid values", () => {
  const now = Date.UTC(2026, 10, 6);
  assert.equal(RetryAfterSeconds("2.2", now), 3);
  assert.equal(RetryAfterSeconds(new Date(now + 9000).toUTCString(), now), 9);
  assert.equal(RetryAfterSeconds("nonsense", now), 60);
  assert.equal(RetryAfterSeconds(null, now), 60);
});
