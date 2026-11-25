import { withSource, recordMatch } from "./matched-title";
import { contextFetch, getFetchContext, recordUpstreamResult } from "./request";
import { convertLrcToLineLyrics } from "../convert/lrc";
import { convertPlainTextToStatic } from "../convert/plain";
import type { BeautifulLyrics, LrclibProvider, TrackMetadata } from "../types";
import { simplifyChinese } from "../text-normalization";

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
const normalize = (text: string) => simplifyChinese(text).normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
function matches(record: LrclibRecord, track: TrackMetadata): boolean {
  if (!Number.isSafeInteger(record?.id) || record.id <= 0 || typeof record.trackName !== "string" || typeof record.artistName !== "string") return false;
  if (normalize(record.trackName) !== normalize(track.name)) return false;
  const artists = [record.artistName, ...record.artistName.split(/[、,，;；&/＋+]|(?:\s+(?:feat|ft|with)\.?\s+)/i)].map(normalize).filter(Boolean);
  if (!track.artists.some(artist => artists.includes(normalize(artist)))) return false;
  return track.durationSeconds === undefined || (Number.isFinite(record.duration) && record.duration! > 0 && Math.abs(record.duration! - track.durationSeconds) <= 5);
}

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
      const candidates = records.filter(record => matches(record, track));
      candidates.sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics)
        || Number(normalize(b.albumName ?? "") === normalize(track.album ?? "")) - Number(normalize(a.albumName ?? "") === normalize(track.album ?? ""))
        || Math.abs((a.duration ?? 0) - (track.durationSeconds ?? 0)) - Math.abs((b.duration ?? 0) - (track.durationSeconds ?? 0)));
      recordUpstreamResult(context, { resultCount: records.length, matchedCount: candidates.length, result: candidates.length ? "matched" : records.length ? "no_match" : "no_results" });
      let fallback: BeautifulLyrics | undefined;
      for (const record of candidates) {
        const source = { Provider: "lrclib", Transport: "direct", TrackId: String(record.id), ...(record.trackName ? { MatchedTitle: record.trackName } : {}) } as const;
        recordMatch(getFetchContext(fetchImpl), source);
        const lyrics = convertRecord(record, track.durationSeconds);
        if (lyrics !== undefined) {
          recordUpstreamResult(context, { result: "found" });
          if (lyrics.Type !== "Static") return withSource(lyrics, source);
          fallback ??= withSource(lyrics, source);
        }
      }
      if (candidates.length > 0) recordUpstreamResult(context, { result: fallback ? "found" : "no_lyrics" });
      return fallback;
    }
  };
}

export const lrclibProvider = createLrclibProvider();

export function createLrclibProvider(fetchImpl: typeof fetch = fetch): LrclibProvider {
  return {
    getLyrics: (track, context) => createLrclibProviderImplementation(contextFetch(fetchImpl, context)).getLyrics(track, context),
  };
}
