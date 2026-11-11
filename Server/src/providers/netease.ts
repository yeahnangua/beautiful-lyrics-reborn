import { contextFetch, getFetchContext } from "./request";
// Inspired by Spicetify lyrics-plus/ProviderNetease.js (LGPL-2.1).
// Adapted on 2026-09-19 for native fetch, direct NetEase endpoints, and YRC timing.
// See NOTICE.md and LICENSES/Spicetify-LGPL-2.1.txt for attribution and license.
import OpenCC from "opencc-js";
import { convertLrcToLineLyrics } from "../convert/lrc";
import { convertYrcToSyllableLyrics } from "../convert/karaoke";
import { withLyricRequestRetries, recordUpstreamResult } from "./request";
import { withSource, recordMatch } from "./matched-title";
import type { TimedLyricsProvider, TrackMetadata, RequestContext } from "../types";

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

type SearchResponse = { code?: number; result?: { songs?: Song[]; songCount?: number } };
type LyricResponse = { code?: number; pureMusic?: boolean; yrc?: { lyric?: string }; lrc?: { lyric?: string } };

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

function createNeteaseProviderImplementation(fetchImpl: typeof fetch, word: boolean) {
  async function getJson<T>(url: URL, signal: AbortSignal): Promise<T | undefined> {
    const response = await fetchImpl(url.toString(), { headers, signal });
    if (!response.ok) {
      recordUpstreamResult(getFetchContext(fetchImpl), { result: "http_error" });
      return undefined;
    }
    try { return (await response.json()) as T; }
    catch (error) {
      recordUpstreamResult(getFetchContext(fetchImpl), { result: "invalid_payload" });
      throw error;
    }
  }

  return {
    async getLyrics(track: TrackMetadata, context?: RequestContext) {
      if (!track.name.trim() || !track.artists[0]?.trim()) {
        return undefined;
      }
      // Bound the entire search + download, including body reads, on each attempt.
      return withLyricRequestRetries(async (signal) => {
        const query = simplify(`${track.name} ${track.artists[0]}`);
        const searchUrl = new URL("https://music.163.com/api/search/get/web");
        searchUrl.search = new URLSearchParams({
          s: query,
          type: "1",
          limit: "10",
          offset: "0"
        }).toString();
        const search = await getJson<SearchResponse>(searchUrl, signal);
        recordUpstreamResult(context, { operation: "search", query, codes: { code: search?.code } });
        if (search?.code !== 200) {
          if (search !== undefined) recordUpstreamResult(context, { result: search?.code !== undefined && search.code !== 200 ? "api_error" : "invalid_payload" });
          return undefined;
        }
        if (!Array.isArray(search.result?.songs)) {
          // NetEase omits songs for a valid zero-result response. A missing list
          // without that count is recorded literally, rather than guessed to be an API error.
          const empty = search.result?.songCount === 0;
          recordUpstreamResult(context, { result: empty ? "no_results" : "missing_song_list",
            ...(empty ? { resultCount: 0, matchedCount: 0 } : {}) });
          return undefined;
        }
        const candidates = search.result.songs.filter((song) => matches(song, track));
        recordUpstreamResult(context, { resultCount: search.result.songs.length, matchedCount: candidates.length,
          result: candidates.length > 0 ? "matched" : search.result.songs.length > 0 ? "no_match" : "no_results" });
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
          const source = { Provider: "netease", Transport: "direct", TrackId: String(song.id), ...(song.name ? { MatchedTitle: song.name } : {}) } as const;
          recordMatch(getFetchContext(fetchImpl), source);
          const lyricUrl = new URL("https://music.163.com/api/song/lyric/v1");
          lyricUrl.search = new URLSearchParams({ id: String(song.id), lv: "-1", yv: "-1" }).toString();
          const payload = await getJson<LyricResponse>(lyricUrl, signal);
          recordUpstreamResult(context, { operation: "lyrics", codes: { code: payload?.code } });
          if (payload?.code !== 200) {
            if (payload !== undefined) recordUpstreamResult(context, { result: payload?.code === undefined ? "invalid_payload" : "api_error" });
            continue;
          }
          if (payload.pureMusic) {
            recordUpstreamResult(context, { result: "instrumental" });
            continue;
          }
          const lyrics = word ? convertYrcToSyllableLyrics(payload.yrc?.lyric)
            : convertLrcToLineLyrics(payload.lrc?.lyric, track.durationSeconds);
          recordUpstreamResult(context, { result: lyrics ? "found" : !(payload.yrc?.lyric || payload.lrc?.lyric)
            ? "no_lyrics" : word ? "no_syllable_lyrics" : "no_line_lyrics" });
          if (lyrics !== undefined) {
            return withSource(lyrics, source);
          }
        }
        return undefined;
      }, "netease direct " + (word ? "syllable" : "line"), context);
    }
  };
}

export const neteaseProvider = createNeteaseProvider();

export function createNeteaseProvider(fetchImpl: typeof fetch = fetch): TimedLyricsProvider {
  return {
    getSyllableLyrics: (track, context) => createNeteaseProviderImplementation(contextFetch(fetchImpl, context), true).getLyrics(track, context)
      .then(lyrics => lyrics?.Type === "Syllable" ? lyrics : undefined),
    getLineLyrics: (track, context) => createNeteaseProviderImplementation(contextFetch(fetchImpl, context), false).getLyrics(track, context)
      .then(lyrics => lyrics?.Type === "Line" ? lyrics : undefined),
  };
}
