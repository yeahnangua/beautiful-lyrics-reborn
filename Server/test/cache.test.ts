import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheIdentity, cachePath, cacheTtlMs, createOriginRequest, readOriginRequest, trackCachePrefix,
  type OriginBinding, type OriginEnvelope } from "../src/cache";
import { createLyricsOrigin } from "../src/lyrics-origin";
import { createWorker, type WorkerEnv } from "../src/index";
import { loadDiagnostics } from "../src/diagnostics";
import { putSourceBlock } from "../src/source-blocks";
import { createLyricsService, type LyricsService } from "../src/service";
import type { BeautifulLyrics, RequestDiagnostics } from "../src/types";
import { lyricsAuthFixture } from "./lyrics-auth-fixture";

const auth = await lyricsAuthFixture();
const otherAuth = await lyricsAuthFixture("OTHER_TOKEN");
const metadata = { id: "track", name: "成都", artists: ["赵雷"], durationSeconds: 100 };
const lyrics: BeautifulLyrics = {
  Type: "Syllable", StartTime: 0, EndTime: 2,
  Source: { Provider: "lrc.red", Transport: "direct", TrackId: "USABC2400001" },
  Attribution: { provider: "lrc.red", source: "lrc.red" },
  Content: [{ Type: "Vocal", OppositeAligned: false,
    Lead: { StartTime: 0, EndTime: 2, Syllables: [{ Text: "LYRIC_BODY_SECRET", StartTime: 0, EndTime: 2, IsPartOfWord: false }] } }]
};
let mf: Miniflare;
let db: D1Database;
let background: Promise<unknown>[];
let ctx: ExecutionContext;

beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}",
    d1Databases: ["FEEDBACK_DB"], compatibilityDate: "2026-05-22" });
  db = await mf.getD1Database("FEEDBACK_DB") as unknown as D1Database;
  for (const file of (await readdir("migrations")).filter(file => file.endsWith(".sql")).sort()) {
    await db.exec((await readFile("migrations/" + file, "utf8")).replace(/^\s*--.*$/gm, "").replace(/\r?\n/g, " "));
  }
}, 20_000);
afterAll(async () => { await mf?.dispose(); });
beforeEach(async () => {
  await db.exec("DELETE FROM lyric_reports; DELETE FROM lyric_requests; DELETE FROM lyric_origin_runs; " +
    "DELETE FROM source_block_history; DELETE FROM source_blocks;");
  background = [];
  ctx = { waitUntil: (promise: Promise<unknown>) => background.push(promise) } as unknown as ExecutionContext;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => { await drain(); vi.restoreAllMocks(); });
async function drain() { while (background.length) await Promise.all(background.splice(0)); }
function request(extra: Record<string, string> = {}, headers: HeadersInit = auth.headers, signal?: AbortSignal) {
  const url = new URL("https://lyrics.test/lyrics/track");
  for (const [key, value] of Object.entries({ track_name: metadata.name, artist_name: metadata.artists[0]!,
    duration: String(metadata.durationSeconds), ...extra })) url.searchParams.set(key, value);
  return new Request(url, { headers, ...(signal ? { signal } : {}) });
}
function withStatus(response: Response, status: string) {
  const headers = new Headers(response.headers);
  headers.set("CF-Cache-Status", status);
  return new Response(response.clone().body, { status: response.status, headers });
}
/** Emulates the cache boundary, not Cloudflare itself; production gets a real smoke test. */
function cacheFixture(service: LyricsService, overrides: Partial<WorkerEnv> = {}) {
  const points = vi.fn();
  const env: WorkerEnv = { ...auth.env, FEEDBACK_DB: db, METRICS: { writeDataPoint: points } as unknown as AnalyticsEngineDataset, ...overrides };
  const run = createLyricsOrigin(service);
  const entries = new Map<string, { response: Response; until: number }>();
  const inflight = new Map<string, Promise<Response>>();
  const fetch = vi.fn(async (req: Request, init?: { cache?: "no-store" }): Promise<Response> => {
    if (init?.cache === "no-store") return withStatus(await run(req, env, ctx), "BYPASS");
    const key = new URL(req.url).pathname;
    const cached = entries.get(key);
    if (cached && cached.until > Date.now()) return withStatus(cached.response, "HIT");
    let pending = inflight.get(key);
    if (!pending) {
      pending = run(req, env, ctx).then(response => {
        const maxAge = /public, max-age=(\d+)/.exec(response.headers.get("Cache-Control") ?? "");
        if (maxAge && response.status === 200) entries.set(key, { response: response.clone(), until: Date.now() + Number(maxAge[1]) * 1000 });
        return response;
      });
      inflight.set(key, pending);
      const same = pending;
      void pending.finally(() => { if (inflight.get(key) === same) inflight.delete(key); }).catch(() => {});
    }
    return withStatus(await pending, "MISS");
  });
  const purgeTrack = vi.fn(async (trackId: string) => {
    for (const key of entries.keys()) if (key.startsWith(trackCachePrefix(trackId))) entries.delete(key);
  });
  const binding: OriginBinding = { fetch, purgeTrack };
  const worker = createWorker(service, undefined, { origin: () => binding });
  return { env, worker, entries, fetch, purgeTrack, points,
    call: (req = request(), value = env) => worker.fetch!(req as Request<unknown, IncomingRequestCfProperties>, value, ctx) as Promise<Response> };
}
function successfulService() {
  return { getLyrics: vi.fn<LyricsService["getLyrics"]>(async (_id, _token, _metadata, _client, context) => {
    context!.diagnostics!.attempts.push({ provider: "lrc.red", stage: "syllable", startedAt: new Date().toISOString(),
      durationMs: 1, outcome: "success", lyricsType: "Syllable", selected: true, retries: 0, upstream: [],
      source: lyrics.Source! });
    return structuredClone({ ...lyrics, RequestId: "OLD_REQUEST_SECRET", RetrievedAt: "old", LyricsHash: "old" });
  }) };
}
function queryLogs(): Array<Record<string, any>> {
  return vi.mocked(console.log).mock.calls.map(call => JSON.parse(String(call[0]))).filter(value => value.event === "lyrics-query");
}

describe("Workers Cache content and request boundary", () => {
  it("shares cache across users, gives each response a new ID, and logs a hit without re-counting providers", async () => {
    const service = successfulService(), fixture = cacheFixture(service);
    const firstResponse = await fixture.call();
    const first = await firstResponse.json() as BeautifulLyrics;
    const secondResponse = await fixture.call(request({}, { ...otherAuth.headers, "X-Spotify-App-Version": "another-client" }));
    const second = await secondResponse.json() as BeautifulLyrics;
    await drain();
    expect(firstResponse.headers.get("X-Lyrics-Cache")).toBe("miss");
    expect(secondResponse.headers.get("X-Lyrics-Cache")).toBe("hit");
    expect(service.getLyrics).toHaveBeenCalledTimes(1);
    expect(second.RequestId).not.toBe(first.RequestId);
    expect(second.LyricsHash).toBe(first.LyricsHash);
    expect(secondResponse.headers.get("Cache-Control")).toBe("private, no-store");
    expect(secondResponse.headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
    const logs = queryLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0]!.message).toMatch(/\| ✅ \| 来源：lrc.red \| 逐字 \| \d+ms$/);
    expect(logs[0]!.message).not.toContain("命中缓存");
    expect(logs[1]!.message).toMatch(/\| ✅ \| 命中缓存 \| 来源：lrc.red \| 逐字 \| \d+ms$/);
    expect(logs[1]!.requestId).toBe(second.RequestId);
    expect(logs[1]!.originRunId).toBe(logs[0]!.originRunId);
    expect(logs[1]!.queries).toEqual([]);
    expect(JSON.stringify(logs)).not.toMatch(/LYRIC_BODY_SECRET|OLD_REQUEST_SECRET|OTHER_TOKEN/);
    const points = fixture.points.mock.calls.map(call => call[0] as AnalyticsEngineDataPoint);
    expect(points.filter(point => point.indexes?.[0] === "server:request")).toHaveLength(2);
    expect(points.filter(point => String(point.indexes?.[0]).startsWith("provider:"))).toHaveLength(1);
    const record = await loadDiagnostics(db, second.RequestId!);
    expect(record).toMatchObject({ cache: "hit", attempts: [], originStatus: "available" });
    expect(record?.origin?.attempts).toHaveLength(1);
    expect((await db.prepare("SELECT name FROM sqlite_master WHERE name='lyrics_cache'").all()).results).toEqual([]);
  });

  it("keeps provenance, credentials and generated attribution rows out of the cache", async () => {
    const service = successfulService(), fixture = cacheFixture(service);
    for (let index = 0; index < 2; index++) {
      const body = await (await fixture.call()).json() as BeautifulLyrics;
      expect(body.Type).toBe("Syllable");
      if (body.Type !== "Syllable") throw Error("Wrong lyric type");
      expect(body.Content).toHaveLength(2);
      expect(body.Content[1]).toMatchObject({ IsAttribution: true,
        Lead: { StartTime: 99.9, EndTime: 100, Syllables: [expect.objectContaining({ Text: "Lyrics via lrc.red" })] } });
    }
    const stored = [...fixture.entries.values()][0]!;
    const envelope = await stored.response.clone().json() as OriginEnvelope;
    expect(envelope.lyrics).toMatchObject({ Content: lyrics.Type === "Syllable" ? lyrics.Content : [], Attribution: lyrics.Attribution });
    expect(envelope.expiresAt! - envelope.generatedAt).toBe(30 * 86_400_000);
    expect(stored.response.headers.get("Cache-Control")).toBe("public, max-age=2592000, must-revalidate");
    expect(JSON.stringify(envelope)).not.toMatch(/RequestId|RetrievedAt|LyricsHash|triggerRequestId|OLD_REQUEST_SECRET/);
    expect(JSON.stringify(envelope)).not.toContain(auth.session.token);
    expect(service.getLyrics.mock.results).toHaveLength(1);
  });

  it("canonicalizes metadata and policy while separating Apple Music and duration variants", async () => {
    const blocks = [{ provider: "qqmusic", lyricsType: "Line" as const }, { provider: "netease", lyricsType: "Syllable" as const }];
    const first = await cacheIdentity("track", metadata, blocks);
    const same = await cacheIdentity("track", { ...metadata, name: " 成都 " }, [...blocks].reverse().concat(blocks[0]!));
    expect(first.identity).toEqual(same.identity);
    expect((await cacheIdentity("track", { ...metadata, appleMusicId: "123", appleMusicTitle: "成都" }, blocks)).identity.metadataHash)
      .not.toBe(first.identity.metadataHash);
    const fixture = cacheFixture(successfulService());
    for (const extra of [{}, { apple_id: "123", apple_title: "成都" }, { duration: "101" }]) await fixture.call(request(extra));
    expect(fixture.entries.size).toBe(3);
    expect(fixture.fetch).toHaveBeenCalledTimes(3);
  });

  it("constructs a private UTF-8 context without inheriting browser cache/auth directives", async () => {
    const fixture = cacheFixture(successfulService());
    await fixture.call(request({}, { ...auth.headers, "Cache-Control": "no-store", Cookie: "PRIVATE_COOKIE",
      "If-None-Match": "private-etag", "X-Forwarded-Host": "attacker.invalid" }));
    const internal = fixture.fetch.mock.calls[0]![0];
    expect(internal.url).toMatch(/\/lyrics-body\/v1\/track\/[a-f0-9]{64}\/[a-f0-9]{64}$/);
    for (const header of ["Authorization", "X-Lyrics-Session", "Cookie", "Cache-Control", "If-None-Match", "X-Forwarded-Host"]) {
      expect(internal.headers.has(header)).toBe(false);
    }
    expect(await readOriginRequest(internal)).toMatchObject({ metadata, accessToken: "token" });
  });

  it("changes the key after moderation and queries an allowed alternative", async () => {
    const service = successfulService(), fixture = cacheFixture(service);
    await fixture.call();
    await putSourceBlock(db, { spotifyId: "track", provider: "lrc.red", lyricsType: "Syllable", enabled: true, reason: "wrong timing" });
    service.getLyrics.mockImplementation(async (_id, _token, _metadata, _client, context) => {
      expect(context?.sourceBlocks).toEqual([{ provider: "lrc.red", lyricsType: "Syllable" }]);
      return { Type: "Static", Lines: [{ Text: "alternative" }], Source: { Provider: "lrclib", Transport: "direct" } };
    });
    const response = await fixture.call();
    expect(await response.json()).toMatchObject({ Source: { Provider: "lrclib" }, Type: "Static" });
    expect(response.headers.get("X-Lyrics-Cache")).toBe("miss");
    expect(service.getLyrics).toHaveBeenCalledTimes(2);
    expect(new URL(fixture.fetch.mock.calls[0]![0].url).pathname).not.toBe(new URL(fixture.fetch.mock.calls[1]![0].url).pathname);
  });

  it("does not use a warmed cache when authorization, rate limits or policy checks fail", async () => {
    const fixture = cacheFixture(successfulService());
    await fixture.call();
    expect((await fixture.call(request({}, {}))).status).toBe(401);
    const limited = { ...fixture.env, LYRICS_TOKEN_LIMITER: { limit: async () => ({ success: false }) } as RateLimit };
    expect((await fixture.call(request(), limited)).status).toBe(429);
    const { FEEDBACK_DB: _db, ...withoutPolicy } = fixture.env;
    const missing = await fixture.call(request(), withoutPolicy);
    expect(missing.status).toBe(503);
    expect(missing.headers.get("Retry-After")).toBe("5");
    expect(await missing.json()).toMatchObject({ code: "source_policy_unavailable" });
    const broken = { ...fixture.env, FEEDBACK_DB: { prepare: () => { throw Error("PRIVATE_DB_ERROR"); } } as unknown as D1Database };
    expect((await fixture.call(request(), broken)).status).toBe(503);
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
    expect(queryLogs()).toHaveLength(1);
  });

  it.each(["none", "failed"] as const)("does not cache or retry a normal %s origin result", async outcome => {
    const service = { getLyrics: vi.fn(async () => { if (outcome === "failed") throw Error("UPSTREAM_SECRET"); return undefined; }) };
    const fixture = cacheFixture(service);
    for (let index = 0; index < 2; index++) {
      const response = await fixture.call();
      expect(response.status).toBe(outcome === "none" ? 200 : 502);
      if (outcome === "none") expect(await response.text()).toBe("");
    }
    expect(service.getLyrics).toHaveBeenCalledTimes(2);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    expect(fixture.entries.size).toBe(0);
    expect(queryLogs()).toHaveLength(2);
    expect(queryLogs()[0]!.message).toContain(outcome === "none" ? "| ❌ |" : "| 查询失败 |");
    expect(JSON.stringify(queryLogs())).not.toMatch(/未命中缓存|未找到歌词|UPSTREAM_SECRET/);
  });

  it.each(["expired", "hash", "policy", "provenance", "empty"] as const)("rejects %s cached content and recovers once without a hit log", async fault => {
    const service = successfulService(), fixture = cacheFixture(service);
    await fixture.call();
    const cached = [...fixture.entries.values()][0]!;
    const entry = await cached.response.clone().json() as OriginEnvelope;
    if (fault === "expired") { entry.generatedAt -= 31 * 86_400_000; entry.expiresAt! -= 31 * 86_400_000; }
    if (fault === "hash") entry.lyricsHash = "0".repeat(64);
    if (fault === "policy") entry.policyHash = "0".repeat(64);
    if (fault === "provenance") entry.lyrics!.RequestId = "replayed";
    if (fault === "empty") { entry.outcome = "none"; delete entry.lyrics; delete entry.lyricsHash; delete entry.expiresAt; }
    cached.response = Response.json(entry);
    cached.until = Infinity;
    const response = await fixture.call();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Lyrics-Cache")).toBe("bypass");
    expect(fixture.fetch).toHaveBeenCalledTimes(3);
    expect(fixture.fetch.mock.calls[2]?.[1]).toEqual({ cache: "no-store" });
    expect(fixture.purgeTrack).toHaveBeenCalledExactlyOnceWith("track");
    expect(service.getLyrics).toHaveBeenCalledTimes(2);
    expect(queryLogs()).toHaveLength(2);
    expect(queryLogs().every(log => !log.message.includes("命中缓存"))).toBe(true);
  });

  it("bounds cache infrastructure recovery to one attempt and keeps the original deadline", async () => {
    const fixture = cacheFixture(successfulService());
    fixture.fetch.mockRejectedValueOnce(Error("cache unavailable"));
    const response = await fixture.call();
    expect(response.status).toBe(200);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    const first = await readOriginRequest(fixture.fetch.mock.calls[0]![0]);
    const second = await readOriginRequest(fixture.fetch.mock.calls[1]![0]);
    expect(second.deadline).toBe(first.deadline);
    expect(second.triggerRequestId).toBe(first.triggerRequestId);
    fixture.fetch.mockRejectedValue(Error("cache still unavailable"));
    expect((await fixture.call()).status).toBe(502);
    expect(fixture.fetch).toHaveBeenCalledTimes(4);
  });

  it("uses no-store on every internal call when caching is switched off", async () => {
    const service = successfulService(), fixture = cacheFixture(service, { LYRICS_CACHE_MODE: "off" });
    for (let index = 0; index < 2; index++) expect((await fixture.call()).headers.get("X-Lyrics-Cache")).toBe("bypass");
    expect(service.getLyrics).toHaveBeenCalledTimes(2);
    expect(fixture.entries.size).toBe(0);
    expect(fixture.fetch.mock.calls.every(call => call[1]?.cache === "no-store")).toBe(true);
  });

  it("collapses simultaneous fills without duplicating origin logs or provider statistics", async () => {
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const service = successfulService();
    const original = service.getLyrics.getMockImplementation()!;
    service.getLyrics.mockImplementation(async (...args) => { await hold; return original(...args); });
    const fixture = cacheFixture(service);
    const pending = Array.from({ length: 5 }, () => fixture.call());
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledTimes(5));
    release();
    const bodies = await Promise.all((await Promise.all(pending)).map(response => response.json() as Promise<BeautifulLyrics>));
    await drain();
    expect(new Set(bodies.map(body => body.RequestId)).size).toBe(5);
    expect(service.getLyrics).toHaveBeenCalledTimes(1);
    expect(queryLogs()).toHaveLength(1);
    expect((await db.prepare("SELECT count(*) AS n FROM lyric_requests").first<{ n: number }>())?.n).toBe(5);
    expect((await db.prepare("SELECT count(*) AS n FROM lyric_origin_runs").first<{ n: number }>())?.n).toBe(1);
    expect(fixture.points.mock.calls.filter(call => String(call[0].indexes?.[0]).startsWith("provider:"))).toHaveLength(1);
  });

  it("keeps a shared fill alive after its first caller cancels", async () => {
    let release!: () => void, sourceSignal: AbortSignal | undefined;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const service = { getLyrics: vi.fn<LyricsService["getLyrics"]>(async (_id, _token, _meta, _client, context) => {
      sourceSignal = context?.signal; await hold; return structuredClone(lyrics);
    }) };
    const fixture = cacheFixture(service), controller = new AbortController();
    const first = fixture.call(request({}, auth.headers, controller.signal));
    const second = fixture.call();
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledTimes(2));
    controller.abort();
    expect(await (await first).text()).toBe("");
    expect(sourceSignal?.aborted).toBe(false);
    release();
    expect((await second).status).toBe(200);
    expect(service.getLyrics).toHaveBeenCalledTimes(1);
    await drain();
    expect((await db.prepare("SELECT count(*) AS n FROM lyric_requests WHERE outcome='cancelled'").first<{ n: number }>())?.n).toBe(1);
  });

  it("bounds a non-cooperative provider to the remaining origin budget", async () => {
    const context = await cacheIdentity("track", metadata, []);
    const internal = createOriginRequest(context.identity, { metadata, sourceBlocks: [], deadline: Date.now() + 40,
      triggerRequestId: crypto.randomUUID() }, "token");
    const origin = createLyricsOrigin({ getLyrics: async () => new Promise(() => {}) });
    const response = await origin(internal, { FEEDBACK_DB: db }, ctx);
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([false, true])("preserves full provider stage budgets and the final fallback (static=%s)", async staticFallback => {
    const hang = () => new Promise<undefined>(() => {});
    const timed = { getSyllableLyrics: vi.fn(hang), getLineLyrics: vi.fn(hang) };
    const service = createLyricsService({
      spotify: { getTrackMetadata: async () => metadata, getLyrics: hang },
      qqmusic: timed, kugou: timed, netease: timed, 
      spicylyrics: { getLyrics: async () => undefined },
      applemusic: { getLyrics: async () => undefined },
      lrcred: { getLyrics: async () => undefined },
      lrclib: { getLyrics: async () => staticFallback
        ? { Type: "Static", Lines: [{ Text: "fallback after a complete search" }], Source: { Provider: "lrclib", Transport: "direct" } }
        : undefined }
    });
    const fixture = cacheFixture(service, { FEEDBACK_DB: auth.env.FEEDBACK_DB });
    const dispatch = fixture.fetch.getMockImplementation()!;
    fixture.fetch.mockImplementationOnce(async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return dispatch(...args);
    });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const pending = fixture.call();
      await vi.waitFor(() => expect(timed.getSyllableLyrics).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(25_000);
      const response = await pending;
      expect(response.status).toBe(200);
      if (staticFallback) expect(await response.json()).toMatchObject({ Type: "Static", Source: { Provider: "lrclib" } });
      else expect(await response.text()).toBe("");
      const log = queryLogs()[0]!;
      expect(log.outcome).toBe(staticFallback ? "success" : "none");
      expect(log.queries).toEqual(expect.arrayContaining([
        expect.objectContaining({ stage: "syllable", outcome: "timeout", durationMs: 15_000 }),
        expect.objectContaining({ stage: "line", outcome: "timeout", durationMs: 10_000 })
      ]));
    } finally { vi.useRealTimers(); }
  });

  it("does not expose the internal entrypoint over public HTTP", async () => {
    const fixture = cacheFixture(successfulService());
    const identity = (await cacheIdentity("track", metadata, [])).identity;
    const response = await fixture.call(new Request("https://lyrics.test" + cachePath(identity), { headers: auth.headers }));
    expect(response.status).toBe(404);
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("keeps the configured freshness limits by lyric type", () => {
    expect(cacheTtlMs("Syllable")).toBe(30 * 86_400_000);
    expect(cacheTtlMs("Line")).toBe(14 * 86_400_000);
    expect(cacheTtlMs("Static")).toBe(3 * 86_400_000);
  });
});
