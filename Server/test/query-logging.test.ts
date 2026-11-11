import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorker } from "../src/index";
import { createLyricsService } from "../src/service";
import { logLyricsQuery } from "../src/diagnostics";
import { createQqMusicProvider } from "../src/providers/qqmusic";
import { createKugouProvider } from "../src/providers/kugou";
import { createNeteaseProvider } from "../src/providers/netease";
import { createSpotifyProvider } from "../src/providers/spotify";
import { createLrclibProvider } from "../src/providers/lrclib";
import { createSpicyLyricsProvider, setSpicyLyricsApiKey } from "../src/providers/spicylyrics";
import type { ProviderAttempt, ProviderClients, RequestDiagnostics } from "../src/types";
import { lyricsAuthFixture } from "./lyrics-auth-fixture";

const auth = await lyricsAuthFixture();
const track = { id: "track", name: "Song", artists: ["Artist"] };
const qqKey = "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo";

function providers(qqLyric?: string): ProviderClients {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    switch (url.hostname) {
      case "api.spicylyrics.org": return new Response("UPSTREAM_SECRET", { status: 403 });
      case "u.y.qq.com": {
        const body = JSON.parse(String(init?.body));
        return Response.json(body.req ? { code: 0, req: { code: 0, data: { body: { song: { list: [
          { id: 123, title: track.name, singer: [{ name: track.artists[0] }] }
        ] } } } } } : { code: 0, [qqKey]: { code: qqLyric ? 0 : 24001,
          data: { qrc: 0, lyric: qqLyric ?? "" }, debug: "UPSTREAM_SECRET" } });
      }
      case "krcs.kugou.com": return Response.json({ status: 200, candidates: [] });
      case "music.163.com": return Response.json(url.pathname.includes("search")
        ? { code: 200, result: { songs: [{ id: 456, name: track.name, artists: [{ name: "Artist" }] }] } }
        : { code: 200, lrc: { lyric: "metadata without timestamps" } });
      case "spclient.wg.spotify.com": return new Response("UPSTREAM_SECRET", { status: 404 });
      case "lrclib.net": return Response.json([]);
      default: throw new Error("Unexpected upstream host");
    }
  }) as typeof fetch;
  return {
    spicylyrics: createSpicyLyricsProvider(fetchMock),
    qqmusic: createQqMusicProvider(fetchMock),
    kugou: createKugouProvider(fetchMock),
    netease: createNeteaseProvider(fetchMock),
    spotify: createSpotifyProvider(fetchMock),
    lrclib: createLrclibProvider(fetchMock)
  };
}

async function query(upstream: ProviderClients) {
  const worker = createWorker(createLyricsService(upstream));
  return worker.fetch!(new Request("https://lyrics.test/lyrics/track?track_name=Song&artist_name=Artist", {
    headers: { ...auth.headers }
  }), { ...auth.env, SPICY_LYRICS_KEY: "SPICY_SECRET" }, {} as ExecutionContext);
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { setSpicyLyricsApiKey(undefined); vi.restoreAllMocks(); });

describe("Worker lyrics query logs", () => {
  it.each([
    { result: { songCount: 0 }, expected: "no_results" },
    { result: {}, expected: "missing_song_list" }
  ])("does not invent an API error when NetEase omits its song list ($expected)", async ({ result, expected }) => {
    const trace: ProviderAttempt = { provider: "netease", stage: "line", startedAt: "test", durationMs: 0, outcome: "pending", retries: 0, upstream: [] };
    const fetchMock = vi.fn(async () => Response.json({ code: 200, result }));
    expect(await createNeteaseProvider(fetchMock).getLineLyrics(track, { trace })).toBeUndefined();
    expect(trace.upstream[0]).toMatchObject({ status: 200, codes: { code: 200 }, outcome: "success", result: expected });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([createQqMusicProvider, createKugouProvider, createNeteaseProvider])("records a malformed JSON search response as a failure (%#)", async create => {
    const trace: ProviderAttempt = { provider: "test", stage: "line", startedAt: "test", durationMs: 0, outcome: "pending", retries: 0, upstream: [] };
    const fetchMock = vi.fn(async () => Response.json(null));
    expect(await create(fetchMock).getLineLyrics(track, { trace })).toBeUndefined();
    expect(trace.upstream).toHaveLength(1);
    expect(trace.upstream[0]).toMatchObject({ status: 200, outcome: "failed", result: "invalid_payload" });
    expect(console.log).not.toHaveBeenCalled();
  });

  it("prints every source in one settled summary and distinguishes empty results from HTTP and business errors", async () => {
    const response = await query(providers());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
    const text = vi.mocked(console.log).mock.calls[0]![0] as string;
    const record = JSON.parse(text);
    expect(record).toMatchObject({
      event: "lyrics-query", level: "info", track, outcome: "none",
      message: expect.stringMatching(/^\[lyrics-query\] Song — Artist \| 未找到歌词 \| 来源：无 \| \d+ms$/)
    });
    expect(record.queries).toHaveLength(9);
    expect(record.queries).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "spicylyrics", outcome: "failed", requests: [expect.objectContaining({ status: 403, result: "http_error" })] }),
      expect.objectContaining({ provider: "qqmusic", stage: "line", outcome: "failed", matches: [{ id: "123", title: "Song" }], requests: [
        expect.objectContaining({ operation: "search", query: "Song", resultCount: 1, matchedCount: 1 }),
        expect.objectContaining({ operation: "lyrics", status: 200, codes: { code: 0, lyric: 24001 }, result: "api_error" })
      ] }),
      expect.objectContaining({ provider: "kugou", outcome: "none", found: false, requests: [expect.objectContaining({ result: "no_results", resultCount: 0 })] }),
      expect.objectContaining({ provider: "netease", stage: "line", outcome: "none", requests: [expect.anything(), expect.objectContaining({ result: "no_line_lyrics" })] }),
      expect.objectContaining({ provider: "spotify", outcome: "failed", requests: [expect.objectContaining({ status: 404, result: "http_error" })] }),
      expect.objectContaining({ provider: "lrclib", outcome: "none", found: false, requests: [expect.objectContaining({ result: "no_results" })] })
    ]));
    for (const attempt of record.queries) expect(attempt.outcome).not.toBe("pending");
    for (const secret of ["SPICY_SECRET", "UPSTREAM_SECRET", auth.headers["X-Lyrics-Session"]]) {
      if (secret) expect(text).not.toContain(secret);
    }
  });

  it("includes the chosen source and lyric type without printing the lyric body", async () => {
    const response = await query(providers(Buffer.from("[00:01.00]LYRIC_BODY_SECRET", "utf8").toString("base64")));
    expect((await response.json() as { Type: string }).Type).toBe("Line");
    expect(console.log).toHaveBeenCalledTimes(1);
    const text = vi.mocked(console.log).mock.calls[0]![0] as string;
    const record = JSON.parse(text);
    expect(record).toMatchObject({
      outcome: "success", level: "info", provider: "qqmusic", lyricsType: "Line",
      message: expect.stringMatching(/^\[lyrics-query\] Song — Artist \| 已找到歌词 \| 来源：qqmusic \| 逐行 \| \d+ms$/)
    });
    expect(record.queries).toContainEqual(expect.objectContaining({ provider: "qqmusic", stage: "line", selected: true, found: true }));
    expect(text).not.toContain("LYRIC_BODY_SECRET");
  });

  it("does not print preflights, stats, telemetry, policy reads, or rejected requests", async () => {
    const getLyrics = vi.fn();
    const worker = createWorker({ getLyrics });
    for (const path of ["/", "/stats", "/metrics", "/lyrics-policy/7wsIu8lWXBZ5g6iGidf3QL", "/missing", "/lyrics/track"]) {
      await worker.fetch!(new Request(`https://lyrics.test${path}`), auth.env, {} as ExecutionContext);
    }
    await worker.fetch!(new Request("https://lyrics.test/lyrics/track", { method: "OPTIONS" }), auth.env, {} as ExecutionContext);
    expect(getLyrics).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("does not report cancelled or timed-out searches as confirmed misses", () => {
    const record: RequestDiagnostics = { id: "test", track, startedAt: "test", durationMs: 10, outcome: "none", attempts: [
      { provider: "qq music", stage: "syllable", startedAt: "test", durationMs: 10, outcome: "cancelled", retries: 0, upstream: [] },
      { provider: "kugou direct", stage: "line", startedAt: "test", durationMs: 10, outcome: "timeout", retries: 2, upstream: [] }
    ] };
    logLyricsQuery(record);
    const queries = JSON.parse(vi.mocked(console.log).mock.calls[0]![0] as string).queries;
    expect(queries[0]).toMatchObject({ outcome: "cancelled" });
    expect(queries[1]).toMatchObject({ outcome: "timeout", retries: 2 });
    for (const attempt of queries) expect(attempt).not.toHaveProperty("found");
  });
});
