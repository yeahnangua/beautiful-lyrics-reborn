import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createQqMusicProvider, decryptQrcHex } from "../src/providers/qqmusic";
import { withLyricRequestRetries } from "../src/providers/request";

const testDir = dirname(fileURLToPath(import.meta.url));
const pragueSquareQrcHex = readFileSync(join(testDir, "fixtures/qq-prague-square-qrc.hex"), "utf8").trim();

describe("lyric request retries", () => {
  it("aborts each stalled request and retries at most twice", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const signals: AbortSignal[] = [];
      const request = vi.fn((signal: AbortSignal) => {
        signals.push(signal);
        return new Promise<never>(() => {});
      });
      const result = withLyricRequestRetries(request, "test lyrics");
      const rejection = expect(result).rejects.toThrow("timed out after 5 seconds");

      await vi.advanceTimersByTimeAsync(15_000);
      await rejection;

      expect(request).toHaveBeenCalledTimes(3);
      expect(signals).toHaveLength(3);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("QQ Music provider", () => {
  it("decrypts QQ QRC hex into XML lyrics", () => {
    const xml = decryptQrcHex(pragueSquareQrcHex);

    expect(xml).toContain("<QrcInfos>");
    expect(xml).toContain("[ti:布拉格广场]");
  });

  it("searches with simplified title first and converts QRC lyrics", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const request = body.req ?? body["music.musichallSong.PlayLyricInfo.GetPlayLyricInfo"];

      if (request?.method === "DoSearchForQQMusicDesktop") {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(request.param.query).toBe("布拉格广场 蔡依林");
        return new Response(
          JSON.stringify({
            req: {
              data: {
                body: {
                  song: {
                    list: [
                      {
                        mid: "002QoT9n3hcEIr",
                        id: 13410,
                        title: "布拉格广场",
                        singer: [{ name: "蔡依林" }, { name: "周杰伦" }],
                        album: { name: "看我72变" },
                        interval: 294
                      }
                    ]
                  }
                }
              }
            }
          })
        );
      }

      if (request?.method === "GetPlayLyricInfo") {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(request.param.songID).toBe(13410);
        return new Response(
          JSON.stringify({
            "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo": {
              data: {
                qrc: 1,
                lyric: pragueSquareQrcHex
              }
            }
          })
        );
      }

      return new Response("not found", { status: 404 });
    });

    const provider = createQqMusicProvider(fetchMock as typeof fetch);
    const lyrics = await provider.getSyllableLyrics({
      id: "spotify",
      name: "布拉格廣場",
      artists: ["蔡依林", "周杰倫"],
      album: "看我72变",
      durationSeconds: 294
    });

    expect(lyrics?.Type).toBe("Syllable");
    expect(lyrics?.StartTime).toBeCloseTo(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("logs search results", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const request = body.req ?? body["music.musichallSong.PlayLyricInfo.GetPlayLyricInfo"];

      if (request?.method === "DoSearchForQQMusicDesktop") {
        return new Response(
          JSON.stringify({
            req: {
              data: {
                body: {
                  song: {
                    list: [
                      {
                        mid: "002QoT9n3hcEIr",
                        id: 13410,
                        title: "布拉格广场",
                        singer: [{ name: "蔡依林" }, { name: "周杰伦" }],
                        album: { name: "看我72变" },
                        interval: 294
                      }
                    ]
                  }
                }
              }
            }
          })
        );
      }

      return new Response("not found", { status: 404 });
    });

    const provider = createQqMusicProvider(fetchMock as typeof fetch);
    await provider.getSyllableLyrics({
      id: "spotify",
      name: "布拉格廣場",
      artists: ["蔡依林", "周杰倫"],
      album: "看我72变",
      durationSeconds: 294
    });

    expect(logSpy).toHaveBeenCalledWith(
      '[qqmusic] search "布拉格广场 蔡依林": 1 result(s): 13410 "布拉格广场" by 蔡依林, 周杰伦 (294s)'
    );

    logSpy.mockRestore();
  });

  it("matches titles when language tags use different punctuation", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const request = body.req ?? body["music.musichallSong.PlayLyricInfo.GetPlayLyricInfo"];

      if (request?.method === "DoSearchForQQMusicDesktop") {
        expect(request.param.query).toBe("暗里着迷 - 粤 刘德华");
        return new Response(
          JSON.stringify({
            req: {
              data: {
                body: {
                  song: {
                    list: [
                      {
                        mid: "003WqUqG1LnoEe",
                        id: 102209103,
                        title: "暗里着迷 (粤)",
                        singer: [{ name: "刘德华" }],
                        album: { name: "答案就是你" },
                        interval: 230
                      },
                      {
                        mid: "000RadioEdit",
                        id: 153424,
                        title: "暗里着迷 (Radio Edit)",
                        singer: [{ name: "刘德华" }],
                        album: { name: "答案就是你" },
                        interval: 229
                      }
                    ]
                  }
                }
              }
            }
          })
        );
      }

      if (request?.method === "GetPlayLyricInfo") {
        expect(request.param.songID).toBe(102209103);
        return new Response(
          JSON.stringify({
            "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo": {
              data: {
                qrc: 1,
                lyric: pragueSquareQrcHex
              }
            }
          })
        );
      }

      return new Response("not found", { status: 404 });
    });

    const provider = createQqMusicProvider(fetchMock as typeof fetch);
    const lyrics = await provider.getSyllableLyrics({
      id: "spotify",
      name: "暗裡著迷 - 粵",
      artists: ["劉德華"],
      album: "答案就是你",
      durationSeconds: 229
    });

    expect(lyrics?.Type).toBe("Syllable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("matches the first search result by duration tolerance when metadata names differ", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const request = body.req ?? body["music.musichallSong.PlayLyricInfo.GetPlayLyricInfo"];

      if (request?.method === "DoSearchForQQMusicDesktop") {
        return new Response(
          JSON.stringify({
            req: {
              data: {
                body: {
                  song: {
                    list: [
                      {
                        mid: "004Honjitsu",
                        id: 392699857,
                        title: "Honjitsu Wa Diamond - Karaoke",
                        singer: [{ name: "Kazuma Kiryu(Takaya Kuroda)" }],
                        album: { name: "YAKUZA 6: THE SONG OF LIFE ORIGINAL SOUNDTRACK" },
                        interval: 107
                      },
                      {
                        mid: "004MachineGun",
                        id: 4982774,
                        title: "MachineGun Kiss (Full Swing Edition)",
                        singer: [{ name: "黑田崇矢" }],
                        interval: 270
                      }
                    ]
                  }
                }
              }
            }
          })
        );
      }

      if (request?.method === "GetPlayLyricInfo") {
        expect(request.param.songID).toBe(392699857);
        return new Response(
          JSON.stringify({
            "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo": {
              data: {
                qrc: 1,
                lyric: pragueSquareQrcHex
              }
            }
          })
        );
      }

      return new Response("not found", { status: 404 });
    });

    const provider = createQqMusicProvider(fetchMock as typeof fetch);
    const lyrics = await provider.getSyllableLyrics({
      id: "spotify",
      name: "Honjitsu Wa Diamond",
      artists: ["桐生一馬(黒田崇矢)"],
      album: "YAKUZA 6: THE SONG OF LIFE ORIGINAL SOUNDTRACK",
      durationSeconds: 106
    });

    expect(lyrics?.Type).toBe("Syllable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
