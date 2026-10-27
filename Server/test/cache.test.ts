import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheTtlMs, createLyricsCache } from "../src/cache";
import { createWorker, type WorkerEnv } from "../src/index";
import type { BeautifulLyrics, SourceBlock } from "../src/types";

let mf: Miniflare;
let db: D1Database;

const syllable: BeautifulLyrics = {
  Type: "Syllable",
  StartTime: 0,
  EndTime: 2,
  Content: [{
    Type: "Vocal",
    OppositeAligned: false,
    Lead: {
      StartTime: 0,
      EndTime: 2,
      Syllables: [{ Text: "hallo", StartTime: 0, EndTime: 1, IsPartOfWord: false }]
    }
  }],
  Source: { Provider: "qqmusic", Transport: "direct", TrackId: "song-1" }
};

function stored(): BeautifulLyrics {
  return structuredClone({ ...syllable, RequestId: "request-1", RetrievedAt: "2026-01-01T00:00:00.000Z", LyricsHash: "abc" });
}

async function countRows(trackId: string): Promise<number> {
  const row = await db.prepare("SELECT count(*) AS n FROM lyrics_cache WHERE spotify_id=?").bind(trackId).first<{ n: number }>();
  return row?.n ?? 0;
}

beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: ["FEEDBACK_DB"], compatibilityDate: "2026-05-22" });
  db = await mf.getD1Database("FEEDBACK_DB") as unknown as D1Database;
  for (const file of (await readdir("migrations")).filter(file => file.endsWith(".sql")).sort()) {
    const migration = await readFile("migrations/" + file, "utf8");
    await db.exec(migration.replace(/^\s*--.*$/gm, "").replace(/\n/g, " "));
  }
}, 20000);

afterAll(async () => { await mf?.dispose(); });

beforeEach(async () => {
  await db.prepare("DELETE FROM lyrics_cache").run();
});

describe("lyrics cache storage", () => {
  it("is inert without a database binding", async () => {
    const cache = createLyricsCache(undefined);
    await cache.put("track", stored());
    expect(await cache.get("track", [])).toBeUndefined();
  });

  it("returns the stored content and drops request-scoped fields", async () => {
    const cache = createLyricsCache(db);
    await cache.put("track", stored());

    const hit = await cache.get("track", []);
    expect(hit).toMatchObject({ Type: "Syllable" });
    expect(hit).not.toHaveProperty("RequestId");
    expect(hit).not.toHaveProperty("RetrievedAt");
    expect(hit).not.toHaveProperty("LyricsHash");
    expect(hit?.Source).toMatchObject({ Provider: "qqmusic", Transport: "direct" });
  });

  it("refuses to store a result without a provider", async () => {
    const cache = createLyricsCache(db);
    const { Source: _source, ...anonymous } = stored();
    await cache.put("track", anonymous as BeautifulLyrics);
    expect(await cache.get("track", [])).toBeUndefined();
  });

  it("ignores expired rows", async () => {
    const cache = createLyricsCache(db);
    await cache.put("track", stored());
    await db.prepare("UPDATE lyrics_cache SET expires_at=? WHERE spotify_id=?").bind(Date.now() - 1, "track").run();
    expect(await cache.get("track", [])).toBeUndefined();
  });

  it("purges a corrupt row instead of failing the request", async () => {
    const cache = createLyricsCache(db);
    await cache.put("track", stored());
    await db.prepare("UPDATE lyrics_cache SET data=? WHERE spotify_id=?").bind("{not json", "track").run();

    expect(await cache.get("track", [])).toBeUndefined();
    expect(await countRows("track")).toBe(0);
  });
});

describe("moderation wins over cache", () => {
  it("treats a blocked provider row as a miss and deletes it", async () => {
    const cache = createLyricsCache(db);
    await cache.put("track", stored());
    const blocks: SourceBlock[] = [{ provider: "qqmusic", lyricsType: "Syllable" }];

    expect(await cache.get("track", blocks)).toBeUndefined();
    expect(await countRows("track")).toBe(0);
  });

  it("keeps rows whose provider is not blocked", async () => {
    const cache = createLyricsCache(db);
    await cache.put("track", stored());
    const blocks: SourceBlock[] = [{ provider: "kugou", lyricsType: "Syllable" }];

    expect(await cache.get("track", blocks)).toMatchObject({ Type: "Syllable" });
    expect(await countRows("track")).toBe(1);
  });

  it("only blocks the matching quality tier", async () => {
    const cache = createLyricsCache(db);
    await cache.put("track", stored());
    const blocks: SourceBlock[] = [{ provider: "qqmusic", lyricsType: "Static" }];

    expect(await cache.get("track", blocks)).toMatchObject({ Type: "Syllable" });
  });
});

describe("cache lifetime", () => {
  it("favours official karaoke rows over community text", () => {
    expect(cacheTtlMs("Syllable")).toBe(30 * 86_400_000);
    expect(cacheTtlMs("Line")).toBe(14 * 86_400_000);
    expect(cacheTtlMs("Static")).toBe(3 * 86_400_000);
  });

  it("stamps the expiry from the quality tier", async () => {
    const cache = createLyricsCache(db);
    const before = Date.now();
    await cache.put("track", stored());
    const row = await db.prepare("SELECT expires_at,stored_at FROM lyrics_cache WHERE spotify_id=?").bind("track").first<{ expires_at: number; stored_at: number }>();

    expect(row!.stored_at).toBeGreaterThanOrEqual(before);
    expect(row!.expires_at - row!.stored_at).toBe(cacheTtlMs("Syllable"));
  });
});

describe("worker route integration", () => {
  const env = () => ({ FEEDBACK_DB: db } as unknown as WorkerEnv);
  const context = {} as ExecutionContext;
  const request = () => new Request("https://lyrics.test/lyrics/track", { headers: { Authorization: "Bearer token" } }) as unknown as Request<unknown, IncomingRequestCfProperties>;

  async function json(response: Response | undefined): Promise<Record<string, unknown>> {
    expect(response).toBeDefined();
    if (response === undefined) throw new Error("Worker fetch handler is missing");
    expect(response.status).toBe(200);
    return await response.json() as Record<string, unknown>;
  }

  it("answers the second request from cache without touching providers", async () => {
    const getLyrics = vi.fn().mockImplementation(async () => stored());
    const worker = createWorker({ getLyrics });

    const first = await json(await worker.fetch!(request(), env(), context) as Response);
    expect(getLyrics).toHaveBeenCalledTimes(1);
    expect(first.Type).toBe("Syllable");

    const second = await json(await worker.fetch!(request(), env(), context) as Response);
    expect(getLyrics).toHaveBeenCalledTimes(1);
    expect(second.RequestId).not.toBe(first.RequestId);
    expect(second.LyricsHash).toBe(first.LyricsHash);
  });

  it("does not store a miss", async () => {
    const worker = createWorker({ getLyrics: vi.fn().mockResolvedValue(undefined) });
    const response = await worker.fetch!(request(), env(), context) as Response;

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(await countRows("track")).toBe(0);
  });

  it("falls back to providers when the stored row is moderated away", async () => {
    const cache = createLyricsCache(db);
    await cache.put("track", stored());
    await db.prepare(`INSERT INTO source_blocks(id,spotify_id,provider,lyrics_type,enabled,reason,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind("block-1", "track", "qqmusic", "Syllable", 1, "test", new Date().toISOString(), new Date().toISOString()).run();

    const replacement = structuredClone({ ...syllable, Source: { Provider: "kugou", Transport: "direct" as const } });
    const getLyrics = vi.fn().mockResolvedValue(replacement);
    const worker = createWorker({ getLyrics });

    const body = await json(await worker.fetch!(request(), env(), context) as Response);
    expect(getLyrics).toHaveBeenCalledTimes(1);
    expect(body.Source).toMatchObject({ Provider: "kugou" });
    await db.prepare("DELETE FROM source_blocks").run();
  });

  it("still serves lyrics when the cache read throws", async () => {
    const broken = { prepare: () => { throw new Error("D1 unavailable"); } } as unknown as D1Database;
    const getLyrics = vi.fn().mockResolvedValue(stored());
    const worker = createWorker({ getLyrics });

    const body = await json(await worker.fetch!(request(), { FEEDBACK_DB: broken } as unknown as WorkerEnv, context) as Response);
    expect(body.Type).toBe("Syllable");
    expect(getLyrics).toHaveBeenCalledTimes(1);
  });
});
