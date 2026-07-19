import { describe, expect, it, vi } from "vitest";
import { convertPlainTextToStatic } from "../src/convert/plain";
import { convertEnhancedLrcToSyllableLyrics } from "../src/convert/enhanced-lrc";
import { convertLrcToLineLyrics, parseLrcTimestamp } from "../src/convert/lrc";
import { convertSpotifyLyricsPayload } from "../src/convert/spotify";
import { convertTtmlToSyllableLyrics, parseTtmlTime } from "../src/convert/ttml";
import { convertQrcXmlToSyllableLyrics, convertYrcToSyllableLyrics } from "../src/convert/karaoke";
import { createAmllDbProvider } from "../src/providers/amlldb";
import { createLrclibProvider } from "../src/providers/lrclib";
import { createLyricallyProvider } from "../src/providers/lyrically";

describe("plain lyric conversion", () => {
  it("converts non-empty plain text lines to Static lyrics", () => {
    expect(convertPlainTextToStatic("First line\n\nSecond line")).toEqual({
      Type: "Static",
      Lines: [{ Text: "First line" }, { Text: "Second line" }]
    });
  });

  it("returns undefined for empty plain text", () => {
    expect(convertPlainTextToStatic(" \n ")).toBeUndefined();
  });
});

describe("LRC conversion", () => {
  it("parses minute-second-centisecond timestamps into seconds", () => {
    expect(parseLrcTimestamp("01:23.45")).toBeCloseTo(83.45);
  });

  it("parses minute-second-millisecond timestamps into seconds", () => {
    expect(parseLrcTimestamp("00:12.345")).toBeCloseTo(12.345);
  });

  it("converts timed LRC lines to Beautiful Lyrics Line output", () => {
    expect(convertLrcToLineLyrics("[00:10.00]Hello\n[00:12.50]World", 20)).toEqual({
      Type: "Line",
      StartTime: 10,
      EndTime: 20,
      Content: [
        {
          Type: "Vocal",
          Text: "Hello",
          StartTime: 10,
          EndTime: 12.5,
          OppositeAligned: false
        },
        {
          Type: "Vocal",
          Text: "World",
          StartTime: 12.5,
          EndTime: 20,
          OppositeAligned: false
        }
      ]
    });
  });

  it("returns undefined when LRC contains no timed lyric text", () => {
    expect(convertLrcToLineLyrics("[ar:Artist]\n[00:01.00]")).toBeUndefined();
  });

  it("converts enhanced LRC word timestamps to Syllable output", () => {
    const result = convertEnhancedLrcToSyllableLyrics(
      "[00:01.00] <00:01.00> Hello <00:01.50>   <00:01.50> world\n[00:03.00] <00:03.00> Again",
      5
    );

    expect(result).toEqual({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 5,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 3,
            Syllables: [
              {
                Text: "Hello",
                StartTime: 1,
                EndTime: 1.5,
                IsPartOfWord: false
              },
              {
                Text: "world",
                StartTime: 1.5,
                EndTime: 3,
                IsPartOfWord: false
              }
            ]
          }
        },
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 3,
            EndTime: 5,
            Syllables: [
              {
                Text: "Again",
                StartTime: 3,
                EndTime: 5,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });
  });
});

describe("Spotify lyric conversion", () => {
  it("converts line-synced Spotify lyrics to Line output", () => {
    const result = convertSpotifyLyricsPayload({
      lyrics: {
        syncType: "LINE_SYNCED",
        lines: [
          { startTimeMs: "10000", words: "Hello", endTimeMs: "12500" },
          { startTimeMs: "12500", words: "World", endTimeMs: "15000" }
        ]
      }
    });

    expect(result).toEqual({
      Type: "Line",
      StartTime: 10,
      EndTime: 15,
      Content: [
        {
          Type: "Vocal",
          Text: "Hello",
          StartTime: 10,
          EndTime: 12.5,
          OppositeAligned: false
        },
        {
          Type: "Vocal",
          Text: "World",
          StartTime: 12.5,
          EndTime: 15,
          OppositeAligned: false
        }
      ]
    });
  });

  it("uses the next Spotify line start when endTimeMs is zero", () => {
    const result = convertSpotifyLyricsPayload({
      lyrics: {
        syncType: "LINE_SYNCED",
        lines: [
          { startTimeMs: "10000", words: "Hello", endTimeMs: "0" },
          { startTimeMs: "12500", words: "World", endTimeMs: "0" }
        ]
      }
    });

    expect(result).toEqual({
      Type: "Line",
      StartTime: 10,
      EndTime: 17.5,
      Content: [
        {
          Type: "Vocal",
          Text: "Hello",
          StartTime: 10,
          EndTime: 12.5,
          OppositeAligned: false
        },
        {
          Type: "Vocal",
          Text: "World",
          StartTime: 12.5,
          EndTime: 17.5,
          OppositeAligned: false
        }
      ]
    });
  });

  it("converts unsynced Spotify lyrics to Static output", () => {
    const result = convertSpotifyLyricsPayload({
      lyrics: {
        syncType: "UNSYNCED",
        lines: [
          { startTimeMs: "0", words: "Hello", endTimeMs: "0" },
          { startTimeMs: "0", words: "World", endTimeMs: "0" }
        ]
      }
    });

    expect(result).toEqual({
      Type: "Static",
      Lines: [{ Text: "Hello" }, { Text: "World" }]
    });
  });
});

describe("TTML lyric conversion", () => {
  it("parses TTML clock timestamps into seconds", () => {
    expect(parseTtmlTime("01:02.340")).toBeCloseTo(62.34);
  });

  it("parses AMLLDB bare second timestamps into seconds", () => {
    expect(parseTtmlTime("27.773")).toBeCloseTo(27.773);
  });

  it("converts timed TTML spans to Beautiful Lyrics Syllable output", () => {
    const result = convertTtmlToSyllableLyrics(
      '<tt><body><div begin="00:01.000" end="00:03.000"><p begin="00:01.000" end="00:03.000"><span begin="00:01.000" end="00:01.500">你</span><span begin="00:01.500" end="00:03.000">好</span></p></div></body></tt>'
    );

    expect(result).toEqual({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 3,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 3,
            Syllables: [
              {
                Text: "你",
                StartTime: 1,
                EndTime: 1.5,
                IsPartOfWord: true
              },
              {
                Text: "好",
                StartTime: 1.5,
                EndTime: 3,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });
  });

  it("keeps AMLLDB lines before the first minute when they use bare second timestamps", () => {
    const result = convertTtmlToSyllableLyrics(
      '<tt><body><div begin="27.773" end="1:05.973"><p begin="27.773" end="33.297"><span begin="27.773" end="28.250">窗</span><span begin="28.250" end="28.570">透</span></p><p begin="1:00.963" end="1:05.973"><span begin="1:00.963" end="1:01.423">最</span><span begin="1:01.423" end="1:01.837">怕</span></p></div></body></tt>'
    );

    expect(result?.StartTime).toBeCloseTo(27.773);
    const firstLine = result?.Content[0];
    expect(firstLine?.Type).toBe("Vocal");
    if (firstLine?.Type !== "Vocal") {
      throw new Error("expected first TTML entry to be a vocal line");
    }
    expect(firstLine.Lead.Syllables.map((syllable) => syllable.Text).join("")).toBe("窗透");
  });

  it("returns undefined when TTML has no timed spans", () => {
    expect(convertTtmlToSyllableLyrics("<tt><body><p>No timing</p></body></tt>")).toBeUndefined();
  });

  it("ignores nested background spans when converting lead vocals", () => {
    const result = convertTtmlToSyllableLyrics(
      '<tt><body><div><p begin="00:01.000" end="00:03.000"><span begin="00:01.000" end="00:02.000">主</span><span ttm:role="x-bg" begin="00:02.000" end="00:03.000"><span begin="00:02.000" end="00:03.000">和</span></span></p></div></body></tt>'
    );

    expect(result).toEqual({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 2,
            Syllables: [
              {
                Text: "主",
                StartTime: 1,
                EndTime: 2,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });
  });

  it("ignores TTML translation and romanization spans", () => {
    const result = convertTtmlToSyllableLyrics(
      '<tt><body><div><p begin="00:01.000" end="00:02.000"><span begin="00:01.000" end="00:02.000">主</span><span ttm:role="x-translation" begin="00:01.000" end="00:02.000">translation</span><span ttm:role="x-roman" begin="00:01.000" end="00:02.000">roman</span></p></div></body></tt>'
    );

    expect(result?.Content).toEqual([
      {
        Type: "Vocal",
        OppositeAligned: false,
        Lead: {
          StartTime: 1,
          EndTime: 2,
          Syllables: [
            {
              Text: "主",
              StartTime: 1,
              EndTime: 2,
              IsPartOfWord: false
            }
          ]
        }
      }
    ]);
  });
});

describe("karaoke lyric conversion", () => {
  it("converts NetEase YRC words to Beautiful Lyrics Syllable output", () => {
    const result = convertYrcToSyllableLyrics(
      "[27710,5600](27710,520,0)窗(28230,280,0)透(28510,490,0)初"
    );

    expect(result).toEqual({
      Type: "Syllable",
      StartTime: 27.71,
      EndTime: 29,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 27.71,
            EndTime: 29,
            Syllables: [
              {
                Text: "窗",
                StartTime: 27.71,
                EndTime: 28.23,
                IsPartOfWord: true
              },
              {
                Text: "透",
                StartTime: 28.23,
                EndTime: 28.51,
                IsPartOfWord: true
              },
              {
                Text: "初",
                StartTime: 28.51,
                EndTime: 29,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });
  });

  it("preserves spaces inside NetEase YRC English lyrics", () => {
    const result = convertYrcToSyllableLyrics("[1000,1500](1000,500,0)Hello (1500,500,0)world");
    const firstLine = result?.Content[0];
    expect(firstLine?.Type).toBe("Vocal");
    if (firstLine?.Type !== "Vocal") {
      throw new Error("expected first YRC entry to be a vocal line");
    }

    expect(firstLine.Lead.Syllables.map((syllable) => syllable.Text).join("")).toBe("Hello world");
  });

  it("converts QQ QRC XML karaoke words to Beautiful Lyrics Syllable output", () => {
    const result = convertQrcXmlToSyllableLyrics(
      '<?xml version="1.0" encoding="utf-8"?><QrcInfos><LyricInfo LyricCount="1"><Lyric_1 LyricType="1" LyricContent="[1000,2000]你(1000,500)好(1500,500)&amp;apos;(2000,500)" /></LyricInfo></QrcInfos>'
    );

    expect(result?.Type).toBe("Syllable");
    expect(result?.StartTime).toBeCloseTo(1);
    const firstLine = result?.Content[0];
    expect(firstLine?.Type).toBe("Vocal");
    if (firstLine?.Type !== "Vocal") {
      throw new Error("expected first QRC entry to be a vocal line");
    }
    expect(firstLine.Lead.Syllables).toEqual([
      {
        Text: "你",
        StartTime: 1,
        EndTime: 1.5,
        IsPartOfWord: true
      },
      {
        Text: "好",
        StartTime: 1.5,
        EndTime: 2,
        IsPartOfWord: true
      },
      {
        Text: "'",
        StartTime: 2,
        EndTime: 2.5,
        IsPartOfWord: false
      }
    ]);
  });

  it("preserves spaces inside QQ QRC English lyrics", () => {
    const result = convertQrcXmlToSyllableLyrics(
      '<?xml version="1.0" encoding="utf-8"?><QrcInfos><LyricInfo LyricCount="1"><Lyric_1 LyricType="1" LyricContent="[1000,1500]Hello (1000,500)world(1500,500)" /></LyricInfo></QrcInfos>'
    );
    const firstLine = result?.Content[0];
    expect(firstLine?.Type).toBe("Vocal");
    if (firstLine?.Type !== "Vocal") {
      throw new Error("expected first QRC entry to be a vocal line");
    }

    expect(firstLine.Lead.Syllables.map((syllable) => syllable.Text).join("")).toBe("Hello world");
  });

  it("trims overlapping QQ QRC word durations", () => {
    const result = convertQrcXmlToSyllableLyrics(
      '<?xml version="1.0" encoding="utf-8"?><QrcInfos><LyricInfo LyricCount="1"><Lyric_1 LyricType="1" LyricContent="[65155,2016]现(65155,232)在(65387,280)却(65667,408)解(66075,304)不(66379,360)开(66639,532)" /></LyricInfo></QrcInfos>'
    );
    const firstLine = result?.Content[0];
    expect(firstLine?.Type).toBe("Vocal");
    if (firstLine?.Type !== "Vocal") {
      throw new Error("expected first QRC entry to be a vocal line");
    }

    expect(firstLine.Lead.Syllables.at(-2)).toEqual({
      Text: "不",
      StartTime: 66.379,
      EndTime: 66.639,
      IsPartOfWord: true
    });
    expect(firstLine.Lead.Syllables.at(-1)).toEqual({
      Text: "开",
      StartTime: 66.639,
      EndTime: 67.171,
      IsPartOfWord: false
    });
  });

});

describe("LRCLIB provider", () => {
  it("prefers synced lyrics over plain lyrics", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            id: 1,
            name: "Song",
            trackName: "Song",
            artistName: "Artist",
            albumName: "Album",
            duration: 20,
            syncedLyrics: "[00:01.00]Synced",
            plainLyrics: "Plain"
          }
        ]),
        { status: 200 }
      )
    );

    const provider = createLrclibProvider(fetchMock);
    await expect(
      provider.getLyrics({
        id: "track",
        name: "Song",
        artists: ["Artist"],
        album: "Album",
        durationSeconds: 20
      })
    ).resolves.toEqual({
      Type: "Line",
      StartTime: 1,
      EndTime: 20,
      Content: [
        {
          Type: "Vocal",
          Text: "Synced",
          StartTime: 1,
          EndTime: 20,
          OppositeAligned: false
        }
      ]
    });
  });
});

describe("Lyrically provider", () => {
  /*
  it("prefers Musixmatch word lyrics over Spotify line lyrics", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.headers).toEqual(
        expect.objectContaining({
          Accept: "application/json",
          "User-Agent": "beautiful-lyrics-reborn/1.0 (https://github.com/yeahnangua/beautiful-lyrics-reborn)"
        })
      );

      if (url.includes("/musixmatch/lyrics")) {
        expect(new URL(url).searchParams.get("id")).toBe("spotifyTrack");
        expect(new URL(url).searchParams.get("type")).toBe("word");
        expect(new URL(url).searchParams.get("format")).toBe("json");
        return new Response(JSON.stringify("[00:01.00] <00:01.00> Hello <00:01.50> world"));
      }

      return new Response("not found", { status: 404 });
    });

    const provider = createLyricallyProvider(fetchMock);
    const lyrics = await provider.getSyllableLyrics({
      id: "spotifyTrack",
      name: "Song",
      artists: ["Artist"],
      durationSeconds: 3
    });

    expect(lyrics?.Type).toBe("Syllable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  */

  it("gets Lyrically Spotify line lyrics", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/spotify/lyrics")) {
        expect(new URL(url).searchParams.get("id")).toBe("spotifyTrack");
        return new Response(JSON.stringify("[00:01.00]Line"));
      }

      return new Response("not found", { status: 404 });
    });

    const provider = createLyricallyProvider(fetchMock);
    await expect(
      provider.getLyrics({
        id: "spotifyTrack",
        name: "Song",
        artists: ["Artist"],
        durationSeconds: 3
      })
    ).resolves.toEqual({
      Type: "Line",
      StartTime: 1,
      EndTime: 3,
      Content: [
        {
          Type: "Vocal",
          Text: "Line",
          StartTime: 1,
          EndTime: 3,
          OppositeAligned: false
        }
      ]
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gets Kugou syllable and line lyrics by hash", async () => {
    let syllableRequest = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/kugou/search") {
        expect(init?.signal === undefined).toBe(syllableRequest === false);
        expect(url.searchParams.get("q")).toBe(syllableRequest ? "暖暖" : "暖暖 梁靜茹");
        return new Response(
          JSON.stringify([
            {
              hash: "d7e7a2c2b33386e834238ac7cbc3524e",
              title: "暖暖",
              artist: "梁静茹",
              duration: 243
            }
          ])
        );
      }
      if (url.pathname === "/kugou/lyrics") {
        expect(url.searchParams.get("id")).toBe("d7e7a2c2b33386e834238ac7cbc3524e");
        expect(url.searchParams.get("v")).toBe("2");
        expect(init?.signal === undefined).toBe(syllableRequest === false);
        return new Response(
          JSON.stringify({
            provider: "kugou",
            syncType: "Syllable",
            lyrics: [
              {
                text: [
                  { text: "暖", part: true, timestamp: 1000, endtime: 1500 },
                  { text: "暖", part: false, timestamp: 1500, endtime: 2000 }
                ],
                timestamp: 1000,
                endtime: 2000,
                oppositeTurn: false
              }
            ]
          })
        );
      }

      return new Response("not found", { status: 404 });
    });
    const provider = createLyricallyProvider(fetchMock);
    const track = {
      id: "spotifyTrack",
      name: "暖暖",
      artists: ["梁靜茹"],
      durationSeconds: 243
    };

    await expect(provider.getKugouLyrics(track, true)).resolves.toEqual({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 2,
            Syllables: [
              { Text: "暖", StartTime: 1, EndTime: 1.5, IsPartOfWord: true },
              { Text: "暖", StartTime: 1.5, EndTime: 2, IsPartOfWord: false }
            ]
          }
        }
      ]
    });
    syllableRequest = false;
    await expect(provider.getKugouLyrics(track, false)).resolves.toEqual({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "暖暖",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("gets NetEase syllable and line lyrics by song ID", async () => {
    let syllableRequest = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/netease/search") {
        expect(init?.signal === undefined).toBe(syllableRequest === false);
        expect(url.searchParams.get("q")).toBe(syllableRequest ? "暖暖" : "暖暖 梁靜茹");
        return new Response(
          JSON.stringify({
            result: {
              songs: [
                {
                  id: 254141,
                  name: "暖暖",
                  duration: 243160,
                  artists: [{ name: "梁静茹" }]
                }
              ]
            }
          })
        );
      }
      if (url.pathname === "/netease/lyrics") {
        expect(url.searchParams.get("id")).toBe("254141");
        expect(url.searchParams.get("v")).toBe("2");
        expect(init?.signal === undefined).toBe(syllableRequest === false);
        if (url.searchParams.get("word") === "true") {
          return new Response(
            JSON.stringify({
              provider: "netease",
              syncType: "Syllable",
              lyrics: [
                {
                  text: [
                    { text: "暖", part: true, timestamp: 1000, endtime: 1500 },
                    { text: "暖", part: false, timestamp: 1500, endtime: 2000 }
                  ],
                  timestamp: 1000,
                  endtime: 2000,
                  oppositeTurn: false
                }
              ]
            })
          );
        }

        return new Response(
          JSON.stringify({
            provider: "netease",
            syncType: "Line",
            lyrics: [],
            metadata: { rawData: { lrc: { lyric: "[00:01.00]暖暖" } } }
          })
        );
      }

      return new Response("not found", { status: 404 });
    });
    const provider = createLyricallyProvider(fetchMock);
    const track = {
      id: "spotifyTrack",
      name: "暖暖",
      artists: ["梁靜茹"],
      durationSeconds: 243
    };

    await expect(provider.getNeteaseLyrics(track, true)).resolves.toEqual({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 2,
            Syllables: [
              { Text: "暖", StartTime: 1, EndTime: 1.5, IsPartOfWord: true },
              { Text: "暖", StartTime: 1.5, EndTime: 2, IsPartOfWord: false }
            ]
          }
        }
      ]
    });
    syllableRequest = false;
    await expect(provider.getNeteaseLyrics(track, false)).resolves.toEqual({
      Type: "Line",
      StartTime: 1,
      EndTime: 243,
      Content: [
        {
          Type: "Vocal",
          Text: "暖暖",
          StartTime: 1,
          EndTime: 243,
          OppositeAligned: false
        }
      ]
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("converts Lyrically Deezer word lyrics to Syllable output", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.deezer.com/search/track")) {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 655095912,
                title: "bad guy",
                duration: 194,
                artist: { name: "Billie Eilish" }
              }
            ]
          })
        );
      }
      if (url.includes("/deezer/lyrics")) {
        expect(new URL(url).searchParams.get("id")).toBe("655095912");
        expect(new URL(url).searchParams.get("v")).toBe("2");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Response(
          JSON.stringify({
            id: "34352482",
            syncType: "Syllable",
            plain_lyrics: "White shirt now red",
            lyrics: [
              {
                text: [
                  { text: "White", timestamp: 14175, endtime: 14462 },
                  { text: "shirt", timestamp: 14637, endtime: 14937 }
                ],
                timestamp: 14175,
                endtime: 14937
              }
            ],
            isError: false
          })
        );
      }

      return new Response("not found", { status: 404 });
    });

    const provider = createLyricallyProvider(fetchMock);
    await expect(
      provider.getDeezerLyrics({
        id: "spotifyTrack",
        name: "bad guy",
        artists: ["Billie Eilish"],
        durationSeconds: 194
      })
    ).resolves.toEqual({
      Type: "Syllable",
      StartTime: 14.175,
      EndTime: 14.937,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 14.175,
            EndTime: 14.937,
            Syllables: [
              {
                Text: "White",
                StartTime: 14.175,
                EndTime: 14.462,
                IsPartOfWord: true
              },
              {
                Text: "shirt",
                StartTime: 14.637,
                EndTime: 14.937,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });
  });

  it("keeps Lyrically Deezer line lyrics as Line output", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === "api.deezer.com") {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 3602074142,
                title: "Choosin' Texas",
                duration: 190,
                artist: { name: "Ella Langley" }
              }
            ]
          })
        );
      }
      if (url.pathname === "/deezer/lyrics") {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(url.searchParams.get("id")).toBe("3602074142");
        expect(url.searchParams.get("v")).toBe("2");
        return new Response(
          JSON.stringify({
            syncType: "Line",
            lyrics: [
              {
                text: [{ text: "Just when I thought I got him to fall in love with Tennessee" }],
                timestamp: 17330,
                endtime: 23310
              }
            ],
            isError: false
          })
        );
      }

      return new Response("not found", { status: 404 });
    });

    const provider = createLyricallyProvider(fetchMock);
    await expect(
      provider.getDeezerLyrics({
        id: "spotifyTrack",
        name: "Choosin' Texas",
        artists: ["Ella Langley"],
        durationSeconds: 190
      })
    ).resolves.toEqual({
      Type: "Line",
      StartTime: 17.33,
      EndTime: 23.31,
      Content: [
        {
          Type: "Vocal",
          Text: "Just when I thought I got him to fall in love with Tennessee",
          StartTime: 17.33,
          EndTime: 23.31,
          OppositeAligned: false
        }
      ]
    });
  });

  it("tries later YouTube candidates when the first matched video has no lyrics", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/youtube/search")) {
        return new Response(
          JSON.stringify([
            {
              videoId: "bad",
              title: "客官不可以 (Remix版) (feat. 小凌)",
              author: "徐良",
              duration: "3:48"
            },
            {
              videoId: "good",
              title: "客官不可以 (feat. 小凌)",
              author: "徐良",
              duration: "3:45"
            }
          ])
        );
      }
      if (url.includes("/youtube/lyrics")) {
        const id = new URL(url).searchParams.get("id");
        if (id === "bad") {
          return new Response(JSON.stringify({ detail: "upstream failed" }), { status: 500 });
        }
        if (id === "good") {
          return new Response(JSON.stringify("[00:01.00]客官不可以"));
        }
      }

      return new Response("not found", { status: 404 });
    });

    const provider = createLyricallyProvider(fetchMock);
    await expect(
      provider.getYouTubeLyrics({
        id: "spotifyTrack",
        name: "客官不可以 - Remix版",
        artists: ["徐良", "小凌"],
        durationSeconds: 227
      })
    ).resolves.toEqual({
      Type: "Line",
      StartTime: 1,
      EndTime: 227,
      Content: [
        {
          Type: "Vocal",
          Text: "客官不可以",
          StartTime: 1,
          EndTime: 227,
          OppositeAligned: false
        }
      ]
    });
  });

  it("gets Lyrically Genius static lyrics by searching Genius", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("genius.com/api/search/song")) {
        return new Response(
          JSON.stringify({
            response: {
              sections: [
                {
                  type: "song",
                  hits: [
                    {
                      result: {
                        title: "Shape of You",
                        primary_artist_names: "Ed Sheeran",
                        url: "https://genius.com/Ed-sheeran-shape-of-you-lyrics"
                      }
                    }
                  ]
                }
              ]
            }
          })
        );
      }
      if (url.includes("/genius/lyrics")) {
        expect(new URL(url).searchParams.get("url")).toBe("https://genius.com/Ed-sheeran-shape-of-you-lyrics");
        return new Response(
          JSON.stringify({
            error: false,
            lyrics: "[Verse]\nA club isn't the best place"
          })
        );
      }

      return new Response("not found", { status: 404 });
    });

    const provider = createLyricallyProvider(fetchMock);
    await expect(
      provider.getGeniusLyrics({
        id: "spotifyTrack",
        name: "Shape of You",
        artists: ["Ed Sheeran"]
      })
    ).resolves.toEqual({
      Type: "Static",
      Lines: [{ Text: "[Verse]" }, { Text: "A club isn't the best place" }]
    });
  });
});

describe("AMLLDB provider", () => {
  it("fetches Spotify TTML lyrics and converts them to Syllable output", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        '<tt><body><div begin="00:01.000" end="00:02.000"><p begin="00:01.000" end="00:02.000"><span begin="00:01.000" end="00:02.000">你</span></p></div></body></tt>',
        { status: 200 }
      )
    );

    const provider = createAmllDbProvider(fetchMock);
    await expect(provider.getSyllableLyrics("spotifyTrack")).resolves.toEqual({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 2,
            Syllables: [
              {
                Text: "你",
                StartTime: 1,
                EndTime: 2,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://amll-ttml-db.stevexmh.net/spotify/spotifyTrack?format=ttml",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/xml, text/xml, text/plain;q=0.9"
        })
      })
    );
  });

  it("returns undefined when AMLLDB has no Spotify TTML lyrics", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));

    const provider = createAmllDbProvider(fetchMock);
    await expect(provider.getSyllableLyrics("missing")).resolves.toBeUndefined();
  });

  it("searches AMLLDB by simplified Chinese title when Spotify ID lookup misses", async () => {
    const ttml =
      '<tt><body><div begin="00:01.000" end="00:02.000"><p begin="00:01.000" end="00:02.000"><span begin="00:01.000" end="00:02.000">布</span></p></div></body></tt>';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://amll-ttml-db.stevexmh.net/spotify/spotifyTrack?format=ttml") {
        return new Response(null, { status: 404 });
      }
      if (url === "https://amlldb.bikonoo.com/api/search-lyrics") {
        return new Response(
          JSON.stringify([
            {
              title: "布拉格广场",
              titles: ["布拉格广场"],
              artist: "蔡依林",
              artists: ["蔡依林", "周杰伦"],
              file: "1721281595943-70494801-0c4077bb.ttml"
            }
          ]),
          { status: 200 }
        );
      }
      if (url === "https://amlldb.bikonoo.com/raw-lyrics/1721281595943-70494801-0c4077bb.ttml") {
        return new Response(ttml, { status: 200 });
      }

      return new Response(null, { status: 404 });
    });

    const provider = createAmllDbProvider(fetchMock);
    await expect(
      provider.getSyllableLyrics("spotifyTrack", {
        id: "spotifyTrack",
        name: "布拉格廣場",
        artists: ["蔡依林"],
        album: "看我72变"
      })
    ).resolves.toEqual({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 2,
            Syllables: [
              {
                Text: "布",
                StartTime: 1,
                EndTime: 2,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://amlldb.bikonoo.com/api/search-lyrics",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "布拉格广场", type: "title" })
      })
    );
  });

  it("tries the original title when simplified title search has no match", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://amll-ttml-db.stevexmh.net/spotify/spotifyTrack?format=ttml") {
        return new Response(null, { status: 404 });
      }
      if (url === "https://amlldb.bikonoo.com/api/search-lyrics") {
        const request = JSON.parse(String(init?.body)) as { query: string };
        if (request.query === "布拉格广场") {
          return new Response("[]", { status: 200 });
        }
        return new Response(
          JSON.stringify([
            {
              title: "布拉格廣場",
              artists: ["蔡依林"],
              file: "traditional.ttml"
            }
          ]),
          { status: 200 }
        );
      }
      if (url === "https://amlldb.bikonoo.com/raw-lyrics/traditional.ttml") {
        return new Response(
          '<tt><body><p><span begin="00:01.000" end="00:02.000">布</span></p></body></tt>',
          { status: 200 }
        );
      }

      return new Response(null, { status: 404 });
    });

    const provider = createAmllDbProvider(fetchMock);
    await expect(
      provider.getSyllableLyrics("spotifyTrack", {
        id: "spotifyTrack",
        name: "布拉格廣場",
        artists: ["蔡依林"]
      })
    ).resolves.toEqual(expect.objectContaining({ Type: "Syllable" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://amlldb.bikonoo.com/api/search-lyrics",
      expect.objectContaining({
        body: JSON.stringify({ query: "布拉格廣場", type: "title" })
      })
    );
  });
});
