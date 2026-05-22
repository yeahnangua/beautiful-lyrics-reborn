import OpenCC from "opencc-js";
import { convertTtmlToSyllableLyrics } from "../convert/ttml";
import type { AmllDbProvider, SyllableSyncedLyrics, TrackMetadata } from "../types";

type FetchLike = typeof fetch;

type AmllDbSearchResult = {
  title?: string;
  titles?: string[];
  artist?: string;
  artists?: string[];
  file?: string;
};

const amllDbSpotifyBaseUrl = "https://amll-ttml-db.stevexmh.net/spotify";
const amllDbSearchUrl = "https://amlldb.bikonoo.com/api/search-lyrics";
const amllDbRawLyricsBaseUrl = "https://amlldb.bikonoo.com/raw-lyrics";
const traditionalToSimplified = OpenCC.Converter({ from: "tw", to: "cn" });

function buildSpotifyTtmlUrl(trackId: string): string {
  return `${amllDbSpotifyBaseUrl}/${encodeURIComponent(trackId)}?format=ttml`;
}

function buildRawLyricsUrl(file: string): string {
  return `${amllDbRawLyricsBaseUrl}/${encodeURIComponent(file)}`;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function normalized(value: string): string {
  return traditionalToSimplified(value).toLocaleLowerCase();
}

function includesNormalized(values: string[] | undefined, expectedValues: string[]): boolean {
  if (values === undefined || expectedValues.length === 0) {
    return true;
  }

  const normalizedValues = values.map(normalized);
  return expectedValues.some((expected) => normalizedValues.includes(normalized(expected)));
}

function matchesTrack(result: AmllDbSearchResult, track: TrackMetadata): boolean {
  const resultTitles = uniqueValues([result.title ?? "", ...(result.titles ?? [])]);
  const resultArtists = uniqueValues([result.artist ?? "", ...(result.artists ?? [])]);

  if (includesNormalized(resultTitles, [track.name]) === false) {
    return false;
  }

  return includesNormalized(resultArtists, track.artists);
}

async function fetchTtml(fetchImpl: FetchLike, url: string): Promise<SyllableSyncedLyrics | undefined> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/xml, text/xml, text/plain;q=0.9",
      "User-Agent": "beautiful-lyrics-server/1.0"
    }
  });

  if (response.ok === false) {
    return undefined;
  }

  return convertTtmlToSyllableLyrics(await response.text());
}

async function searchByTitle(fetchImpl: FetchLike, query: string): Promise<AmllDbSearchResult[]> {
  const response = await fetchImpl(amllDbSearchUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "beautiful-lyrics-server/1.0"
    },
    body: JSON.stringify({ query, type: "title" })
  });

  if (response.ok === false) {
    return [];
  }

  return (await response.json()) as AmllDbSearchResult[];
}

async function getLyricsBySearch(fetchImpl: FetchLike, track: TrackMetadata): Promise<SyllableSyncedLyrics | undefined> {
  const simplifiedTitle = traditionalToSimplified(track.name);
  const queries = uniqueValues([simplifiedTitle, track.name]);

  for (const query of queries) {
    const results = await searchByTitle(fetchImpl, query);
    const matchedResult = results.find((result) => result.file !== undefined && matchesTrack(result, track));
    if (matchedResult?.file === undefined) {
      continue;
    }

    const lyrics = await fetchTtml(fetchImpl, buildRawLyricsUrl(matchedResult.file));
    if (lyrics !== undefined) {
      return lyrics;
    }
  }

  return undefined;
}

export function createAmllDbProvider(fetchImpl: FetchLike = fetch): AmllDbProvider {
  return {
    async getSyllableLyrics(trackId: string, track?: TrackMetadata): Promise<SyllableSyncedLyrics | undefined> {
      const spotifyLyrics = await fetchTtml(fetchImpl, buildSpotifyTtmlUrl(trackId));
      if (spotifyLyrics !== undefined) {
        return spotifyLyrics;
      }

      return track === undefined ? undefined : getLyricsBySearch(fetchImpl, track);
    }
  };
}

export const amllDbProvider = createAmllDbProvider();
