import { describe, expect, it, vi } from "vitest";
import { createLrcRedProvider, lrcRedUserAgent } from "../src/providers/lrcred";
import { convertLrcRedTtml } from "../src/convert/lrcred-ttml";
import type { ProviderAttempt, TrackMetadata } from "../src/types";
import { redTtml, redWords } from "./lrcred-fixtures";

const track: TrackMetadata = { id: "spotify-id", name: "Song", artists: ["Artist"], album: "Album", durationSeconds: 180 };
const hit = { isrc: "USABC2400001", title: "Song", artist: "Artist", album: "Album", duration: 180 };
const trace = (): ProviderAttempt => ({ provider: "lrc.red", stage: "syllable", startedAt: "test", durationMs: 0, outcome: "pending", retries: 0, upstream: [] });
const asWords = (xml: string) => {
  const lyrics = convertLrcRedTtml(xml);
  expect(lyrics?.Type).toBe("Syllable");
  if (lyrics?.Type !== "Syllable") throw new Error("Expected syllables");
  return lyrics;
};
const lyricText = (syllables: { Text: string; IsPartOfWord: boolean }[]) => syllables.map((word, index) =>
  `${index && !syllables[index - 1]!.IsPartOfWord ? " " : ""}${word.Text}`).join("");

describe("lrc.red TTML", () => {
  it("preserves spaces between words and joins syllables within words", () => {
    const lyrics = asWords(redTtml('<p begin="1" end="5"><span begin="1" end="2">Hel</span><span begin="2" end="3">lo</span> <span begin="3" end="4">world </span><span begin="4" end="5">again</span>!</p>'));
    const lead = lyrics.Content[0]!;
    if (lead.Type !== "Vocal") throw new Error("Expected vocal");
    expect(lead.Lead.Syllables.map(word => word.IsPartOfWord)).toEqual([true, false, false, false]);
    expect(lyricText(lead.Lead.Syllables)).toBe("Hello world again!");
  });
  it("keeps CJK syllables joined and decodes numeric XML entities", () => {
    const lyrics = asWords(redTtml('<p begin="1" end="3"><span begin="1" end="2">你</span><span begin="2" end="3">好&#33;</span></p>'));
    const lead = lyrics.Content[0]!;
    if (lead.Type !== "Vocal") throw new Error("Expected vocal");
    expect(lyricText(lead.Lead.Syllables)).toBe("你好!");
  });
  it("retains background vocals and aligns a second singer separately", () => {
    const lyrics = asWords(redTtml('<p begin="1" end="3" ttm:agent="v1"><span begin="1" end="3">Lead</span><span ttm:role="x-bg"><span begin="0.5" end="4">Echo</span></span><span ttm:role="x-translation">翻译</span></p><p begin="4" end="5" ttm:agent="v2"><span begin="4" end="5">Other</span></p>'));
    expect(lyrics).toMatchObject({ StartTime: 0.5, EndTime: 5, Content: [
      { OppositeAligned: false, Lead: { Syllables: [{ Text: "Lead" }] }, Background: [{ StartTime: 0.5, EndTime: 4, Syllables: [{ Text: "Echo" }] }] },
      { OppositeAligned: true, Lead: { Syllables: [{ Text: "Other" }] } }
    ] });
  });
  it("keeps line timing as Line instead of inventing word timing", () => {
    expect(convertLrcRedTtml(redTtml('<p begin="1" end="3">A complete line</p>', "Line")))
      .toMatchObject({ Type: "Line", StartTime: 1, EndTime: 3, Content: [{ Text: "A complete line" }] });
    expect(convertLrcRedTtml(redTtml('<p begin="1" end="3"><span begin="1" end="3">A complete line</span></p>', "Line"))?.Type).toBe("Line");
  });
  it("returns unsynced TTML as Static", () => {
    expect(convertLrcRedTtml(redTtml('<p>First line</p><p>Second &amp; final</p>', "None")))
      .toEqual({ Type: "Static", Lines: [{ Text: "First line" }, { Text: "Second & final" }] });
  });
  it.each(["", "<html><body>error</body></html>", '<tt><body><p>broken</body></tt>',
    redTtml('<p begin="2" end="1"><span begin="2" end="1">invalid</span></p>'),
    '<!DOCTYPE tt [<!ENTITY a "expanded">]>' + redTtml('<p>&a;</p>', "None")])("rejects invalid or unsupported XML (%#)", xml => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect(convertLrcRedTtml(xml)).toBeUndefined(); expect(log).not.toHaveBeenCalled(); }
    finally { log.mockRestore(); }
  });
});

describe("lrc.red provider", () => {
  it("selects the matching recording and identifies the app on every request", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("search.json")
      ? Response.json({ hits: [{ ...hit, artist: "Other" }, { ...hit, title: "Song (Live)" }, { ...hit, duration: 220 }, hit] })
      : new Response(redWords));
    const diagnostics = trace();
    const result = await createLrcRedProvider(fetchMock).getLyrics(track, { trace: diagnostics });
    expect(result).toMatchObject({ Type: "Syllable", Source: { Provider: "lrc.red", Transport: "direct", TrackId: hit.isrc },
      Attribution: { provider: "lrc.red", source: "lrc.red" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit][]) {
      expect(new Headers(call[1].headers).get("User-Agent")).toBe(lrcRedUserAgent);
      expect(new URL(String(call[0])).origin).toBe("https://lrc.red");
    }
    expect(lrcRedUserAgent).toContain("https://github.com/yeahnangua/beautiful-lyrics-reborn");
    expect(lrcRedUserAgent).toContain("1135746060@qq.com");
    expect(diagnostics.upstream).toMatchObject([{ operation: "search", result: "matched", matchedCount: 1 }, { operation: "lyrics", result: "found" }]);
  });
  it("uses a known ISRC directly without a search", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(redWords));
    await createLrcRedProvider(fetchMock).getLyrics({ ...track, isrc: hit.isrc.toLowerCase() });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://lrc.red/s/USABC2400001.ttml");
  });
  it("handles simplified titles and harmless EP version suffixes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("search.json")
      ? Response.json({ hits: [{ ...hit, title: "范例 (EP Version)", artist: "范例歌手" }] }) : new Response(redWords));
    expect(await createLrcRedProvider(fetchMock).getLyrics({ ...track, name: "範例", artists: ["範例歌手"] })).toMatchObject({ Type: "Syllable" });
  });
  it("prefers the matching album among equivalent recordings", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("search.json")
      ? Response.json({ hits: [{ ...hit, isrc: "USABC2400002", album: "Compilation" }, hit] }) : new Response(redWords));
    await createLrcRedProvider(fetchMock).getLyrics(track);
    expect(String(fetchMock.mock.calls[1]?.[0]).endsWith("USABC2400001.ttml")).toBe(true);
  });
  it.each([", ", "，", "、", " & ", " / ", " + ", "＋", "; ", "；", " feat. ", " ft ", " WITH "])("matches collaboration credits separated by %s", async separator => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("search.json")
      ? Response.json({ hits: [{ ...hit, artist: `Artist A${separator}Artist B` }] }) : new Response(redWords));
    expect(await createLrcRedProvider(fetchMock).getLyrics({ ...track, artists: ["Artist A", "Artist B"] }))
      .toMatchObject({ Type: "Syllable", Source: { TrackId: hit.isrc } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(["AC/DC", "Simon & Garfunkel", "Earth, Wind & Fire", "Sleeping With Sirens"])("preserves a complete artist name containing separators: %s", async artist => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("search.json")
      ? Response.json({ hits: [{ ...hit, artist }] }) : new Response(redWords));
    expect(await createLrcRedProvider(fetchMock).getLyrics({ ...track, artists: [artist] })).toMatchObject({ Type: "Syllable" });
  });
  it("keeps exact artist, recording-version and duration checks for collaborations", async () => {
    const fetchMock = vi.fn(async () => Response.json({ hits: [
      { ...hit, artist: "Artist Extended, Someone Else" },
      { ...hit, artist: "Artist, Someone Else", title: "Song (Live)" },
      { ...hit, artist: "Artist, Someone Else", duration: 189 }
    ] }));
    expect(await createLrcRedProvider(fetchMock).getLyrics(track)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("upgrades a line candidate to words without dropping its source", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes("search.json") ? Response.json({ hits: [hit, { ...hit, isrc: "USABC2400002" }] })
        : new Response(url.includes("0001.ttml") ? redTtml('<p begin="1" end="3">Line</p>', "Line") : redWords);
    });
    expect(await createLrcRedProvider(fetchMock).getLyrics(track)).toMatchObject({ Type: "Syllable", Source: { TrackId: "USABC2400002" } });
  });
  it.each(["Line", "None"])("keeps a %s fallback when another candidate is missing", async timing => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes("search.json") ? Response.json({ hits: [hit, { ...hit, isrc: "USABC2400002" }] })
        : url.includes("0001.ttml") ? new Response(redTtml('<p begin="1" end="3">Line</p>', timing)) : new Response("missing", { status: 404 });
    });
    expect(await createLrcRedProvider(fetchMock).getLyrics(track)).toMatchObject({ Type: timing === "Line" ? "Line" : "Static", Source: { TrackId: hit.isrc } });
  });
  it("does not download unrelated, unsafe, or unverified-duration candidates", async () => {
    const fetchMock = vi.fn(async () => Response.json({ hits: [
      { ...hit, isrc: "../../elsewhere" }, { ...hit, duration: undefined }, { ...hit, title: "Song (Acoustic)" }, { ...hit, artist: "Someone Else" }
    ] }));
    expect(await createLrcRedProvider(fetchMock).getLyrics(track)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps an earlier line result when a later recording times out", async () => {
    vi.useFakeTimers();
    try {
      let started!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("search.json")) return Response.json({ hits: [hit, { ...hit, isrc: "USABC2400002" }] });
        if (url.includes("0001.ttml")) return new Response(redTtml('<p begin="1" end="3">Line</p>', "Line"));
        return new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }); started();
        });
      });
      const pending = createLrcRedProvider(fetchMock).getLyrics(track);
      await ready;
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toMatchObject({ Type: "Line", Source: { TrackId: hit.isrc } });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });
  it.each([null, {}, { hits: null }])("records malformed search responses as failures (%#)", async payload => {
    const diagnostics = trace();
    expect(await createLrcRedProvider(vi.fn(async () => Response.json(payload))).getLyrics(track, { trace: diagnostics })).toBeUndefined();
    expect(diagnostics.upstream[0]).toMatchObject({ result: "invalid_payload", outcome: "failed" });
  });
  it.each([429, 503])("honors Retry-After without retries or extra requests after %s", async status => {
    const fetchMock = vi.fn(async () => new Response("busy", { status, headers: { "Retry-After": "60" } }));
    const provider = createLrcRedProvider(fetchMock), first = trace(), second = trace();
    expect(await provider.getLyrics(track, { trace: first })).toBeUndefined();
    expect(await provider.getLyrics(track, { trace: second })).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ retries: 0, upstream: [{ status, result: "http_error" }] });
    expect(second).toMatchObject({ reason: "upstream_backoff", upstream: [] });
  });
  it.each([null, "", "   ", "-1", "-0.5", "+1", "NaN", "Infinity", "1e3", "0x10", "1/2", "9007199254740", "999999999999999999999999", "invalid",
    "Tue, 30 Feb 2027 12:00:00 GMT"])("uses the five-second fallback for invalid Retry-After %j", async value => {
    vi.useFakeTimers();
    try {
      const now = Date.parse("2026-11-11T12:00:00Z");
      vi.setSystemTime(now);
      const fetchMock = vi.fn(async () => new Response("busy", { status: 429, headers: value === null ? {} : { "Retry-After": value } }));
      const provider = createLrcRedProvider(fetchMock);
      await provider.getLyrics(track);
      vi.setSystemTime(now + 4999);
      await provider.getLyrics(track);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.setSystemTime(now + 5000);
      await provider.getLyrics(track);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it.each([
    ["0", 1000], ["0.5", 1000], ["1.25", 1250], [" 2 ", 2000], ["86400", 86_400_000],
    ["Thu, 12 Nov 2026 12:00:00 GMT", 86_400_000], ["Wed, 11 Nov 2026 11:59:00 GMT", 1000],
    ["Wednesday, 11-Nov-26 12:00:10 GMT", 10000], ["Wed Nov 11 12:00:10 2026", 10000]
  ] as const)("preserves the requested cooldown for Retry-After %s", async (value, delay) => {
    vi.useFakeTimers();
    try {
      const now = Date.parse("2026-11-11T12:00:00Z");
      vi.setSystemTime(now);
      const fetchMock = vi.fn(async () => new Response("busy", { status: 503, headers: { "Retry-After": value } }));
      const provider = createLrcRedProvider(fetchMock);
      await provider.getLyrics(track);
      vi.setSystemTime(now + delay - 1);
      await provider.getLyrics(track);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.setSystemTime(now + delay);
      await provider.getLyrics(track);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it("cancels an in-flight request without retries", async () => {
    const controller = new AbortController(), diagnostics = trace();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }); started();
    }));
    const pending = createLrcRedProvider(fetchMock).getLyrics(track, { trace: diagnostics, signal: controller.signal });
    const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await ready; controller.abort(); await failure;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(diagnostics).toMatchObject({ retries: 0, upstream: [{ outcome: "cancelled" }] });
  });
  it("does not shorten a long cooldown when an older concurrent request returns a shorter delay", async () => {
    vi.useFakeTimers();
    try {
      const now = Date.parse("2026-11-11T12:00:00Z");
      vi.setSystemTime(now);
      const responses: Array<(response: Response) => void> = [];
      let started!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      const fetchMock = vi.fn(async () => new Promise<Response>(resolve => {
        responses.push(resolve);
        if (responses.length === 2) started();
      }));
      const provider = createLrcRedProvider(fetchMock);
      const first = provider.getLyrics(track), second = provider.getLyrics(track);
      await ready;
      expect(responses).toHaveLength(2);
      responses[0]!(new Response("busy", { status: 429, headers: { "Retry-After": "86400" } }));
      await first;
      responses[1]!(new Response("busy", { status: 429, headers: { "Retry-After": "1" } }));
      await second;
      vi.setSystemTime(now + 5 * 60_000);
      expect(await provider.getLyrics(track)).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
