import OpenCC from "opencc-js";
import { convertYrcToSyllableLyrics } from "../convert/karaoke";
import type { NeteaseProvider, SyllableSyncedLyrics, TrackMetadata } from "../types";

type FetchLike = typeof fetch;

type NeteaseSearchSong = {
  id?: number;
  name?: string;
  artists?: Array<{ name?: string }>;
  album?: { name?: string };
  duration?: number;
};

type NeteaseSearchResponse = {
  result?: {
    songs?: NeteaseSearchSong[];
  };
};

type NeteaseLyricResponse = {
  yrc?: {
    lyric?: string;
  };
};

const searchUrl = "https://music.163.com/api/search/get/web";
const lyricUrl = "https://music.163.com/api/song/lyric";
const traditionalToSimplified = OpenCC.Converter({ from: "tw", to: "cn" });

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function normalize(value: string): string {
  return traditionalToSimplified(value).toLocaleLowerCase();
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

function artistNames(song: NeteaseSearchSong): string[] {
  return song.artists?.map((artist) => artist.name ?? "").filter((name) => name.length > 0) ?? [];
}

function durationMatches(song: NeteaseSearchSong, track: TrackMetadata): boolean {
  if (track.durationSeconds === undefined || song.duration === undefined) {
    return true;
  }

  return Math.abs(song.duration / 1000 - track.durationSeconds) <= 5;
}

function matchesTrack(song: NeteaseSearchSong, track: TrackMetadata): boolean {
  if (song.id === undefined || song.name === undefined) {
    return false;
  }

  if (normalize(song.name) !== normalize(track.name)) {
    return false;
  }

  const normalizedSongArtists = artistNames(song).map(normalize);
  const hasMatchingArtist = track.artists.some((artist) => normalizedSongArtists.includes(normalize(artist)));
  return hasMatchingArtist && durationMatches(song, track);
}

function buildSearchUrl(query: string): string {
  const url = new URL(searchUrl);
  url.searchParams.set("s", query);
  url.searchParams.set("type", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("offset", "0");
  return url.toString();
}

function buildLyricUrl(songId: number): string {
  const url = new URL(lyricUrl);
  url.searchParams.set("id", String(songId));
  url.searchParams.set("lv", "-1");
  url.searchParams.set("kv", "-1");
  url.searchParams.set("tv", "-1");
  url.searchParams.set("yv", "-1");
  url.searchParams.set("rv", "-1");
  return url.toString();
}

async function searchSongs(fetchImpl: FetchLike, query: string): Promise<NeteaseSearchSong[]> {
  const response = await fetchImpl(buildSearchUrl(query), {
    headers: {
      Accept: "application/json",
      Referer: "https://music.163.com/",
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (response.ok === false) {
    return [];
  }

  const payload = (await response.json()) as NeteaseSearchResponse;
  return payload.result?.songs ?? [];
}

async function getYrcLyrics(fetchImpl: FetchLike, songId: number): Promise<SyllableSyncedLyrics | undefined> {
  const response = await fetchImpl(buildLyricUrl(songId), {
    headers: {
      Accept: "application/json",
      Referer: "https://music.163.com/",
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (response.ok === false) {
    return undefined;
  }

  const payload = (await response.json()) as NeteaseLyricResponse;
  return convertYrcToSyllableLyrics(payload.yrc?.lyric);
}

export function createNeteaseProvider(fetchImpl: FetchLike = fetch): NeteaseProvider {
  return {
    async getSyllableLyrics(track: TrackMetadata): Promise<SyllableSyncedLyrics | undefined> {
      if (track.name.length === 0 || firstArtist(track).length === 0) {
        return undefined;
      }

      for (const query of queryValues(track)) {
        const songs = await searchSongs(fetchImpl, query);
        const matchedSong = songs.find((song) => matchesTrack(song, track));
        if (matchedSong?.id === undefined) {
          continue;
        }

        const lyrics = await getYrcLyrics(fetchImpl, matchedSong.id);
        if (lyrics !== undefined) {
          return lyrics;
        }
      }

      return undefined;
    }
  };
}

export const neteaseProvider = createNeteaseProvider();
