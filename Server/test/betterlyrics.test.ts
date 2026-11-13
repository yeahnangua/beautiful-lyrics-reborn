import { afterEach, describe, expect, it, vi } from "vitest";
import { createBetterLyricsProvider } from "../src/providers/betterlyrics";
import type { ProviderAttempt, TrackMetadata } from "../src/types";

const track: TrackMetadata = {
  id: "spotify-id", name: "Test Song", artists: ["Test Artist", "Guest"], album: "Test Album", durationSeconds: 180.5
};
const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
  <body><div><p begin="10s" end="13s"><span begin="10s" end="10.3s">Hel</span><span begin="10.3s" end="10.7s">lo</span> <span begin="11s" end="12s">world</span>
  <span ttm:role="x-bg" begin="11s" end="13s"><span begin="11s" end="13s">echo</span></span></p></div></body>
</tt>`;
// QRC places text before its absolute millisecond timing token inside an XML attribute.
const qrc = `<QrcInfos><LyricInfo><Lyric_1 LyricType="1" LyricContent="[ti:Test Song]
[10000,2000]Hel(10000,300)lo(10300,400) (10700,0)world&amp;you(11000,1000)
[20000,1000]Next (20000,300)line(20400,600)
"/></LyricInfo></QrcInfos>`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" }
});
const trace = (): ProviderAttempt => ({
  provider: "betterlyrics", stage: "syllable", startedAt: "test", durationMs: 0, outcome: "pending", retries: 0, upstream: []
});
afterEach(() => vi.useRealTimers());

describe("Better Lyrics public provider", () => {
  it("preserves TTML word boundaries, timing and background vocals, with provider credits", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ ttml }));
    const attempt = trace();
    const lyrics = await createBetterLyricsProvider(fetchMock as typeof fetch).getLyrics(track, { trace: attempt });
    expect(lyrics?.Type).toBe("Syllable");
    if (lyrics?.Type !== "Syllable") throw new Error("Expected syllables");
    expect(lyrics.Source).toEqual({ Provider: "betterlyrics", Transport: "direct" });
    expect(lyrics.Attribution).toEqual({ provider: "betterlyrics", source: "betterlyrics" });
    expect(lyrics.Content[0]).toMatchObject({
      Lead: { StartTime: 10, EndTime: 12, Syllables: [
        { Text: "Hel", StartTime: 10, EndTime: 10.3, IsPartOfWord: true },
        { Text: "lo", StartTime: 10.3, EndTime: 10.7, IsPartOfWord: false },
        { Text: "world", StartTime: 11, EndTime: 12, IsPartOfWord: false }
      ] }, Background: [{ StartTime: 11, EndTime: 13, Syllables: [{ Text: "echo" }] }]
    });
    expect(attempt.upstream).toEqual([expect.objectContaining({
      endpoint: "api.betterlyrics.org/getLyrics", status: 200, operation: "lyrics", result: "found", resultCount: 1
    })]);
    const [input, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(input);
    expect(url.searchParams.get("s")).toBe("Test Song");
    expect(url.searchParams.get("a")).toBe("Test Artist");
    expect(url.searchParams.get("al")).toBe("Test Album");
    expect(url.searchParams.get("d")).toBe("181");
    expect(url.searchParams.has("token")).toBe(false);
    expect(init.method).toBe("GET");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(headers.has("X-API-Key")).toBe(false);
    expect(headers.get("User-Agent")).toBe("Mozilla/5.0 (X11; Linux x86_64; rv:160.0) Gecko/20100101 Firefox/160.0");
    expect(headers.get("X-User-Agent")).toBe("beautiful-lyrics-reborn");
    expect(headers.get("Accept-Language")).toBe("zh-CN,en-US;q=0.9,en;q=0.8");
    expect(headers.has("Host")).toBe(false);
    expect(headers.has("Connection")).toBe(false);
    expect(headers.has("Accept-Encoding")).toBe(false);
  });

  it("parses the QQ XML envelope with absolute times, gaps, entities and zero-duration spaces", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ lyrics: qrc, provider: "qq" }));
    const lyrics = await createBetterLyricsProvider(fetchMock as typeof fetch).getQqLyrics(track);
    expect(lyrics).toMatchObject({ Type: "Syllable", StartTime: 10, EndTime: 21,
      Source: { Provider: "betterlyrics-qq", Transport: "direct" }, Content: [
        { Lead: { StartTime: 10, EndTime: 12, Syllables: [
          { Text: "Hel", StartTime: 10, EndTime: 10.3, IsPartOfWord: true },
          { Text: "lo", StartTime: 10.3, EndTime: 10.7, IsPartOfWord: false },
          { Text: "world&you", StartTime: 11, EndTime: 12, IsPartOfWord: false }
        ] } },
        { Lead: { StartTime: 20, EndTime: 21, Syllables: [
          { Text: "Next", StartTime: 20, EndTime: 20.3, IsPartOfWord: false },
          { Text: "line", StartTime: 20.4, EndTime: 21, IsPartOfWord: false }
        ] } }
      ]
    });
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe("/qq/getLyrics");
  });

  it("keeps KuGou line timing and uses song duration for the final line", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ lyrics: "[00:10.00]First line\n[00:20.25]Second line", provider: "kugou" }));
    const lyrics = await createBetterLyricsProvider(fetchMock as typeof fetch).getKugouLyrics(track);
    expect(lyrics).toMatchObject({ Type: "Line", StartTime: 10, EndTime: 180.5,
      Source: { Provider: "betterlyrics-kugou", Transport: "direct" }, Content: [
        { Text: "First line", StartTime: 10, EndTime: 20.25 },
        { Text: "Second line", StartTime: 20.25, EndTime: 180.5 }
      ]
    });
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe("/kugou/getLyrics");
  });

  it("accepts line-only TTML and QQ LRC without pretending they have word timing", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ttml: '<tt><body><p begin="1s" end="2s">Line only</p></body></tt>' }))
      .mockResolvedValueOnce(json({ lyrics: "[00:01.00]Line only", provider: "qq" }));
    const provider = createBetterLyricsProvider(fetchMock as typeof fetch);
    expect((await provider.getLyrics(track))?.Type).toBe("Line");
    expect((await provider.getQqLyrics(track))?.Type).toBe("Line");
  });

  it.each([401, 403, 404, 429, 503])("does not retry HTTP %s or interfere with the other endpoints", async status => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: "Unavailable" }, status))
      .mockResolvedValueOnce(json({ lyrics: "[00:01.00]Fallback", provider: "kugou" }));
    const provider = createBetterLyricsProvider(fetchMock as typeof fetch);
    const attempt = trace();
    expect(await provider.getLyrics(track, { trace: attempt })).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(attempt.upstream[0]?.result).toBe(status === 404 ? "no_lyrics" : "http_error");
    expect((await provider.getKugouLyrics(track))?.Type).toBe("Line");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(attempt.retries).toBe(0);
  });

  it.each([{ ttml: null }, { ttml: "" }, { ttml: "Invalid XML" }, { ttml: 42 }, {}, null])(
    "ignores absent or malformed lyrics (%j)", async payload => {
      const fetchMock = vi.fn<typeof fetch>(async () => json(payload));
      expect(await createBetterLyricsProvider(fetchMock as typeof fetch).getLyrics(track)).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it("ignores an HTML error page and untimed QQ or KuGou text", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("<html>Error</html>"))
      .mockResolvedValueOnce(json({ lyrics: "Unsynced text", provider: "qq" }))
      .mockResolvedValueOnce(json({ lyrics: "Unsynced text", provider: "kugou" }));
    const provider = createBetterLyricsProvider(fetchMock as typeof fetch);
    expect(await provider.getLyrics(track)).toBeUndefined();
    expect(await provider.getQqLyrics(track)).toBeUndefined();
    expect(await provider.getKugouLyrics(track)).toBeUndefined();
  });

  it("skips missing metadata and never sends an invalid duration", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ ttml }));
    const provider = createBetterLyricsProvider(fetchMock as typeof fetch);
    expect(await provider.getLyrics({ ...track, name: " " })).toBeUndefined();
    expect(await provider.getLyrics({ ...track, artists: [] })).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    for (const durationSeconds of [NaN, Infinity, 0, -10, 0.1]) {
      await provider.getLyrics({ ...track, durationSeconds });
      expect(new URL(String(fetchMock.mock.calls.at(-1)?.[0])).searchParams.has("d")).toBe(false);
    }
  });

  it("honors an already-cancelled parent without starting a request", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>(async () => json({ ttml }));
    const attempt = trace();
    await expect(createBetterLyricsProvider(fetchMock as typeof fetch).getLyrics(track, {
      signal: controller.signal, trace: attempt
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(attempt.upstream[0]?.outcome).toBe("cancelled");
  });

  it("bounds a non-cooperative fetch to the inherited deadline without retrying", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const attempt = trace();
    const outcome = createBetterLyricsProvider(fetchMock as typeof fetch).getQqLyrics(track, {
      deadline: Date.now() + 20, trace: attempt
    }).catch(error => error);
    await vi.advanceTimersByTimeAsync(21);
    expect(await outcome).toMatchObject({ name: "TimeoutError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(attempt.upstream[0]?.outcome).toBe("timeout");
    expect(attempt.retries).toBe(0);
  });
});
