import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createNeteaseProvider } from "../src/providers/netease";
import { createQqMusicProvider, decryptQrcHex } from "../src/providers/qqmusic";

const testDir = dirname(fileURLToPath(import.meta.url));
const pragueSquareQrcHex = readFileSync(join(testDir, "fixtures/qq-prague-square-qrc.hex"), "utf8").trim();

describe("NetEase provider", () => {
  it("searches with simplified title first and converts YRC lyrics", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/search/get/web")) {
        expect(new URL(url).searchParams.get("s")).toBe("布拉格广场 蔡依林");
        return new Response(
          JSON.stringify({
            code: 200,
            result: {
              songs: [
                {
                  id: 210049,
                  name: "布拉格广场",
                  artists: [{ name: "蔡依林" }, { name: "周杰伦" }],
                  album: { name: "看我72变" },
                  duration: 294600
                }
              ]
            }
          })
        );
      }

      if (url.includes("/api/song/lyric")) {
        return new Response(
          JSON.stringify({
            code: 200,
            yrc: {
              lyric: "[27710,800](27710,520,0)窗(28230,280,0)透"
            }
          })
        );
      }

      return new Response("not found", { status: 404 });
    });

    const provider = createNeteaseProvider(fetchMock as typeof fetch);
    const lyrics = await provider.getSyllableLyrics({
      id: "spotify",
      name: "布拉格廣場",
      artists: ["蔡依林", "周杰倫"],
      album: "看我72变",
      durationSeconds: 294
    });

    expect(lyrics?.Type).toBe("Syllable");
    expect(lyrics?.StartTime).toBeCloseTo(27.71);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
});
