import OpenCC from "opencc-js";
import { decryptQrc } from "qrc-decoder";
import { convertQrcXmlToSyllableLyrics } from "../convert/karaoke";
import type { QqMusicProvider, SyllableSyncedLyrics, TrackMetadata } from "../types";

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

  if (normalize(songTitle(song)) !== normalize(track.name)) {
    return false;
  }

  const normalizedSongArtists = artistNames(song).map(normalize);
  const hasMatchingArtist = track.artists.some((artist) => normalizedSongArtists.includes(normalize(artist)));
  return hasMatchingArtist && durationMatches(song, track);
}

async function postMusicu<T>(fetchImpl: FetchLike, body: unknown): Promise<T | undefined> {
  const response = await fetchImpl(musicuUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json;charset=utf-8",
      Referer: "https://y.qq.com/",
      "User-Agent": "Mozilla/5.0"
    },
    body: JSON.stringify(body)
  });

  if (response.ok === false) {
    return undefined;
  }

  return (await response.json()) as T;
}

async function searchSongs(fetchImpl: FetchLike, query: string): Promise<QqMusicSearchSong[]> {
  const payload = await postMusicu<QqMusicSearchResponse>(fetchImpl, {
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
  });

  return payload?.req?.data?.body?.song?.list ?? [];
}

async function getQrcLyrics(fetchImpl: FetchLike, songId: number): Promise<SyllableSyncedLyrics | undefined> {
  const payload = await postMusicu<QqMusicLyricResponse>(fetchImpl, {
    "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo": {
      method: "GetPlayLyricInfo",
      module: "music.musichallSong.PlayLyricInfo",
      param: {
        crypt: 0,
        qrc: 1,
        songID: songId
      }
    }
  });

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
        const matchedSong = songs.find((song) => matchesTrack(song, track));
        if (matchedSong?.id === undefined) {
          continue;
        }

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
