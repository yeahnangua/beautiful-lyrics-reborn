import { describe, expect, it } from "vitest";
import { convertQrcXmlToSyllableLyrics, convertYrcToSyllableLyrics } from "../src/convert/karaoke";
import { convertKrcToSyllableLyrics } from "../src/convert/krc";
import type { SyllableSyncedLyrics } from "../src/types";

type Token = { text: string; start: number; duration: number };
const token = (text: string, start: number, duration = 0): Token => ({ text, start, duration });
const xml = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const formats: Array<[string, (words: Token[]) => SyllableSyncedLyrics | undefined]> = [
  ["QRC", (words) => convertQrcXmlToSyllableLyrics(
    `<Lyric_1 LyricContent="[1000,9000]${xml(words.map(w => `${w.text}(${w.start},${w.duration})`).join(""))}" />`)],
  ["KRC", (words) => convertKrcToSyllableLyrics(
    `[1000,9000]${words.map(w => `<${w.start - 1000},${w.duration},0>${xml(w.text)}`).join("")}`)],
  ["YRC", (words) => convertYrcToSyllableLyrics(
    `[1000,9000]${words.map(w => `(${w.start},${w.duration},0)${w.text}`).join("")}`)]
];

function syllablesFor(lyrics: SyllableSyncedLyrics | undefined) {
  const line = lyrics?.Content[0];
  expect(line?.Type).toBe("Vocal");
  if (line?.Type !== "Vocal") throw new Error("Expected a vocal line");
  return line.Lead.Syllables;
}

function render(lyrics: SyllableSyncedLyrics | undefined): string {
  return syllablesFor(lyrics).map((word, index, words) =>
    (index > 0 && !words[index - 1]!.IsPartOfWord ? " " : "") + word.Text).join("");
}

describe.each(formats)("%s karaoke word boundaries", (_format, convert) => {
  it("preserves separate zero-duration spaces without changing sung timings", () => {
    const result = convert([
      token("to", 1812, 140), token(" ", 1952), token("spend", 1952, 400),
      token(" ", 2352), token("a", 2352, 90), token(" ", 2442), token("moment", 2442, 480)
    ]);
    expect(render(result)).toBe("to spend a moment");
    expect(syllablesFor(result)).toEqual([
      { Text: "to", StartTime: 1.812, EndTime: 1.952, IsPartOfWord: false },
      { Text: "spend", StartTime: 1.952, EndTime: 2.352, IsPartOfWord: false },
      { Text: "a", StartTime: 2.352, EndTime: 2.442, IsPartOfWord: false },
      { Text: "moment", StartTime: 2.442, EndTime: 2.922, IsPartOfWord: false }
    ]);
  });

  it.each([
    ["attached spaces", [token("Hello ", 1000, 300), token("world", 1500, 500)], "Hello world"],
    ["leading spaces", [token("Hello", 1000, 300), token(" world", 1500, 500)], "Hello world"],
    ["consecutive whitespace", [token("Hello", 1000, 300), token(" ", 1300), token("\t", 1300), token(" ", 1300), token("world", 1500, 500)], "Hello world"],
    ["nonbreaking spaces", [token("Hello", 1000, 300), token("\u00a0", 1300), token("world", 1500, 500)], "Hello world"],
    ["positive-duration spaces", [token("Hello", 1000, 700), token(" ", 1300, 100), token("world", 1500, 500)], "Hello world"],
    ["split syllables", [token("Hel", 1000, 300), token("lo", 1500, 500)], "Hello"],
    ["continuous Chinese", [token("你", 1000, 300), token("好", 1500, 500)], "你好"],
    ["explicit Chinese spaces", [token("你", 1000, 300), token(" ", 1300), token("好", 1500, 500)], "你 好"],
    ["mixed scripts", [token("你", 1000, 300), token("好 ", 1300, 200), token("world", 1500, 500)], "你好 world"],
    ["zero-duration punctuation", [token("Hello", 1000, 300), token(",", 1300), token(" ", 1300), token("world", 1500, 500), token("!", 2000)], "Hello, world!"],
    ["opening punctuation", [token('"', 1000), token("Hello", 1000, 300), token('"', 1300), token(" ", 1300), token("(", 1500), token("world", 1500, 500), token(")", 2000)], '"Hello" (world)'],
    ["contractions", [token("can", 1000, 300), token("'", 1300), token("t", 1500, 500)], "can't"],
    ["zero-duration letters", [token("can", 1000, 300), token("not", 1300), token(" ", 1300), token("wait", 1500, 500)], "cannot wait"],
    ["line padding", [token(" ", 1000), token("Hello", 1000, 300), token(" ", 1300), token("world", 1500, 500), token(" ", 2000)], "Hello world"]
  ] as Array<[string, Token[], string]>)("keeps %s", (_name, tokens, expected) => {
    const result = convert(tokens);
    expect(render(result)).toBe(expected);
    expect(syllablesFor(result).every(word => word.Text.trim() && word.EndTime > word.StartTime)).toBe(true);
    expect(syllablesFor(result).at(-1)?.IsPartOfWord).toBe(false);
  });

  it("clips overlapping timings while ignoring zero-duration separators for timing", () => {
    const result = convert([token("first", 1000, 1000), token(" ", 1200), token("last", 1500, 500)]);
    expect(render(result)).toBe("first last");
    expect(syllablesFor(result).map(w => [w.StartTime, w.EndTime])).toEqual([[1, 1.5], [1.5, 2]]);
  });

  it("keeps opening punctuation with the next word after a separator", () => {
    for (const words of [
      [token("Hello", 1000, 300), token(" ", 1300), token("(", 1300), token("world", 1500, 500), token(")", 2000)],
      [token("Hello ", 1000, 300), token("(", 1300), token("world", 1500, 500), token(")", 2000)]
    ]) {
      expect(syllablesFor(convert(words))).toEqual([
        { Text: "Hello", StartTime: 1, EndTime: 1.3, IsPartOfWord: false },
        { Text: "(world)", StartTime: 1.5, EndTime: 2, IsPartOfWord: false }
      ]);
    }
  });

  it("does not manufacture timed vocals from wholly untimed text", () => {
    expect(convert([token(" ", 1000), token("word", 1000), token("!", 1000)])).toBeUndefined();
    expect(convert([token(" ", 1000, 300)])).toBeUndefined();
  });

  it("round-trips source text and boundaries across combinations of separators", () => {
    for (const left of ["", " ", ", ", "'", "; ", "—"]) {
      for (const right of ["", " ", ". ", "'", ": ", "—"]) {
        for (const duration of [0, 50]) {
          const tokens = [token("Hel", 1000, 200), token(left, 1200, duration),
            token("lo", 1300, 200), token(right, 1500, duration), token("world", 1600, 400)];
          expect(render(convert(tokens))).toBe(tokens.map(w => w.text).join(""));
        }
      }
    }
  });
});
