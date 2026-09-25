import { describe, expect, it, vi } from "vitest";
import { createNeteaseProvider } from "../src/providers/netease";
import { matchedTitle } from "../src/providers/matched-title";
import type { TrackMetadata } from "../src/types";

const track: TrackMetadata = {
  id: "spotify-id",
  name: "範例歌曲",
  artists: ["範例歌手"],
  album: "專輯",
  durationSeconds: 180
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}




describe("NetEase direct provider", () => {
  it("matches title, artist, duration and album before downloading YRC directly", async () => {
    const song = { name: "范例歌曲", artists: [{ name: "范例歌手" }], duration: 180000 };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://music.163.com");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url.pathname === "/api/search/get/web") {
        expect(url.searchParams.get("s")).toBe("范例歌曲 范例歌手");
        return json({ code: 200, result: { songs: [
          { ...song, id: 1, album: { name: "另一专辑" } },
          { ...song, id: 2, name: "另一歌曲", album: { name: "专辑" } },
          { ...song, id: 3, artists: [{ name: "翻唱歌手" }], album: { name: "专辑" } },
          { ...song, id: 4, duration: 230000, album: { name: "专辑" } },
          { ...song, id: 5, album: { name: "专辑" } }
        ] } });
      }
      expect(url.pathname).toBe("/api/song/lyric/v1");
      expect(url.searchParams.get("id")).toBe("5");
      expect(url.searchParams.get("yv")).toBe("-1");
      return json({ code: 200, yrc: { lyric: "[1000,1500](1000,500,0)测(1750,750,0)试" } });
    });
    const lyrics = await createNeteaseProvider(fetchMock as typeof fetch).getSyllableLyrics(track);
    expect(lyrics).toMatchObject({
      Type: "Syllable", StartTime: 1, EndTime: 2.5,
      Content: [{ Lead: { Syllables: [
        { Text: "测", StartTime: 1, EndTime: 1.5 },
        { Text: "试", StartTime: 1.75, EndTime: 2.5 }
      ] } }]
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(matchedTitle(lyrics!)).toBe("范例歌曲");
  });

  it("tries another matching release when the first has only line lyrics", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ code: 200, result: { songs: [
        { id: 1, name: track.name, ar: [{ name: track.artists[0] }], dt: 180000 },
        { id: 2, name: track.name, ar: [{ name: track.artists[0] }], dt: 180000 }
      ] } }))
      .mockResolvedValueOnce(json({ code: 200, lrc: { lyric: "[00:01.00]Line only" } }))
      .mockResolvedValueOnce(json({ code: 200, yrc: { lyric: "[1000,500](1000,500,0)字" } }));
    expect((await createNeteaseProvider(fetchMock as typeof fetch).getSyllableLyrics(track))?.Type).toBe("Syllable");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([{ code: -462 }, { code: 200, result: { songs: [] } }, { code: 200, result: { songs: {} } }])(
    "does not download after a failed or empty search", async (search) => {
      const fetchMock = vi.fn().mockResolvedValue(json(search));
      expect(await createNeteaseProvider(fetchMock as typeof fetch).getSyllableLyrics(track)).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it("skips instrumental and line-only responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ code: 200, result: { songs: [
        { id: 1, name: track.name, artists: [{ name: track.artists[0] }] }
      ] } }))
      .mockResolvedValueOnce(json({ code: 200, pureMusic: true, yrc: { lyric: "[0,2000](0,2000,0)纯音乐" } }));
    expect(await createNeteaseProvider(fetchMock as typeof fetch).getSyllableLyrics(track)).toBeUndefined();
  });
});


it.each([createNeteaseProvider, ])("skips direct lookup without track metadata", async (create) => {
  const fetchMock = vi.fn();
  expect(await create(fetchMock as typeof fetch).getSyllableLyrics({ id: "id", name: "", artists: [] })).toBeUndefined();
  expect(fetchMock).not.toHaveBeenCalled();
});
