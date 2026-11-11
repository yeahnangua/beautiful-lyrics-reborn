import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppleMusicProvider } from "../src/providers/applemusic";
import type { ProviderAttempt } from "../src/types";

const track = { id: "spotify-track", name: "Song", artists: ["Artist"], durationSeconds: 5,
  appleMusicId: "183919743", appleMusicTitle: "Song (Live)" };
const syllables = [
  { text: "One ", part: false, timestamp: 1000, endtime: 1500 },
  { text: "two", part: true, timestamp: 1500, endtime: 2000 },
  { text: "three", part: false, timestamp: 2000, endtime: 2500 }
];
const trace = (): ProviderAttempt => ({ provider: "applemusic", stage: "syllable", startedAt: "test",
  durationMs: 0, outcome: "pending", retries: 0, upstream: [] });

afterEach(() => vi.restoreAllMocks());

describe("Apple Music via Paxsenix", () => {
  it.each(["Syllable", "Word"])("requests only the Apple Music endpoint and preserves %s timings and provenance", async syncType => {
    const fetchMock = vi.fn(async () => Response.json({ provider: "apple_music", syncType,
      lyrics: [{ oppositeTurn: true, text: syllables }] }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const attempt = trace();
    const lyrics = await createAppleMusicProvider(fetchMock).getLyrics(track, { trace: attempt });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://lyrics.paxsenix.org/apple-music/lyrics?id=183919743&v=2",
      expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(lyrics).toMatchObject({ Type: "Syllable", StartTime: 1, EndTime: 2.5,
      Source: { Provider: "applemusic", Transport: "lyrically", TrackId: "183919743", MatchedTitle: "Song (Live)" },
      Content: [{ OppositeAligned: true, Lead: { StartTime: 1, EndTime: 2.5, Syllables: [
        { Text: "One ", StartTime: 1, EndTime: 1.5, IsPartOfWord: false },
        { Text: "two", StartTime: 1.5, EndTime: 2, IsPartOfWord: true },
        { Text: "three", StartTime: 2, EndTime: 2.5, IsPartOfWord: false }
      ] } }] });
    expect(attempt.upstream).toMatchObject([{ endpoint: "lyrics.paxsenix.org/apple-music/lyrics", operation: "lyrics",
      status: 200, outcome: "success", result: "found", resultCount: 1 }]);
    expect(attempt.matches).toEqual([lyrics?.Source]);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "not-an-id", "123&provider=spotify"])("does not make any request without a valid client ID (%s)", async appleMusicId => {
    const fetchMock = vi.fn();
    const attempt = trace();
    const { appleMusicId: _id, ...metadata } = track;
    const supplied = appleMusicId === undefined ? metadata : { ...metadata, appleMusicId };
    expect(await createAppleMusicProvider(fetchMock).getLyrics(supplied, { trace: attempt })).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(attempt).toMatchObject({ reason: "apple_music_id_unavailable", upstream: [] });
  });

  it("retains valid words when malformed timings occur and joins syllables when part flags are absent", async () => {
    const fetchMock = vi.fn(async () => Response.json({ syncType: "Syllable", lyrics: [null, { text: [
      null, { text: "bad", timestamp: "1000", endtime: 1500 },
      { text: "backwards", timestamp: 2000, endtime: 1000 },
      ...syllables.map(({ part: _part, ...word }) => word)
    ] }] }));
    const lyrics = await createAppleMusicProvider(fetchMock).getLyrics(track);
    expect(lyrics).toMatchObject({ Type: "Syllable", Content: [{ Lead: { Syllables: [
      { Text: "One ", IsPartOfWord: true }, { Text: "two", IsPartOfWord: true }, { Text: "three", IsPartOfWord: false }
    ] } }] });
  });

  it("converts line lyrics and fills missing end times from the next line or track duration", async () => {
    const fetchMock = vi.fn(async () => Response.json({ syncType: "Line", lyrics: [
      { text: "First line", timestamp: 1000 },
      { text: [{ text: "Last " }, { text: "line" }], timestamp: 3000, oppositeTurn: true }
    ] }));
    expect(await createAppleMusicProvider(fetchMock).getLyrics(track)).toMatchObject({ Type: "Line", StartTime: 1, EndTime: 5,
      Content: [
        { Text: "First line", StartTime: 1, EndTime: 3, OppositeAligned: false },
        { Text: "Last line", StartTime: 3, EndTime: 5, OppositeAligned: true }
      ] });
  });

  it.each([
    { payload: { provider: "apple_music", error: { code: 503, message: "Busy" }, syncType: null }, status: 503, result: "http_error" },
    { payload: { error: { code: 503, message: "Busy" } }, status: 200, result: "api_error" },
    { payload: null, status: 200, result: "invalid_payload" },
    { payload: {}, status: 200, result: "invalid_payload" },
    { payload: { syncType: "Word", lyrics: {} }, status: 200, result: "invalid_payload" },
    { payload: { syncType: "Line", lyrics: [] }, status: 200, result: "no_lyrics" }
  ])("distinguishes $result from a successful lyric response", async ({ payload, status, result }) => {
    const fetchMock = vi.fn(async () => Response.json(payload, { status }));
    const attempt = trace();
    expect(await createAppleMusicProvider(fetchMock).getLyrics(track, { trace: attempt })).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(attempt.upstream).toMatchObject([{ status, result, outcome: result === "no_lyrics" ? "success" : "failed" }]);
    if (payload && "error" in payload) expect(attempt.upstream[0]?.codes).toEqual({ code: 503 });
  });

  it("records non-JSON responses as failures", async () => {
    const attempt = trace();
    const fetchMock = vi.fn(async () => new Response("<html>unavailable</html>"));
    expect(await createAppleMusicProvider(fetchMock).getLyrics(track, { trace: attempt })).toBeUndefined();
    expect(attempt.upstream).toMatchObject([{ status: 200, outcome: "failed", result: "invalid_payload" }]);
  });

  it("cancels a pending request when another source wins instead of retrying it", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const fetchMock = vi.fn(() => { markStarted(); return new Promise<Response>(() => {}); });
    const controller = new AbortController();
    const attempt = trace();
    const pending = createAppleMusicProvider(fetchMock).getLyrics(track, { signal: controller.signal, trace: attempt });
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(attempt.upstream).toMatchObject([{ outcome: "cancelled" }]);
    expect(attempt.retries).toBe(0);
  });
});
