// Inspired by Spicetify lyrics-plus/ProviderNetease.js (LGPL-2.1).
// Adapted on 2026-09-19 for native fetch, direct NetEase endpoints, and YRC timing.
// See NOTICE.md and LICENSES/Spicetify-LGPL-2.1.txt for attribution and license.
import OpenCC from "opencc-js";
import { convertYrcToSyllableLyrics } from "../convert/karaoke";
import { withLyricRequestRetries } from "./request";
import type { SyllableLyricsProvider, TrackMetadata } from "../types";

type Song = {
  id?: number;
  name?: string;
  duration?: number;
  dt?: number;
  artists?: { name?: string }[];
  ar?: { name?: string }[];
  album?: { name?: string };
  al?: { name?: string };
};

type SearchResponse = { code?: number; result?: { songs?: Song[] } };
type LyricResponse = { code?: number; pureMusic?: boolean; yrc?: { lyric?: string } };

const simplify = OpenCC.Converter({ from: "tw", to: "cn" });
const headers = {
  Accept: "application/json",
  Referer: "https://music.163.com/",
  "User-Agent": "Mozilla/5.0",
  Cookie: "os=pc; appver=2.9.7;"
};

function normalize(text: string): string {
  return simplify(text).normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
}

function duration(song: Song): number | undefined {
  return song.duration ?? song.dt;
}

function matches(song: Song, track: TrackMetadata): boolean {
  if (!Number.isSafeInteger(song.id) || (song.id ?? 0) <= 0 || normalize(song.name ?? "") !== normalize(track.name)) {
    return false;
  }
  const artists = song.artists ?? song.ar;
  if (
    !Array.isArray(artists) ||
    !artists.some((artist) => track.artists.some((expected) => normalize(artist.name ?? "") === normalize(expected)))
  ) {
    return false;
  }
  const milliseconds = duration(song);
  return (
    track.durationSeconds === undefined || milliseconds === undefined ||
    Math.abs(milliseconds / 1000 - track.durationSeconds) <= 8
  );
}

export function createNeteaseProvider(fetchImpl: typeof fetch = fetch): SyllableLyricsProvider {
  async function getJson<T>(url: URL, signal: AbortSignal): Promise<T | undefined> {
    const response = await fetchImpl(url.toString(), { headers, signal });
    return response.ok ? (await response.json()) as T : undefined;
  }

  return {
    async getSyllableLyrics(track) {
      if (!track.name.trim() || !track.artists[0]?.trim()) {
        return undefined;
      }
      // Bound the entire search + download, including body reads, on each attempt.
      return withLyricRequestRetries(async (signal) => {
        const searchUrl = new URL("https://music.163.com/api/search/get/web");
        searchUrl.search = new URLSearchParams({
          s: simplify(`${track.name} ${track.artists[0]}`),
          type: "1",
          limit: "10",
          offset: "0"
        }).toString();
        const search = await getJson<SearchResponse>(searchUrl, signal);
        if (search?.code !== 200 || !Array.isArray(search.result?.songs)) {
          return undefined;
        }
        const candidates = search.result.songs.filter((song) => matches(song, track));
        const score = (song: Song): number => {
          const album = song.album?.name ?? song.al?.name ?? "";
          const albumMatch = track.album !== undefined && normalize(album) === normalize(track.album);
          const milliseconds = duration(song);
          const difference = track.durationSeconds === undefined || milliseconds === undefined
            ? 0 : Math.abs(milliseconds / 1000 - track.durationSeconds);
          return (albumMatch ? 100 : 0) - difference;
        };
        candidates.sort((a, b) => score(b) - score(a));

        // The same recording can occur on several albums; not all entries have YRC.
        for (const song of candidates.slice(0, 3)) {
          const lyricUrl = new URL("https://music.163.com/api/song/lyric/v1");
          lyricUrl.search = new URLSearchParams({ id: String(song.id), lv: "-1", yv: "-1" }).toString();
          const payload = await getJson<LyricResponse>(lyricUrl, signal);
          if (payload?.code !== 200) {
            return undefined;
          }
          if (payload.pureMusic) {
            continue;
          }
          const lyrics = convertYrcToSyllableLyrics(payload.yrc?.lyric);
          if (lyrics !== undefined) {
            return lyrics;
          }
        }
        return undefined;
      }, "netease direct");
    }
  };
}

export const neteaseProvider = createNeteaseProvider();
