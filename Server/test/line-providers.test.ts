import { describe, expect, it, vi } from "vitest";
import { createQqMusicProvider } from "../src/providers/qqmusic";
import { createKugouProvider } from "../src/providers/kugou";
import { createNeteaseProvider } from "../src/providers/netease";
import { createMusixmatchProvider } from "../src/providers/musixmatch";
import { convertMxmToLineLyrics } from "../src/convert/mxm";
import type { ProviderAttempt, TrackMetadata } from "../src/types";

const track: TrackMetadata = { id: "track", name: "测试歌曲", artists: ["歌手"], durationSeconds: 180 };
const lrc = "[00:01.50]你好\n[00:03.00]World";
const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const json = (value: unknown) => Response.json(value);
const qqKey = "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo";
const qqSearch = { req: { data: { body: { song: { list: [
  { id: 123, title: track.name, singer: [{ name: "歌手" }], interval: 180 }
] } } } } };
const kugouCandidate = { id: "123", accesskey: "SECRET", song: track.name, singer: "歌手", duration: 180000 };
const neteaseSearch = { code: 200, result: { songs: [
  { id: 123, name: track.name, artists: [{ name: "歌手" }], duration: 180000 }
] } };
const expected = { Type: "Line", StartTime: 1.5, EndTime: 180, Content: [
  { Text: "你好", StartTime: 1.5, EndTime: 3 }, { Text: "World", StartTime: 3, EndTime: 180 }
] };

describe("direct line providers", () => {
  it.each([base64(lrc), lrc])("gets QQ LRC without requiring QRC (%#)", async lyric => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.req) return json(qqSearch);
      expect(body[qqKey].param).toEqual({ crypt: 0, qrc: 0, songID: 123 });
      return json({ [qqKey]: { data: { qrc: 0, lyric } } });
    });
    const lyrics = await createQqMusicProvider(fetchMock as typeof fetch).getLineLyrics(track);
    expect(lyrics).toMatchObject({ ...expected, Source: { Provider: "qqmusic", Transport: "direct", TrackId: "123" } });
  });

  it("tries another QQ candidate after an unusable lyric payload", async () => {
    const search = structuredClone(qqSearch);
    search.req.data.body.song.list.push({ ...search.req.data.body.song.list[0]!, id: 456 });
    const fetchMock = vi.fn().mockResolvedValueOnce(json(search))
      .mockResolvedValueOnce(json({ [qqKey]: { data: { lyric: "invalid!" } } }))
      .mockResolvedValueOnce(json({ [qqKey]: { data: { lyric: base64(lrc) } } }));
    expect((await createQqMusicProvider(fetchMock).getLineLyrics(track))?.Source?.TrackId).toBe("456");
  });

  it("gets KuGou base64 LRC with fmt=lrc and retains safe diagnostics", async () => {
    const trace: ProviderAttempt = { provider: "kugou direct", stage: "line", startedAt: "test", durationMs: 0, outcome: "pending", retries: 0, upstream: [] };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search") return json({ status: 200, candidates: [kugouCandidate] });
      expect(url.searchParams.get("fmt")).toBe("lrc");
      expect(url.searchParams.get("accesskey")).toBe("SECRET");
      return json({ status: 200, content: base64(lrc) });
    });
    const lyrics = await createKugouProvider(fetchMock as typeof fetch).getLineLyrics(track, { trace });
    expect(lyrics).toMatchObject({ ...expected, Source: { Provider: "kugou", Transport: "direct", LyricsId: "123" } });
    expect(trace.upstream).toHaveLength(2);
    expect(JSON.stringify({ trace, lyrics })).not.toContain("SECRET");
  });

  it("gets NetEase LRC when YRC is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(neteaseSearch))
      .mockResolvedValueOnce(json({ code: 200, lrc: { lyric: lrc } }));
    expect(await createNeteaseProvider(fetchMock).getLineLyrics(track)).toMatchObject({
      ...expected, Source: { Provider: "netease", Transport: "direct", TrackId: "123" }
    });
  });

  it.each(["qqmusic", "kugou", "netease"] as const)("does not download mismatched %s candidates", async provider => {
    const fetchMock = vi.fn().mockResolvedValue(json(provider === "qqmusic" ? {
      req: { data: { body: { song: { list: [{ id: 123, title: "Wrong", singer: [{ name: "歌手" }] }] } } } }
    } : provider === "kugou" ? { status: 200, candidates: [{ ...kugouCandidate, singer: "Other" }] }
      : { code: 200, result: { songs: [{ id: 123, name: track.name, artists: [{ name: "Other" }] }] } }));
    const create = { qqmusic: createQqMusicProvider, kugou: createKugouProvider, netease: createNeteaseProvider }[provider];
    expect(await create(fetchMock).getLineLyrics(track)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["kugou", "netease"] as const)("tries another %s candidate after an unusable line payload", async provider => {
    const search = provider === "kugou" ? { status: 200, candidates: [kugouCandidate, { ...kugouCandidate, id: "456" }] }
      : { code: 200, result: { songs: [...neteaseSearch.result.songs, { ...neteaseSearch.result.songs[0]!, id: 456 }] } };
    const bad = provider === "kugou" ? { status: 200, content: "invalid!" } : { code: 500 };
    const good = provider === "kugou" ? { status: 200, content: base64(lrc) } : { code: 200, lrc: { lyric: lrc } };
    const fetchMock = vi.fn().mockResolvedValueOnce(json(search)).mockResolvedValueOnce(json(bad)).mockResolvedValueOnce(json(good));
    const create = provider === "kugou" ? createKugouProvider : createNeteaseProvider;
    expect(await create(fetchMock).getLineLyrics(track)).toMatchObject(expected);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gets Musixmatch subtitles without requiring RichSync and reuses its token", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("token.get")) return json({ message: { header: { status_code: 200 }, body: { user_token: "token" } } });
      return json(mxmEnvelope());
    });
    const provider = createMusixmatchProvider(fetchMock as typeof fetch);
    expect(await provider.getSyllableLyrics(track)).toBeUndefined();
    expect(await provider.getLineLyrics(track)).toMatchObject({
      ...expected, Source: { Provider: "musixmatch", Transport: "direct", TrackId: "123" }
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("token.get"))).toHaveLength(1);
  });

  it.each(["instrumental", "restricted", "missing subtitles", "restricted subtitles"])("rejects Musixmatch %s", async condition => {
    const envelope = mxmEnvelope();
    const calls = envelope.message.body.macro_calls;
    if (condition === "instrumental") calls["matcher.track.get"].message.body.track.instrumental = 1;
    if (condition === "restricted") calls["matcher.track.get"].message.body.track.restricted = 1;
    if (condition === "missing subtitles") calls["track.subtitles.get"].message.header.status_code = 404;
    if (condition === "restricted subtitles") calls["track.subtitles.get"].message.body.subtitle_list[0]!.subtitle.restricted = 1;
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ message: { header: { status_code: 200 }, body: { user_token: "token" } } }))
      .mockResolvedValueOnce(json(envelope));
    expect(await createMusixmatchProvider(fetchMock).getLineLyrics(track)).toBeUndefined();
  });

  it.each([createQqMusicProvider, createKugouProvider, createNeteaseProvider, createMusixmatchProvider])("skips lookup without metadata (%#)", async create => {
    const fetchMock = vi.fn();
    expect(await create(fetchMock).getLineLyrics({ id: "track", name: "", artists: [] })).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function mxmEnvelope() {
  return { message: { header: { status_code: 200 }, body: { macro_calls: {
    "matcher.track.get": { message: { header: { status_code: 200 }, body: { track: {
      track_id: 123, track_name: track.name, has_subtitles: 1, has_richsync: 0, instrumental: 0, restricted: 0
    } } } },
    "track.subtitles.get": { message: { header: { status_code: 200 }, body: { subtitle_list: [
      { subtitle: { restricted: 0, subtitle_body: JSON.stringify([
        { text: "你好", time: { total: 1.5 } }, { text: "World", time: { total: 3 } }
      ]) } }
    ] } } }
  } } } };
}

describe("MXM subtitle conversion", () => {
  it.each([undefined, "invalid", "{}", "[]", '[{"text":"x","time":{"total":-1}}]'])("rejects invalid subtitles (%#)", body => {
    expect(convertMxmToLineLyrics(body)).toBeUndefined();
  });
  it("sorts timestamps, retains duplicates and gives the last line a positive duration", () => {
    const lyrics = convertMxmToLineLyrics(JSON.stringify([
      { text: "Next", time: { total: 4 } }, { text: "First", time: { total: 1 } },
      null, { text: "Translation", time: { total: 1 } }, { text: "Bad", time: { total: "2" } }
    ]), 0);
    expect(lyrics?.Content.map(line => [line.Type === "Vocal" ? line.Text : "", line.StartTime, line.EndTime])).toEqual([
      ["First", 1, 4], ["Translation", 1, 4], ["Next", 4, 9]
    ]);
  });
});
