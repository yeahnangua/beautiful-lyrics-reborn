import OpenCC from "opencc-js";
import { decryptQrc } from "qrc-decoder";
import { convertQrcXmlToSyllableLyrics } from "../convert/karaoke";
import type { QqMusicProvider, SyllableSyncedLyrics, TrackMetadata } from "../types";
import { withLyricRequestRetries } from "./request";

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
  req?: {
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
  "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo"?: {
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

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

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

function queryValues(track: TrackMetadata): string[] {
  const simplifiedTitle = traditionalToSimplified(track.name);
  const simplifiedArtist = traditionalToSimplified(firstArtist(track));
  return uniqueValues([
    `${simplifiedTitle} ${simplifiedArtist}`,
    `${track.name} ${firstArtist(track)}`,
    simplifiedTitle,
    track.name
  ]);
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

function formatDuration(seconds: number | undefined): string {
  return seconds === undefined ? "unknown duration" : `${Number(seconds.toFixed(1))}s`;
}

function summarizeSong(song: QqMusicSearchSong): string {
  const id = song.id === undefined ? song.mid ?? "unknown-id" : String(song.id);
  const title = songTitle(song) || "unknown title";
  const artists = artistNames(song).join(", ") || "unknown artist";
  return `${id} "${title}" by ${artists} (${formatDuration(song.interval)})`;
}

function logSearchResults(query: string, songs: QqMusicSearchSong[]): void {
  const preview = songs.slice(0, 5).map(summarizeSong).join("; ");
  const suffix = preview.length === 0 ? "" : `: ${preview}`;
  console.log(`[qqmusic] search "${query}": ${songs.length} result(s)${suffix}`);
}

function logMatchedSong(song: QqMusicSearchSong): void {
  console.log(`[qqmusic] matched ${summarizeSong(song)}`);
}

function durationMatches(song: QqMusicSearchSong, track: TrackMetadata): boolean {
  if (track.durationSeconds === undefined || song.interval === undefined) {
    return true;
  }

  return Math.abs(song.interval - track.durationSeconds) <= 5;
}

function closeDurationMatches(song: QqMusicSearchSong, track: TrackMetadata, toleranceSeconds: number): boolean {
  return (
    track.durationSeconds !== undefined &&
    song.interval !== undefined &&
    Math.abs(song.interval - track.durationSeconds) <= toleranceSeconds
  );
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
      return undefined;
    }

    return (await response.json()) as T;
  };

  return retryOnTimeout ? withLyricRequestRetries((signal) => request(signal), "qqmusic request") : request();
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
  logSearchResults(query, songs);
  return songs;
}

async function getQrcLyrics(fetchImpl: FetchLike, songId: number): Promise<SyllableSyncedLyrics | undefined> {
  const payload = await postMusicu<QqMusicLyricResponse>(
    fetchImpl,
    {
      "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo": {
        method: "GetPlayLyricInfo",
        module: "music.musichallSong.PlayLyricInfo",
        param: {
          crypt: 0,
          qrc: 1,
          songID: songId
        }
      }
    },
    true
  );

  const lyricData = payload?.["music.musichallSong.PlayLyricInfo.GetPlayLyricInfo"]?.data;
  if (lyricData?.qrc !== 1 || lyricData.lyric === undefined || lyricData.lyric.length === 0) {
    return undefined;
  }

  return convertQrcXmlToSyllableLyrics(decryptQrcHex(lyricData.lyric));
}

export function createQqMusicProvider(fetchImpl: FetchLike = fetch): QqMusicProvider {
  return {
    async getSyllableLyrics(track: TrackMetadata): Promise<SyllableSyncedLyrics | undefined> {
      if (track.name.length === 0 || firstArtist(track).length === 0) {
        return undefined;
      }

      for (const query of queryValues(track)) {
        const songs = await searchSongs(fetchImpl, query);
        const firstSong = songs[0];
        const matchedSong =
          firstSong?.id !== undefined && closeDurationMatches(firstSong, track, 1)
            ? firstSong
            : songs.find((song) => matchesTrack(song, track));
        if (matchedSong?.id === undefined) {
          continue;
        }
        logMatchedSong(matchedSong);

        const lyrics = await getQrcLyrics(fetchImpl, matchedSong.id);
        if (lyrics !== undefined) {
          return lyrics;
        }
      }

      return undefined;
    }
  };
}

export const qqMusicProvider = createQqMusicProvider();
