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

export function createLrclibProvider(fetchImpl: FetchLike = fetch): LrclibProvider {
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

      if (response.ok === false) {
        return undefined;
      }

      const records = (await response.json()) as LrclibRecord[];
      for (const record of records) {
        const lyrics = convertRecord(record, track.durationSeconds);
        if (lyrics !== undefined) {
          return lyrics;
        }
      }

      return undefined;
    }
  };
}

export const lrclibProvider = createLrclibProvider();
