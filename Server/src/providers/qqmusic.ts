import { contextFetch, getFetchContext } from "./request";
import OpenCC from "opencc-js";
import { convertLrcToLineLyrics } from "../convert/lrc";
import { decodeBase64Text } from "../convert/base64";
import { decryptQrc } from "qrc-decoder";
import { convertQrcXmlToSyllableLyrics } from "../convert/karaoke";
import type { QqMusicProvider, BeautifulLyrics, TrackMetadata } from "../types";
import { withLyricRequestRetries, recordUpstreamResult } from "./request";
import { withSource, recordMatch } from "./matched-title";

type FetchLike = typeof fetch;

type QqMusicSearchSong = {
  id?: number;
  mid?: string;
  title?: string;
  songname?: string;
  singer?: Array<{ name?: string }>;
  album?: { name?: string };
  albumname?: string;
  interval?: number;
};

type QqMusicSearchResponse = {
  code?: number;
  req?: {
    code?: number;
    data?: {
      body?: {
        song?: {
          list?: QqMusicSearchSong[];
        };
      };
    };
  };
};

type QqMusicLyricResponse = {
  code?: number;
  "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo"?: {
    code?: number;
    data?: {
      qrc?: number;
      lyric?: string;
    };
  };
};

const musicuUrl = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const traditionalToSimplified = OpenCC.Converter({ from: "tw", to: "cn" });
const languageTags = new Set([
  "粤",
  "粤语",
  "国",
  "国语",
  "普通话",
  "台",
  "台语",
  "闽南语",
  "日",
  "日语",
  "日文",
  "韩",
  "韩语",
  "韩文",
  "英",
  "英语",
  "英文"
]);

function normalize(value: string): string {
  return traditionalToSimplified(value).toLocaleLowerCase();
}

function compactTitlePart(value: string): string {
  return normalize(value).replace(/[-‐‑‒–—―_/\\|:：·・.,，。!！?？'"“”‘’\s]/g, "");
}

function isLanguageTag(value: string): boolean {
  return languageTags.has(compactTitlePart(value));
}

function stripBracketedLanguageTags(value: string): string {
  return value.replace(
    /\(([^)]*)\)|\[([^\]]*)\]|（([^）]*)）|【([^】]*)】/g,
    (match, roundTag?: string, squareTag?: string, fullWidthRoundTag?: string, fullWidthSquareTag?: string) => {
      const tag = roundTag ?? squareTag ?? fullWidthRoundTag ?? fullWidthSquareTag ?? "";
      return isLanguageTag(tag) ? "" : match;
    }
  );
}

function stripTrailingLanguageTag(value: string): string {
  return value.replace(/\s*[-‐‑‒–—―_/\\|:：·・]\s*([^-‐‑‒–—―_/\\|:：·・()[\]（）【】]+)\s*$/, (match, tag) =>
    isLanguageTag(tag) ? "" : match
  );
}

function normalizeTitleForComparison(value: string): string {
  return compactTitlePart(stripTrailingLanguageTag(stripBracketedLanguageTags(value)));
}

function firstArtist(track: TrackMetadata): string {
  return track.artists[0] ?? "";
}

export function decryptQrcHex(hex: string): string | undefined {
  try {
    return decryptQrc(hex.trim());
  } catch {
    return undefined;
  }
}

function songTitle(song: QqMusicSearchSong): string {
  return song.title ?? song.songname ?? "";
}

function artistNames(song: QqMusicSearchSong): string[] {
  return song.singer?.map((artist) => artist.name ?? "").filter((name) => name.length > 0) ?? [];
}

function durationMatches(song: QqMusicSearchSong, track: TrackMetadata): boolean {
  if (track.durationSeconds === undefined || song.interval === undefined) {
    return true;
  }

  return Math.abs(song.interval - track.durationSeconds) <= 5;
}

function matchesTrack(song: QqMusicSearchSong, track: TrackMetadata): boolean {
  if (song.id === undefined || songTitle(song).length === 0) {
    return false;
  }

  const normalizedSongTitle = normalize(songTitle(song));
  const normalizedTrackTitle = normalize(track.name);
  if (
    normalizedSongTitle !== normalizedTrackTitle &&
    normalizeTitleForComparison(songTitle(song)) !== normalizeTitleForComparison(track.name)
  ) {
    return false;
  }

  const normalizedSongArtists = artistNames(song).map(normalize);
  // ponytail: bidirectional includes — Spotify names like "JOLIN蔡依林" must match QQ names like "蔡依林";
  // the exact-title and duration checks backstop short-substring false positives.
  const hasMatchingArtist = track.artists.some((artist) => {
    const normalizedArtist = normalize(artist);
    return normalizedSongArtists.some(
      (songArtist) => songArtist.includes(normalizedArtist) || normalizedArtist.includes(songArtist)
    );
  });
  return hasMatchingArtist && durationMatches(song, track);
}

async function postMusicu<T>(fetchImpl: FetchLike, body: unknown, retryOnTimeout = false): Promise<T | undefined> {
  const request = async (signal?: AbortSignal): Promise<T | undefined> => {
    const response = await fetchImpl(musicuUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json;charset=utf-8",
        Referer: "https://y.qq.com/",
        "User-Agent": "Mozilla/5.0"
      },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal })
    });

    if (response.ok === false) {
      recordUpstreamResult(getFetchContext(fetchImpl), { result: "http_error" });
      return undefined;
    }

    try { return (await response.json()) as T; }
    catch (error) {
      recordUpstreamResult(getFetchContext(fetchImpl), { result: "invalid_payload" });
      throw error;
    }
  };

  return retryOnTimeout ? withLyricRequestRetries((signal) => request(signal), "qqmusic request", getFetchContext(fetchImpl)) : request();
}

async function searchSongs(fetchImpl: FetchLike, query: string): Promise<QqMusicSearchSong[]> {
  const payload = await postMusicu<QqMusicSearchResponse>(
    fetchImpl,
    {
      comm: {
        ct: "19",
        cv: "1859",
        uin: "0"
      },
      req: {
        method: "DoSearchForQQMusicDesktop",
        module: "music.search.SearchCgiService",
        param: {
          grp: 1,
          num_per_page: 8,
          page_num: 1,
          query,
          search_type: 0
        }
      }
    },
    true
  );

  const list = payload?.req?.data?.body?.song?.list;
  const songs = Array.isArray(list) ? list : [];
  recordUpstreamResult(getFetchContext(fetchImpl), {
    operation: "search", query,
    codes: { code: payload?.code, req: payload?.req?.code },
    ...(payload === undefined ? {} : payload === null ? { result: "invalid_payload" } : {
      result: (payload.code !== undefined && payload.code !== 0) || (payload.req?.code !== undefined && payload.req.code !== 0)
        ? "api_error" : !Array.isArray(list) ? "invalid_payload" : songs.length > 0 ? "matched" : "no_results",
      resultCount: songs.length
    })
  });
  return songs;
}

async function getTimedLyrics(fetchImpl: FetchLike, songId: number, word: boolean, durationSeconds?: number): Promise<BeautifulLyrics | undefined> {
  const payload = await postMusicu<QqMusicLyricResponse>(
    fetchImpl,
    {
      "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo": {
        method: "GetPlayLyricInfo",
        module: "music.musichallSong.PlayLyricInfo",
        param: {
          crypt: 0,
          qrc: word ? 1 : 0,
          songID: songId
        }
      }
    },
    true
  );

  const response = payload?.["music.musichallSong.PlayLyricInfo.GetPlayLyricInfo"];
  const lyricData = response?.data;
  const context = getFetchContext(fetchImpl);
  recordUpstreamResult(context, { operation: "lyrics", codes: { code: payload?.code, lyric: response?.code } });
  if (!payload) {
    if (payload === null) recordUpstreamResult(context, { result: "invalid_payload" });
    return undefined;
  }
  if (!lyricData?.lyric) {
    recordUpstreamResult(context, { result: (payload.code !== undefined && payload.code !== 0) || (response?.code !== undefined && response.code !== 0)
      ? "api_error" : !response ? "invalid_payload" : "no_lyrics" });
    return undefined;
  }
  if (word && lyricData.qrc !== 1) {
    recordUpstreamResult(context, { result: "no_syllable_lyrics" });
    return undefined;
  }

  const lyrics = word ? convertQrcXmlToSyllableLyrics(decryptQrcHex(lyricData.lyric))
    : convertLrcToLineLyrics(decodeBase64Text(lyricData.lyric) ?? lyricData.lyric, durationSeconds);
  recordUpstreamResult(context, { result: lyrics ? "found" : word ? "no_syllable_lyrics" : "no_line_lyrics" });
  return lyrics;
}

function createQqMusicProviderImplementation(fetchImpl: FetchLike, word: boolean) {
  return {
    async getLyrics(track: TrackMetadata) {
      if (track.name.length === 0 || firstArtist(track).length === 0) {
        return undefined;
      }

      // ponytail: one title-only search (simplified) to stay under QQ rate limits;
      // artist and duration matching below picks the right song from the wider results.
      const songs = await searchSongs(fetchImpl, traditionalToSimplified(track.name));
      const matching = songs.filter((song) => matchesTrack(song, track));
      const candidates = matching.slice(0, 3);
      if (songs.length > 0) recordUpstreamResult(getFetchContext(fetchImpl), {
        matchedCount: matching.length, result: matching.length > 0 ? "matched" : "no_match"
      });
      for (const song of candidates) {
        const source = { Provider: "qqmusic", Transport: "direct", TrackId: String(song.id), MatchedTitle: songTitle(song) } as const;
        recordMatch(getFetchContext(fetchImpl), source);
        const lyrics = await getTimedLyrics(fetchImpl, song.id!, word, track.durationSeconds);
        if (lyrics !== undefined) return withSource(lyrics, source);
      }
      return undefined;
    }
  };
}

export const qqMusicProvider = createQqMusicProvider();

export function createQqMusicProvider(fetchImpl: typeof fetch = fetch): QqMusicProvider {
  return {
    getSyllableLyrics: (track, context) => createQqMusicProviderImplementation(contextFetch(fetchImpl, context), true).getLyrics(track)
      .then(lyrics => lyrics?.Type === "Syllable" ? lyrics : undefined),
    getLineLyrics: (track, context) => createQqMusicProviderImplementation(contextFetch(fetchImpl, context), false).getLyrics(track)
      .then(lyrics => lyrics?.Type === "Line" ? lyrics : undefined),
  };
}
