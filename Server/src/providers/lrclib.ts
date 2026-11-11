import { withSource, recordMatch } from "./matched-title";
import { contextFetch, getFetchContext, recordUpstreamResult } from "./request";
import { convertLrcToLineLyrics } from "../convert/lrc";
import { convertPlainTextToStatic } from "../convert/plain";
import type { BeautifulLyrics, LrclibProvider, TrackMetadata } from "../types";

type FetchLike = typeof fetch;

type LrclibRecord = {
  id: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

const lrclibSearchUrl = "https://lrclib.net/api/search";

function firstArtist(track: TrackMetadata): string {
  return track.artists[0] ?? "";
}

function buildSearchUrl(track: TrackMetadata): string {
  const url = new URL(lrclibSearchUrl);
  url.searchParams.set("track_name", track.name);
  url.searchParams.set("artist_name", firstArtist(track));

  if (track.album !== undefined && track.album.length > 0) {
    url.searchParams.set("album_name", track.album);
  }

  if (track.durationSeconds !== undefined) {
    url.searchParams.set("duration", String(Math.round(track.durationSeconds)));
  }

  return url.toString();
}

function convertRecord(record: LrclibRecord, durationSeconds?: number): BeautifulLyrics | undefined {
  return (
    convertLrcToLineLyrics(record.syncedLyrics, durationSeconds ?? record.duration) ??
    convertPlainTextToStatic(record.plainLyrics)
  );
}

function createLrclibProviderImplementation(fetchImpl: FetchLike = fetch): LrclibProvider {
  return {
    async getLyrics(track: TrackMetadata): Promise<BeautifulLyrics | undefined> {
      if (track.name.length === 0 || firstArtist(track).length === 0) {
        return undefined;
      }

      const response = await fetchImpl(buildSearchUrl(track), {
        headers: {
          Accept: "application/json",
          "User-Agent": "beautiful-lyrics-server/1.0"
        }
      });
      const context = getFetchContext(fetchImpl);
      recordUpstreamResult(context, { operation: "search", query: `${track.name} ${firstArtist(track)}` });

      if (response.ok === false) {
        recordUpstreamResult(context, { result: "http_error" });
        return undefined;
      }

      let records: LrclibRecord[];
      try { records = (await response.json()) as LrclibRecord[]; }
      catch (error) {
        recordUpstreamResult(context, { result: "invalid_payload" });
        throw error;
      }
      if (!Array.isArray(records)) {
        recordUpstreamResult(context, { result: "invalid_payload" });
        return undefined;
      }
      recordUpstreamResult(context, { resultCount: records.length, result: records.length > 0 ? "matched" : "no_results" });
      for (const record of records) {
        const source = { Provider: "lrclib", Transport: "direct", TrackId: String(record.id), ...(record.trackName ? { MatchedTitle: record.trackName } : {}) } as const;
        recordMatch(getFetchContext(fetchImpl), source);
        const lyrics = convertRecord(record, track.durationSeconds);
        if (lyrics !== undefined) {
          recordUpstreamResult(context, { result: "found" });
          return withSource(lyrics, source);
        }
      }
      if (records.length > 0) recordUpstreamResult(context, { result: "no_lyrics" });
      return undefined;
    }
  };
}

export const lrclibProvider = createLrclibProvider();

export function createLrclibProvider(fetchImpl: typeof fetch = fetch): LrclibProvider {
  return {
    getLyrics: (track, context) => createLrclibProviderImplementation(contextFetch(fetchImpl, context)).getLyrics(track, context),
  };
}
