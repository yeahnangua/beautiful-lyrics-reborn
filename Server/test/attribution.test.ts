import { describe, it, expect, vi } from "vitest";
import { appendAttributionLyric } from "../src/attribution";
import { createWorker } from "../src/index";
import type { BeautifulLyrics } from "../src/types";

const Attribution = { provider: "spicylyrics" as const, source: "spicy_lyrics",
  uploader: { id: "1", username: "Uploader", url: "https://spicylyrics.org/uid/1" },
  maker: { id: "2", username: "Maker", url: "https://spicylyrics.org/uid/2" } };
const text = "Lyrics via spicylyrics · 🔗 Uploader / 🔗 Maker";
const line: BeautifulLyrics = { Type: "Line", StartTime: 1, EndTime: 240, Attribution,
  Content: [{ Type: "Vocal", Text: "last sung lyric", StartTime: 230, EndTime: 240, OppositeAligned: false }] };
const syllable: BeautifulLyrics = { Type: "Syllable", StartTime: 1, EndTime: 240, Attribution,
  Content: [{ Type: "Vocal", OppositeAligned: false, Lead: { StartTime: 230, EndTime: 240,
    Syllables: [{ Text: "last sung lyric", StartTime: 230, EndTime: 240, IsPartOfWord: false }] } }] };

describe("attribution as the final lyric", () => {
  for (const original of [line, syllable]) it(`${original.Type} uses precise track duration, not the end of singing`, () => {
    const snapshot = structuredClone(original);
    const result = appendAttributionLyric(original, 265.437);
    expect(result.Type).toBe(original.Type);
    if (result.Type === "Static") throw new Error("Expected timed lyrics");
    const last = result.Content.at(-1)!;
    expect(last).toMatchObject({ Type: "Vocal", IsAttribution: true, OppositeAligned: false });
    if (last.Type !== "Vocal") throw new Error("Expected vocal");
    const timing = "Lead" in last ? last.Lead : last;
    expect(timing.StartTime).toBeCloseTo(265.337, 6);
    expect(timing.EndTime).toBe(265.437);
    expect("Lead" in last ? last.Lead.Syllables[0]!.Text : last.Text).toBe(text);
    expect(result.EndTime).toBe(265.437);
    expect(result.Content[0]).toEqual(snapshot.Content[0]);
    expect(original).toEqual(snapshot);
    expect(appendAttributionLyric(result, 265.437)).toEqual(result);
  });
  it("preserves static lyrics and appends just one ordinary text line", () => {
    const input: BeautifulLyrics = { Type: "Static", Lines: [{ Text: "untimed" }], Attribution };
    const result = appendAttributionLyric(input, 10);
    expect(result).toMatchObject({ Type: "Static", Lines: [{ Text: "untimed" }, { Text: text, IsAttribution: true }] });
    expect(appendAttributionLyric(result, 10)).toEqual(result);
    expect(input.Lines).toHaveLength(1);
  });
  it("uses provider-only text for commercial sources, without inventing a contributor", () => {
    const result = appendAttributionLyric({ ...line, Attribution: { provider: "spicylyrics", source: "apple_music" } }, 265);
    expect(result).toMatchObject({ Content: [expect.anything(), { Text: "Lyrics via spicylyrics" }] });
  });
  it("leaves other providers untouched and handles absent/invalid duration and very short tracks", () => {
    const { Attribution: _attribution, ...plain } = line;
    expect(appendAttributionLyric(plain, 265)).toBe(plain);
    for (const duration of [undefined, NaN, Infinity, 0, -1]) {
      expect(appendAttributionLyric(line, duration)).toMatchObject({ Content: [expect.anything(), { StartTime: 239.9, EndTime: 240 }] });
    }
    expect(appendAttributionLyric(line, 0.05)).toMatchObject({ Content: [expect.anything(), { StartTime: 0, EndTime: 0.05 }] });
  });
  it("Worker inserts the line in its JSON response without mutating a reusable provider result", async () => {
    const getLyrics = vi.fn().mockResolvedValue(structuredClone(line));
    const worker = createWorker({ getLyrics });
    for (const duration of [265.437, 266.12]) {
      const request = new Request(`https://lyrics.test/lyrics/track?track_name=Song&artist_name=Artist&duration=${duration}`,
        { headers: { Authorization: "Bearer test" } });
      const response = await worker.fetch!(request as never, {}, {} as ExecutionContext);
      const result = await response.json() as BeautifulLyrics;
      expect(result).toMatchObject({ Content: [expect.anything(), { IsAttribution: true, EndTime: duration }] });
    }
    expect((await getLyrics()).Content).toHaveLength(1);
  });
});
