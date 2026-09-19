import { describe, expect, it, vi } from "vitest";
import { convertRichsyncToSyllableLyrics } from "../src/convert/richsync";
import { createMusixmatchProvider } from "../src/providers/musixmatch";
import { createNeteaseProvider } from "../src/providers/netease";
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

const richsyncBody = JSON.stringify([
  { ts: 10, te: 14, l: [{ c: "Hel", o: 0.25 }, { c: "lo ", o: 0.75 }, { c: "world", o: 2 }] }
]);

function macroResponse() {
  return {
    message: {
      header: { status_code: 200 },
      body: {
        macro_calls: {
          "matcher.track.get": {
            message: { header: { status_code: 200 }, body: { track: { has_richsync: 1, instrumental: 0 } } }
          },
          "track.lyrics.get": {
            message: { header: { status_code: 200 }, body: { lyrics: { restricted: 0 } } }
          },
          "track.richsync.get": {
            message: {
              header: { status_code: 200 },
              body: { richsync: { richsync_body: richsyncBody, restricted: 0 } }
            }
          }
        }
      }
    }
  };
}

describe("Musixmatch richsync conversion", () => {
  it("keeps absolute offsets, syllable boundaries, and the final word's end", () => {
    expect(convertRichsyncToSyllableLyrics(richsyncBody)).toEqual({
      Type: "Syllable",
      StartTime: 10.25,
      EndTime: 14,
      Content: [{
        Type: "Vocal",
        OppositeAligned: false,
        Lead: {
          StartTime: 10.25,
          EndTime: 14,
          Syllables: [
            { Text: "Hel", StartTime: 10.25, EndTime: 10.75, IsPartOfWord: true },
            { Text: "lo", StartTime: 10.75, EndTime: 12, IsPartOfWord: false },
            { Text: "world", StartTime: 12, EndTime: 14, IsPartOfWord: false }
          ]
        }
      }]
    });
  });

  it("preserves pauses around whitespace tokens and overlapping line ends", () => {
    const result = convertRichsyncToSyllableLyrics(JSON.stringify([
      { ts: 1, te: 10, l: [{ c: "First", o: 0 }, { c: " ", o: 0.5 }, { c: "line", o: 2 }] },
      { ts: 4, te: 5, l: [{ c: "Overlap", o: 0 }] }
    ]));
    expect(result?.EndTime).toBe(10);
    expect(result?.Content[0]).toMatchObject({
      Lead: { Syllables: [
        { Text: "First", StartTime: 1, EndTime: 1.5, IsPartOfWord: false },
        { Text: "line", StartTime: 3, EndTime: 10, IsPartOfWord: false }
      ] }
    });
  });

  it("keeps final words when upstream rounds their start to the line's end", () => {
    const lyrics = convertRichsyncToSyllableLyrics(JSON.stringify([
      { ts: 1, te: 2, l: [{ c: "First ", o: 0 }, { c: "last", o: 1.0001 }] }
    ]));
    const line = lyrics?.Content[0];
    expect(line?.Type).toBe("Vocal");
    if (line?.Type !== "Vocal") throw new Error("Expected timed words");
    expect(line.Lead.Syllables.map((word) => word.Text)).toEqual(["First", "last"]);
    const last = line.Lead.Syllables[1]!;
    expect(last.StartTime).toBeCloseTo(2.0001);
    expect(last.EndTime - last.StartTime).toBeCloseTo(0.001);
    expect(lyrics?.EndTime).toBe(last.EndTime);
  });

  it.each([
    undefined, "invalid JSON", "{}", "[]",
    JSON.stringify([{ ts: 2, te: 1, l: [{ c: "Invalid", o: 0 }] }]),
    JSON.stringify([{ ts: 1, te: 2, l: [{ c: "Invalid", o: -1 }, { c: "Late", o: 3 }] }])
  ])("returns no lyrics for invalid or empty word data (%s)", (body) => {
    expect(convertRichsyncToSyllableLyrics(body)).toBeUndefined();
  });
});

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

describe("Musixmatch direct provider", () => {
  it("shares a freshly acquired anonymous token and requests richsync with the Spotify URI", async () => {
    let tokenCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://apic-appmobile.musixmatch.com");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url.pathname.endsWith("token.get")) {
        tokenCalls += 1;
        return json({ message: { header: { status_code: 200 }, body: { user_token: "anonymous-test-token" } } });
      }
      expect(url.searchParams.get("optional_calls")).toBe("track.richsync");
      expect(url.searchParams.get("track_spotify_id")).toBe("spotify:track:spotify-id");
      expect(url.searchParams.get("q_duration")).toBe("180");
      expect(url.searchParams.get("usertoken")).toBe("anonymous-test-token");
      return json(macroResponse());
    });
    const provider = createMusixmatchProvider(fetchMock as typeof fetch);
    const lyrics = await Promise.all([provider.getSyllableLyrics(track), provider.getSyllableLyrics(track)]);
    expect(lyrics.map((result) => result?.Type)).toEqual(["Syllable", "Syllable"]);
    expect(tokenCalls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refreshes an expired token once and retries the lyric request", async () => {
    let tokenCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("token.get")) {
        tokenCalls += 1;
        return json({ message: { header: { status_code: 200 }, body: { user_token: `token-${tokenCalls}` } } });
      }
      return url.searchParams.get("usertoken") === "token-1"
        ? json({ message: { header: { status_code: 401 } } }) : json(macroResponse());
    });
    const provider = createMusixmatchProvider(fetchMock as typeof fetch);
    expect((await provider.getSyllableLyrics(track))?.Type).toBe("Syllable");
    expect(tokenCalls).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("backs off failed token acquisition instead of retrying for every track", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ message: { header: { status_code: 401 } } }));
    const provider = createMusixmatchProvider(fetchMock as typeof fetch);
    expect(await provider.getSyllableLyrics(track)).toBeUndefined();
    expect(await provider.getSyllableLyrics(track)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["missing richsync", "instrumental", "restricted lyrics", "restricted richsync", "error envelope"])(
    "ignores %s", async (condition) => {
      const macro = macroResponse();
      const calls = macro.message.body.macro_calls;
      if (condition === "missing richsync") calls["track.richsync.get"].message.header.status_code = 404;
      if (condition === "instrumental") calls["matcher.track.get"].message.body.track.instrumental = 1;
      if (condition === "restricted lyrics") calls["track.lyrics.get"].message.body.lyrics.restricted = 1;
      if (condition === "restricted richsync") calls["track.richsync.get"].message.body.richsync.restricted = 1;
      if (condition === "error envelope") macro.message.header.status_code = 429;
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(json({ message: { header: { status_code: 200 }, body: { user_token: "test-token" } } }))
        .mockResolvedValueOnce(json(macro));
      expect(await createMusixmatchProvider(fetchMock as typeof fetch).getSyllableLyrics(track)).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  );
});

it.each([createNeteaseProvider, createMusixmatchProvider])("skips direct lookup without track metadata", async (create) => {
  const fetchMock = vi.fn();
  expect(await create(fetchMock as typeof fetch).getSyllableLyrics({ id: "id", name: "", artists: [] })).toBeUndefined();
  expect(fetchMock).not.toHaveBeenCalled();
});
