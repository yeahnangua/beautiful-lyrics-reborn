import { expect } from "vitest";
import type { BeautifulLyrics } from "../src/types";

export function lyricContent<T extends BeautifulLyrics | undefined>(lyrics: T): T {
  if (!lyrics) return lyrics;
  const { Source: _source, RequestId: _id, RetrievedAt: _time, LyricsHash: _hash, ...content } = lyrics;
  return content as T;
}
export const contentEqual = (expected: BeautifulLyrics | undefined) => ({
  asymmetricMatch: (actual: BeautifulLyrics | undefined) => {
    if (expected?.Source) expect(actual?.Source).toEqual(expected.Source);
    expect(lyricContent(actual)).toEqual(lyricContent(expected));
    return true;
  },
  toString: () => "LyricsContent",
  getExpectedType: () => "object"
});
