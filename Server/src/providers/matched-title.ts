import type { BeautifulLyrics, LyricsSource, RequestContext } from "../types";

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

// Only public identifiers are accepted here; never pass a URL or access credentials.
export function withSource<T extends BeautifulLyrics | undefined>(lyrics: T, source: LyricsSource): T {
  if (lyrics !== undefined) {
    lyrics.Source = source;
    if (source.MatchedTitle !== undefined) matchedTitles.set(lyrics, source.MatchedTitle);
  }
  return lyrics;
}

export function recordMatch(context: RequestContext | undefined, source: LyricsSource): void {
  if (context?.trace) (context.trace.matches ??= []).push(source);
}
