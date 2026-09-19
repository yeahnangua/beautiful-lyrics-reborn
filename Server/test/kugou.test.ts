import { describe, expect, it, vi } from "vitest";
import { convertKrcToSyllableLyrics, decodeKrc } from "../src/convert/krc";
import { createKugouProvider } from "../src/providers/kugou";
import type { TrackMetadata } from "../src/types";

// Synthetic lyrics encoded independently with Python's zlib implementation.
const krc = "[ti:Test]\n[10000,2000]<0,300,0>Hel<300,400,0>lo <1000,500,0>world\n[20000,1000]<0,400,0>测<500,500,0>试";
const encodedKrc = "a3JjMTjb6lmXhn4OfBi4yETkWmlCWkJXT1kX5zI6VTYWq8qPmMc5UT5sOvnTO3m4QPv2Mt4Y9eScJxlDh1E5+MmDlwUr8OxeAtP/sgI3VtXVqg==";
const encodedLineOnly = "a3JjMTjb6kFugkZ3hQUBpTsboiIVj6689zZ0dkQznQ==";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const track: TrackMetadata = { id: "track", name: "範例歌曲", artists: ["範例歌手"], durationSeconds: 180 };
const candidate = {
  id: "1", accesskey: "test-key", song: "范例歌曲", singer: "范例歌手",
  duration: 180000, score: 50, product_from: "官方推荐歌词"
};

describe("KuGou KRC conversion", () => {
  it("decodes base64, XOR and zlib while preserving UTF-8 text", async () => {
    expect(await decodeKrc(encodedKrc)).toBe(krc);
  });

  it.each([undefined, "", "invalid base64!", "YWJjZA==", "a3JjMQ==", "a3JjMQAAAA=="])(
    "ignores missing or corrupt KRC data (%s)", async (content) => {
      expect(await decodeKrc(content)).toBeUndefined();
    }
  );

  it("adds each line's start to word offsets and preserves gaps and word boundaries", () => {
    expect(convertKrcToSyllableLyrics(krc)).toEqual({
      Type: "Syllable", StartTime: 10, EndTime: 21,
      Content: [
        {
          Type: "Vocal", OppositeAligned: false,
          Lead: {
            StartTime: 10, EndTime: 11.5,
            Syllables: [
              { Text: "Hel", StartTime: 10, EndTime: 10.3, IsPartOfWord: true },
              { Text: "lo", StartTime: 10.3, EndTime: 10.7, IsPartOfWord: false },
              { Text: "world", StartTime: 11, EndTime: 11.5, IsPartOfWord: false }
            ]
          }
        },
        {
          Type: "Vocal", OppositeAligned: false,
          Lead: {
            StartTime: 20, EndTime: 21,
            Syllables: [
              { Text: "测", StartTime: 20, EndTime: 20.4, IsPartOfWord: true },
              { Text: "试", StartTime: 20.5, EndTime: 21, IsPartOfWord: false }
            ]
          }
        }
      ]
    });
  });

  it("decodes entities, handles whitespace tokens and keeps overlapping line ends", () => {
    const lyrics = convertKrcToSyllableLyrics(
      "[4000,1000]<0,1000,0>Overlap\n[1000,9000]<0,1500,0>A&amp;B<500,200,0> <2000,7000,0>last"
    );
    expect(lyrics).toMatchObject({ StartTime: 1, EndTime: 10, Content: [
      { Lead: { Syllables: [
        { Text: "A&B", StartTime: 1, EndTime: 1.5, IsPartOfWord: false },
        { Text: "last", StartTime: 3, EndTime: 10, IsPartOfWord: false }
      ] } },
      { Lead: { StartTime: 4, EndTime: 5 } }
    ] });
  });

  it.each([undefined, "", "[ti:Metadata]", "[00:01.00]Line only", "[1000,1000]Untimed text", "[1000,1000]<0,0,0>Invalid"])(
    "does not promote untimed or invalid data to word lyrics (%s)", (content) => {
      expect(convertKrcToSyllableLyrics(content)).toBeUndefined();
    }
  );
});

describe("KuGou direct provider", () => {
  it("validates title, artists and duration, then downloads the closest matching KRC", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(url.protocol).toBe("https:");
      if (url.pathname === "/search") {
        expect(url.hostname).toBe("krcs.kugou.com");
        expect(url.searchParams.get("keyword")).toBe("范例歌手 - 范例歌曲");
        expect(url.searchParams.get("duration")).toBe("180000");
        return json({ status: 200, candidates: [
          null,
          { ...candidate, id: "unverified", product_from: "ugc" },
          { ...candidate, id: "live", song: "范例歌曲 (Live)" },
          { ...candidate, id: "cover", singer: "其他歌手" },
          { ...candidate, id: "other-version", duration: 210000 },
          { ...candidate, id: "further", duration: 184000, score: 100 },
          { ...candidate, id: "lower-score", score: 20 },
          { ...candidate, id: "best", singer: "范例歌手、另一歌手" }
        ] });
      }
      expect(url.hostname).toBe("lyrics.kugou.com");
      expect(url.pathname).toBe("/download");
      expect(url.searchParams.get("id")).toBe("best");
      expect(url.searchParams.get("accesskey")).toBe("test-key");
      expect(url.searchParams.get("fmt")).toBe("krc");
      return json({ status: 200, content: encodedKrc });
    });
    const lyrics = await createKugouProvider(fetchMock as typeof fetch).getSyllableLyrics(track);
    expect(lyrics).toEqual(convertKrcToSyllableLyrics(krc));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tries other matching candidates after a corrupt file or line-only lyrics", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ status: 200, candidates: [
        candidate, { ...candidate, id: "2" }, { ...candidate, id: "3" }
      ] }))
      .mockResolvedValueOnce(json({ status: 200, content: "invalid" }))
      .mockResolvedValueOnce(json({ status: 200, content: encodedLineOnly }))
      .mockResolvedValueOnce(json({ status: 200, content: encodedKrc }));
    expect((await createKugouProvider(fetchMock as typeof fetch).getSyllableLyrics(track))?.Type).toBe("Syllable");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([{ status: 503 }, { status: 200, candidates: [] }, { status: 200, candidates: {} }])(
    "stops after a failed or empty search", async (search) => {
      const fetchMock = vi.fn().mockResolvedValue(json(search));
      expect(await createKugouProvider(fetchMock as typeof fetch).getSyllableLyrics(track)).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it("bounds failed downloads to three matching candidates", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ status: 200, candidates: Array.from({ length: 5 }, (_, i) => ({ ...candidate, id: String(i) })) }))
      .mockImplementation(async () => json({ status: 404 }));
    expect(await createKugouProvider(fetchMock as typeof fetch).getSyllableLyrics(track)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("skips requests without a title or artist", async () => {
    const fetchMock = vi.fn();
    const provider = createKugouProvider(fetchMock as typeof fetch);
    expect(await provider.getSyllableLyrics({ id: "id", name: "", artists: ["Artist"] })).toBeUndefined();
    expect(await provider.getSyllableLyrics({ id: "id", name: "Title", artists: [] })).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
