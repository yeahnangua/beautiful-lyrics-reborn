import type { BeautifulLyrics } from "../types";

// Keep search metadata off the public lyrics JSON while the service chooses a source.
const matchedTitles = new WeakMap<BeautifulLyrics, string>();

export function withMatchedTitle<T extends BeautifulLyrics | undefined>(lyrics: T, title: string | undefined): T {
  if (lyrics !== undefined && title !== undefined) {
    matchedTitles.set(lyrics, title);
  }
  return lyrics;
}

export function matchedTitle(lyrics: BeautifulLyrics): string | undefined {
  return matchedTitles.get(lyrics);
}
