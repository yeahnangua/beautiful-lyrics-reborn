import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnisonProvider } from "../src/providers/unison";
import type { ProviderAttempt, TrackMetadata } from "../src/types";

const spotifyId = "1234567890123456789012";
const keyId = "a".repeat(64);
const videoId = "Ugr4KKK_SqY";
const track: TrackMetadata = { id: spotifyId, name: "Song", artists: ["Artist"], album: "Album", durationSeconds: 180, isrc: "USABC2400001" };
const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>
  <p begin="1s" end="5s"><span begin="1s" end="2s">Hello</span> <span begin="2s" end="2.5s">be</span><span begin="2.5s" end="3s">au</span><span begin="3s" end="4s">tiful</span><span ttm:role="x-bg" begin="2s" end="5s"><span begin="2s" end="3s">back</span> <span begin="3s" end="5s">ground</span></span></p>
</div></body></tt>`;
const body = (overrides: Record<string, unknown> = {}) => ({
  id: 13529, videoId, song: "Song", artist: "Artist", album: "Album", isrc: track.isrc,
  lyrics: ttml, format: "ttml", syncType: "richsync", matchedBy: "isrc",
  submitter: { keyId, displayName: "Curator" }, ...overrides
});
const response = (overrides: Record<string, unknown> = {}, headers: HeadersInit = {}) =>
  Response.json({ success: true, data: body(overrides) }, { headers });
const trace = (): ProviderAttempt => ({ provider: "unison", stage: "syllable", startedAt: "test", durationMs: 0, outcome: "pending", retries: 0, upstream: [] });
const fetchMock = () => vi.fn<typeof fetch>();

afterEach(() => { vi.restoreAllMocks(); });

describe("Unison provider", () => {
  it("sends ISRC and track identifiers with metadata fallback in one public request", async () => {
    const fetchImpl = fetchMock().mockResolvedValue(response());
    const lyrics = await createUnisonProvider(fetchImpl).getLyrics({ ...track, isrc: "us-abc-24-00001", appleMusicId: "12345" });
    const [input, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe("https://unison.betterlyrics.org/lyrics");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      isrc: "USABC2400001", spotify: spotifyId, apple_music: "12345", song: "Song", artist: "Artist", album: "Album", duration: "180"
    });
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-Key-ID")).toBeNull();
    expect(headers.get("User-Agent")).toBe("Mozilla/5.0 (X11; Linux x86_64; rv:160.0) Gecko/20100101 Firefox/160.0");
    expect(headers.get("X-User-Agent")).toBe("beautiful-lyrics-reborn");
    expect(lyrics?.Source).toEqual({ Provider: "unison", Transport: "direct", TrackId: videoId, LyricsId: "13529", MatchedTitle: "Song" });
    expect(lyrics?.Attribution).toEqual({ provider: "unison", source: "unison", songId: videoId,
      submitter: { id: keyId, username: "Curator", url: `https://unison.betterlyrics.org/curator/${keyId}` } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("can resolve a valid Spotify ID when song metadata is unavailable", async () => {
    const fetchImpl = fetchMock().mockResolvedValue(response());
    const lyrics = await createUnisonProvider(fetchImpl).getLyrics({ id: spotifyId, name: "", artists: [] });
    expect(lyrics?.Type).toBe("Syllable");
    expect(new URL(String(fetchImpl.mock.calls[0]![0])).search).toBe(`?spotify=${spotifyId}`);
  });

  it("preserves TTML word boundaries, exact timing and background vocals", async () => {
    const lyrics = await createUnisonProvider(fetchMock().mockResolvedValue(response())).getLyrics(track);
    expect(lyrics?.Type).toBe("Syllable");
    if (lyrics?.Type !== "Syllable") throw new Error("Expected syllables");
    const line = lyrics.Content[0];
    if (line?.Type !== "Vocal") throw new Error("Expected vocals");
    expect(line.Lead.Syllables.map(word => [word.Text, word.IsPartOfWord])).toEqual([
      ["Hello", false], ["be", true], ["au", true], ["tiful", false]
    ]);
    expect(line.Lead.Syllables[2]).toMatchObject({ StartTime: 2.5, EndTime: 3 });
    expect(line.Background?.[0]?.Syllables.map(word => word.Text)).toEqual(["back", "ground"]);
    expect(lyrics.EndTime).toBe(5);
  });

  it("converts LRC to timed lines and uses the requested recording duration", async () => {
    const lyrics = await createUnisonProvider(fetchMock().mockResolvedValue(response({
      format: "lrc", syncType: "linesync", lyrics: "[00:01.00]First line\n[00:03.00]Last line"
    }))).getLyrics(track);
    expect(lyrics?.Type).toBe("Line");
    if (lyrics?.Type !== "Line") throw new Error("Expected lines");
    expect(lyrics.Content).toEqual([
      { Type: "Vocal", Text: "First line", StartTime: 1, EndTime: 3, OppositeAligned: false },
      { Type: "Vocal", Text: "Last line", StartTime: 3, EndTime: 180, OppositeAligned: false }
    ]);
  });

  it("preserves enhanced LRC spaces and syllable joins", async () => {
    const lyrics = await createUnisonProvider(fetchMock().mockResolvedValue(response({
      format: "lrc", syncType: "richsync", lyrics: "  [00:01.00]<00:01.00>Hello <00:02.00>be<00:03.00>au<00:04.00>tiful<00:05.00>"
    }))).getLyrics(track);
    expect(lyrics?.Type).toBe("Syllable");
    if (lyrics?.Type !== "Syllable") throw new Error("Expected syllables");
    const line = lyrics.Content[0];
    if (line?.Type !== "Vocal") throw new Error("Expected vocals");
    expect(line.Lead.Syllables.map(word => [word.Text, word.IsPartOfWord])).toEqual([
      ["Hello", false], ["be", true], ["au", true], ["tiful", false]
    ]);
    expect(line.Lead.EndTime).toBe(5);
  });

  it("returns attributed static lines for plain lyrics", async () => {
    const lyrics = await createUnisonProvider(fetchMock().mockResolvedValue(response({ format: "plain", syncType: "plain", lyrics: " First line \n\nLast line" }))).getLyrics(track);
    expect(lyrics).toMatchObject({ Type: "Static", Lines: [{ Text: "First line" }, { Text: "Last line" }], Attribution: { provider: "unison" } });
  });

  it.each([
    { song: "Other song" }, { song: "Song (Live)" }, { artist: "Other Artist" },
    { isrc: "USABC2400002" }, { duration: 190 }, { variant: "own" }, { hidden: true }
  ])("rejects wrong or unsafe matches: %j", async overrides => {
    const attempt = trace();
    expect(await createUnisonProvider(fetchMock().mockResolvedValue(response(overrides))).getLyrics(track, { trace: attempt })).toBeUndefined();
    expect(attempt.upstream[0]?.result).toBe("no_match");
  });

  it("verifies a linked video's selected submission using search's real duration field", async () => {
    const fetchImpl = fetchMock().mockResolvedValueOnce(response({ matchedBy: "linked_video", isrc: undefined }))
      .mockResolvedValueOnce(Response.json({ success: true, data: [{ ...body(), duration: 181 }] }));
    const lyrics = await createUnisonProvider(fetchImpl).getLyrics(track);
    expect(lyrics?.Source?.LyricsId).toBe("13529");
    const url = new URL(String(fetchImpl.mock.calls[1]![0]));
    expect(url.pathname).toBe("/lyrics/search");
    expect(url.searchParams.get("q")).toBe(videoId);
    const headers = new Headers(fetchImpl.mock.calls[1]![1]?.headers);
    expect(headers.get("User-Agent")).toBe("Mozilla/5.0 (X11; Linux x86_64; rv:160.0) Gecko/20100101 Firefox/160.0");
    expect(headers.get("X-User-Agent")).toBe("beautiful-lyrics-reborn");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    { duration: 190 }, { duration: undefined }, { id: 999 }, { videoId: "wrong-video" }, { song: "Song (Live)" }
  ])("rejects a linked video when the same recording cannot be verified: %j", async overrides => {
    const fetchImpl = fetchMock().mockResolvedValueOnce(response({ matchedBy: "linked_video" }))
      .mockResolvedValueOnce(Response.json({ success: true, data: [{ ...body(), duration: 180, ...overrides }] }));
    expect(await createUnisonProvider(fetchImpl).getLyrics(track)).toBeUndefined();
  });

  it("does not make an unverifiable linked-video search when the Spotify duration is missing", async () => {
    const fetchImpl = fetchMock().mockResolvedValue(response({ matchedBy: "linked_video" }));
    const noDuration = { ...track };
    delete noDuration.durationSeconds;
    expect(await createUnisonProvider(fetchImpl).getLyrics(noDuration)).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, {}, { keyId, displayName: "" }, { keyId: "bad/id", displayName: "Name" }])("requires a valid submitter credit: %j", async submitter => {
    const attempt = trace();
    expect(await createUnisonProvider(fetchMock().mockResolvedValue(response({ submitter }))).getLyrics(track, { trace: attempt })).toBeUndefined();
    expect(attempt.upstream[0]?.result).toBe("missing_attribution");
  });

  it("treats 404 as an ordinary miss", async () => {
    const attempt = trace(), fetchImpl = fetchMock().mockResolvedValue(new Response("", { status: 404 }));
    expect(await createUnisonProvider(fetchImpl).getLyrics(track, { trace: attempt })).toBeUndefined();
    expect(attempt.upstream[0]).toMatchObject({ status: 404, result: "no_lyrics" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("honors LOOKUP_PENDING backoff without polling or returning stale lyrics", async () => {
    const fetchImpl = fetchMock().mockResolvedValue(new Response("pending", { status: 503, headers: { "Retry-After": "20" } }));
    const provider = createUnisonProvider(fetchImpl), attempt = trace();
    expect(await provider.getLyrics(track)).toBeUndefined();
    expect(await provider.getLyrics(track, { trace: attempt })).toBeUndefined();
    expect(attempt.reason).toBe("upstream_backoff");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps pending-lookup backoff on song A while still fetching song B", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchImpl = fetchMock()
      .mockResolvedValueOnce(new Response("pending", { status: 503, headers: { "Retry-After": "20" } }))
      .mockImplementation(async () => response());
    const provider = createUnisonProvider(fetchImpl), attempt = trace();
    const songB = { ...track, id: "2".repeat(22) };
    expect(await provider.getLyrics(track)).toBeUndefined();
    expect((await provider.getLyrics(songB))?.Source?.Provider).toBe("unison");
    expect(await provider.getLyrics(track, { trace: attempt })).toBeUndefined();
    expect(attempt.reason).toBe("upstream_backoff");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now += 20_001;
    expect((await provider.getLyrics(track))?.Type).toBe("Syllable");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("also limits a failed linked-video search to its parent track query", async () => {
    const fetchImpl = fetchMock().mockResolvedValueOnce(response({ matchedBy: "linked_video" }))
      .mockResolvedValueOnce(new Response("pending", { status: 503, headers: { "Retry-After": "20" } }))
      .mockResolvedValueOnce(response());
    const provider = createUnisonProvider(fetchImpl);
    expect(await provider.getLyrics(track)).toBeUndefined();
    expect((await provider.getLyrics({ ...track, id: "2".repeat(22) }))?.Type).toBe("Syllable");
    expect(await provider.getLyrics(track)).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("still applies a 429 read-rate limit to every track", async () => {
    const fetchImpl = fetchMock().mockResolvedValue(new Response("limited", { status: 429, headers: { "Retry-After": "20" } }));
    const provider = createUnisonProvider(fetchImpl), attempt = trace();
    expect(await provider.getLyrics(track)).toBeUndefined();
    expect(await provider.getLyrics({ ...track, id: "2".repeat(22) }, { trace: attempt })).toBeUndefined();
    expect(attempt.reason).toBe("upstream_backoff");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("revalidates a bounded ETag snapshot and does not expose it to caller mutation", async () => {
    const fetchImpl = fetchMock().mockResolvedValueOnce(response({}, { ETag: 'W/"version1"' }))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: 'W/"version1"' } }));
    const provider = createUnisonProvider(fetchImpl);
    const first = await provider.getLyrics(track);
    first!.Source!.Provider = "changed-by-caller";
    const attempt = trace(), second = await provider.getLyrics(track, { trace: attempt });
    expect(new Headers(fetchImpl.mock.calls[1]![1]?.headers).get("If-None-Match")).toBe('W/"version1"');
    expect(second?.Source?.Provider).toBe("unison");
    expect(attempt.upstream[0]).toMatchObject({ status: 304, result: "found", outcome: "success" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("accepts updated lyric content and submitter names after an ETag changes", async () => {
    const fetchImpl = fetchMock().mockResolvedValueOnce(response({}, { ETag: 'W/"version1"' }))
      .mockResolvedValueOnce(response({ format: "plain", lyrics: "Edited", submitter: { keyId, displayName: "New name" } }, { ETag: 'W/"version2"' }));
    const provider = createUnisonProvider(fetchImpl);
    await provider.getLyrics(track);
    expect(await provider.getLyrics(track)).toMatchObject({ Type: "Static", Lines: [{ Text: "Edited" }], Attribution: { submitter: { username: "New name" } } });
  });

  it("evicts old ETags rather than sending a validator forever", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchImpl = fetchMock().mockImplementation(async () => response({}, { ETag: 'W/"version1"' }));
    const provider = createUnisonProvider(fetchImpl);
    await provider.getLyrics(track);
    now += 3_600_001;
    await provider.getLyrics(track);
    expect(new Headers(fetchImpl.mock.calls[1]![1]?.headers).get("If-None-Match")).toBeNull();
  });

  it("keeps an ETag long enough to revalidate after the shared ten-minute cache expires", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchImpl = fetchMock().mockResolvedValueOnce(response({}, { ETag: 'W/"version1"' }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const provider = createUnisonProvider(fetchImpl);
    await provider.getLyrics(track);
    now += 600_001;
    expect((await provider.getLyrics(track))?.Type).toBe("Syllable");
    expect(new Headers(fetchImpl.mock.calls[1]![1]?.headers).get("If-None-Match")).toBe('W/"version1"');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("bounds the number of ETag snapshots", async () => {
    const fetchImpl = fetchMock().mockImplementation(async () => response({}, { ETag: 'W/"version1"' }));
    const provider = createUnisonProvider(fetchImpl);
    for (let index = 0; index < 33; index++) await provider.getLyrics({ ...track, id: String(index).padStart(22, "0") });
    await provider.getLyrics({ ...track, id: "0".repeat(22) });
    expect(new Headers(fetchImpl.mock.calls[33]![1]?.headers).get("If-None-Match")).toBeNull();
  });

  it("aborts an upstream request when the caller cancels", async () => {
    const controller = new AbortController();
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    const fetchImpl = fetchMock().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      signalStarted();
    }));
    const attempt = trace(), pending = createUnisonProvider(fetchImpl).getLyrics(track, { signal: controller.signal, trace: attempt });
    await started;
    controller.abort(new DOMException("Cancelled", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(attempt.upstream[0]?.outcome).toBe("cancelled");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
