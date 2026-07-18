import OpenCC from "opencc-js";
// import { convertEnhancedLrcToSyllableLyrics } from "../convert/enhanced-lrc";
import { convertLrcToLineLyrics } from "../convert/lrc";
import { convertPlainTextToStatic } from "../convert/plain";
import { withLyricRequestRetries } from "./request";
import type {
  BeautifulLyrics,
  LineSyncedLyrics,
  LyricallyProvider,
  StaticSyncedLyrics,
  SyllableMetadata,
  SyllableSyncedLyrics,
  SyllableVocalSet,
  TrackMetadata
} from "../types";

type FetchLike = typeof fetch;

type DeezerSearchSong = {
  id?: number;
  title?: string;
  title_short?: string;
  title_version?: string;
  duration?: number;
  artist?: { name?: string };
};

type DeezerSearchResponse = {
  data?: DeezerSearchSong[];
};

type TimedLyricWord = {
  text?: string;
  part?: boolean;
  timestamp?: number;
  endtime?: number;
};

type TimedLyricLine = {
  text?: TimedLyricWord[];
  timestamp?: number;
  endtime?: number;
  oppositeTurn?: boolean;
};

type DeezerLyricResponse = {
  isError?: boolean;
  syncType?: string;
  plain_lyrics?: string;
  lyrics?: TimedLyricLine[];
};

type KugouSearchSong = {
  hash?: string;
  title?: string;
  artist?: string;
  duration?: number;
};

type KugouLyricLine = Omit<TimedLyricLine, "text"> & {
  text?: string | TimedLyricWord[];
};

type KugouLyricResponse = {
  lyrics?: KugouLyricLine[];
};

type NeteaseSearchSong = {
  id?: number;
  name?: string;
  duration?: number;
  artists?: Array<{ name?: string }>;
};

type NeteaseSearchResponse = {
  result?: { songs?: NeteaseSearchSong[] };
};

type NeteaseLyricResponse = KugouLyricResponse & {
  metadata?: {
    rawData?: {
      lrc?: { lyric?: string };
    };
  };
};

type YouTubeSearchVideo = {
  videoId?: string;
  title?: string;
  author?: string;
  duration?: string;
};

type GeniusSearchResponse = {
  response?: {
    sections?: Array<{
      type?: string;
      hits?: Array<{
        result?: {
          title?: string;
          primary_artist_names?: string;
          artist_names?: string;
          url?: string;
        };
      }>;
    }>;
  };
};

type GeniusLyricResponse = {
  error?: boolean;
  lyrics?: string;
};

const lyricallyBaseUrl = "https://lyrics.paxsenix.org";
const userAgent = "beautiful-lyrics-reborn/1.0 (https://github.com/yeahnangua/beautiful-lyrics-reborn)";
const traditionalToSimplified = OpenCC.Converter({ from: "tw", to: "cn" });

function buildUrl(path: string, parameters: Record<string, string>): string {
  const url = new URL(path, lyricallyBaseUrl);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function buildExternalUrl(url: string, parameters: Record<string, string>): string {
  const parsedUrl = new URL(url);
  for (const [key, value] of Object.entries(parameters)) {
    parsedUrl.searchParams.set(key, value);
  }
  return parsedUrl.toString();
}

async function getJson<T>(fetchImpl: FetchLike, url: string, retryOnTimeout = false): Promise<T | undefined> {
  const request = async (signal?: AbortSignal): Promise<T | undefined> => {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent
      },
      ...(signal === undefined ? {} : { signal })
    });

    if (response.ok === false) {
      const body = await response.text().catch(() => "");
      const snippet = body.trim().slice(0, 240);
      console.warn(
        `[lyrically] ${new URL(url).pathname}: ${response.status} ${response.statusText}${
          snippet.length > 0 ? ` ${snippet}` : ""
        }`
      );
      return undefined;
    }

    return (await response.json()) as T;
  };

  return retryOnTimeout
    ? withLyricRequestRetries((signal) => request(signal), new URL(url).pathname)
    : request();
}

async function getJsonString(fetchImpl: FetchLike, url: string): Promise<string | undefined> {
  const payload = await getJson<unknown>(fetchImpl, url);
  return typeof payload === "string" && payload.trim().length > 0 ? payload : undefined;
}

function normalize(value: string): string {
  return traditionalToSimplified(value)
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function compact(value: string): string {
  return normalize(value).replace(/[-‐‑‒–—―_/\\|:：·・.,，。!！?？'"“”‘’()[\]（）【】\s]/g, "");
}

function removeVersionQualifiers(value: string): string {
  const qualifier =
    "remix|mix|live|version|ver\\.?|edit|remaster(?:ed)?|acoustic|instrumental|karaoke|cover|feat\\.?|ft\\.?|with|版|粤|粵|国语|國語|伴奏|翻唱";

  return value
    .replace(new RegExp(`[([{（【][^\\])}）】]*(?:${qualifier})[^\\])}）】]*[\\])}）】]`, "giu"), " ")
    .replace(new RegExp(`\\s+[-‐‑‒–—―:：]\\s*[^-‐‑‒–—―:：]*(?:${qualifier})[^-‐‑‒–—―:：]*$`, "giu"), " ");
}

function firstArtist(track: TrackMetadata): string {
  return track.artists[0] ?? "";
}

function durationMatches(actual: number | undefined, expected: number | undefined, toleranceSeconds = 8): boolean {
  if (actual === undefined || expected === undefined) {
    return true;
  }

  return Math.abs(actual - expected) <= toleranceSeconds;
}

function titleMatches(candidate: string | undefined, track: TrackMetadata): boolean {
  if (candidate === undefined || candidate.length === 0 || track.name.length === 0) {
    return false;
  }

  const normalizedCandidate = compact(candidate);
  const normalizedTrack = compact(track.name);
  return normalizedCandidate === normalizedTrack || normalizedCandidate.includes(normalizedTrack);
}

function baseTitleMatches(candidate: string | undefined, track: TrackMetadata): boolean {
  if (candidate === undefined || candidate.length === 0 || track.name.length === 0) {
    return false;
  }

  const normalizedCandidate = compact(removeVersionQualifiers(candidate));
  const normalizedTrack = compact(removeVersionQualifiers(track.name));
  return (
    normalizedCandidate.length > 0 &&
    normalizedTrack.length > 0 &&
    (normalizedCandidate === normalizedTrack ||
      normalizedCandidate.includes(normalizedTrack) ||
      normalizedTrack.includes(normalizedCandidate))
  );
}

function artistMatches(candidate: string | undefined, track: TrackMetadata): boolean {
  if (candidate === undefined || candidate.length === 0 || track.artists.length === 0) {
    return false;
  }

  const normalizedCandidate = normalize(candidate);
  return track.artists.some((artist) => normalizedCandidate.includes(normalize(artist)));
}

function parseDurationSeconds(duration: string | undefined): number | undefined {
  if (duration === undefined) {
    return undefined;
  }

  const parts = duration
    .split(":")
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
  if (parts.length === 0) {
    return undefined;
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
}

function rankYouTubeCandidate(video: YouTubeSearchVideo, track: TrackMetadata): number | undefined {
  if (
    video.videoId === undefined ||
    artistMatches(video.author, track) === false ||
    durationMatches(parseDurationSeconds(video.duration), track.durationSeconds, 10) === false
  ) {
    return undefined;
  }

  if (titleMatches(video.title, track)) {
    return 0;
  }

  if (baseTitleMatches(video.title, track)) {
    return 1;
  }

  return undefined;
}

function timedWordsToSyllableLyrics(lines: TimedLyricLine[] | undefined): SyllableSyncedLyrics | undefined {
  const content: SyllableVocalSet[] = [];

  for (const line of lines ?? []) {
    const words = line.text ?? [];
    const hasPartMetadata = words.some((word) => word.part !== undefined);
    const syllables: SyllableMetadata[] = [];
    for (const word of words) {
      if (
        word.text === undefined ||
        word.text.length === 0 ||
        word.timestamp === undefined ||
        word.endtime === undefined ||
        word.endtime <= word.timestamp
      ) {
        continue;
      }

      syllables.push({
        Text: word.text,
        StartTime: word.timestamp / 1000,
        EndTime: word.endtime / 1000,
        IsPartOfWord: word.part ?? false
      });
    }

    if (hasPartMetadata === false) {
      for (let index = 0; index < syllables.length - 1; index += 1) {
        const syllable = syllables[index];
        if (syllable !== undefined) {
          syllable.IsPartOfWord = true;
        }
      }
    }

    const first = syllables[0];
    const last = syllables[syllables.length - 1];
    if (first === undefined || last === undefined) {
      continue;
    }

    content.push({
      Type: "Vocal",
      OppositeAligned: line.oppositeTurn ?? false,
      Lead: {
        StartTime: first.StartTime,
        EndTime: last.EndTime,
        Syllables: syllables
      }
    });
  }

  const first = content[0];
  const last = content[content.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }

  return {
    Type: "Syllable",
    StartTime: first.Lead.StartTime,
    EndTime: last.Lead.EndTime,
    Content: content
  };
}

function timedLinesToLineLyrics(
  lines: KugouLyricLine[] | undefined,
  durationSeconds?: number
): LineSyncedLyrics | undefined {
  const content = (lines ?? []).flatMap((line, index) => {
    const text = (typeof line.text === "string" ? line.text : (line.text ?? []).map((word) => word.text ?? "").join(""))
      .trim();
    if (text.length === 0 || line.timestamp === undefined) {
      return [];
    }

    const nextLine = lines?.[index + 1];
    const endtime =
      line.endtime ?? nextLine?.timestamp ?? (durationSeconds === undefined ? undefined : durationSeconds * 1000);
    if (endtime === undefined || endtime <= line.timestamp) {
      return [];
    }

    return [
      {
        Type: "Vocal" as const,
        Text: text,
        StartTime: line.timestamp / 1000,
        EndTime: endtime / 1000,
        OppositeAligned: line.oppositeTurn ?? false
      }
    ];
  });
  const first = content[0];
  const last = content[content.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }

  return {
    Type: "Line",
    StartTime: first.StartTime,
    EndTime: last.EndTime,
    Content: content
  };
}

function parseLyricallyTextLyrics(payload: unknown, durationSeconds?: number): BeautifulLyrics | undefined {
  if (typeof payload === "string") {
    return convertLrcToLineLyrics(payload, durationSeconds) ?? convertPlainTextToStatic(payload);
  }

  if (payload === null || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const possibleText = record.lyrics ?? record.plain_lyrics;
  if (typeof possibleText !== "string") {
    return undefined;
  }

  return convertLrcToLineLyrics(possibleText, durationSeconds) ?? convertPlainTextToStatic(possibleText);
}

/*
async function getMusixmatchWordLyrics(
  fetchImpl: FetchLike,
  track: TrackMetadata
): Promise<SyllableSyncedLyrics | undefined> {
  const enhancedLrc = await getJsonString(
    fetchImpl,
    buildUrl("/musixmatch/lyrics", {
      id: track.id,
      type: "word",
      format: "json"
    })
  );

  return convertEnhancedLrcToSyllableLyrics(enhancedLrc, track.durationSeconds);
}
*/

async function getSpotifyLineLyrics(fetchImpl: FetchLike, track: TrackMetadata): Promise<BeautifulLyrics | undefined> {
  const payload = await getJson<unknown>(
    fetchImpl,
    buildUrl("/spotify/lyrics", {
      id: track.id
    })
  );

  return parseLyricallyTextLyrics(payload, track.durationSeconds);
}

async function searchKugou(
  fetchImpl: FetchLike,
  track: TrackMetadata,
  retryOnTimeout: boolean
): Promise<KugouSearchSong | undefined> {
  const query = `${track.name} ${firstArtist(track)}`.trim();
  if (track.name.length === 0 || firstArtist(track).length === 0) {
    return undefined;
  }

  const songs =
    (await getJson<KugouSearchSong[]>(
      fetchImpl,
      buildUrl("/kugou/search", {
        q: query
      }),
      retryOnTimeout
    )) ?? [];
  console.log(`[lyrically:kugou] search "${query}": ${songs.length} result(s)`);

  const matches = (song: KugouSearchSong, baseTitle: boolean) =>
    song.hash !== undefined &&
    (baseTitle ? baseTitleMatches(song.title, track) : titleMatches(song.title, track)) &&
    artistMatches(song.artist, track) &&
    durationMatches(song.duration, track.durationSeconds);
  return songs.find((song) => matches(song, false)) ?? songs.find((song) => matches(song, true));
}

async function getKugouLyrics(
  fetchImpl: FetchLike,
  track: TrackMetadata,
  word: boolean
): Promise<BeautifulLyrics | undefined> {
  const matchedSong = await searchKugou(fetchImpl, track, word);
  if (matchedSong?.hash === undefined) {
    return undefined;
  }
  console.log(`[lyrically:kugou] matched ${matchedSong.hash} "${matchedSong.title ?? "unknown title"}"`);

  const payload = await getJson<KugouLyricResponse>(
    fetchImpl,
    buildUrl("/kugou/lyrics", {
      id: matchedSong.hash,
      word: String(word),
      v: "2"
    }),
    word
  );
  if (word) {
    return timedWordsToSyllableLyrics(
      payload?.lyrics?.map((line) => ({
        ...line,
        text: Array.isArray(line.text) ? line.text : []
      }))
    );
  }

  return timedLinesToLineLyrics(payload?.lyrics, track.durationSeconds);
}

async function getNeteaseLyrics(
  fetchImpl: FetchLike,
  track: TrackMetadata,
  word: boolean
): Promise<BeautifulLyrics | undefined> {
  const query = `${track.name} ${firstArtist(track)}`.trim();
  if (track.name.length === 0 || firstArtist(track).length === 0) {
    return undefined;
  }

  const payload = await getJson<NeteaseSearchResponse>(
    fetchImpl,
    buildUrl("/netease/search", { q: query }),
    word
  );
  const songs = payload?.result?.songs ?? [];
  console.log(`[lyrically:netease] search "${query}": ${songs.length} result(s)`);

  const matches = (song: NeteaseSearchSong, baseTitle: boolean) =>
    song.id !== undefined &&
    (baseTitle ? baseTitleMatches(song.name, track) : titleMatches(song.name, track)) &&
    artistMatches(song.artists?.map((artist) => artist.name ?? "").join(", "), track) &&
    durationMatches(song.duration === undefined ? undefined : song.duration / 1000, track.durationSeconds);
  const matchedSong = songs.find((song) => matches(song, false)) ?? songs.find((song) => matches(song, true));
  if (matchedSong?.id === undefined) {
    return undefined;
  }
  console.log(`[lyrically:netease] matched ${matchedSong.id} "${matchedSong.name ?? "unknown title"}"`);

  const lyricsPayload = await getJson<NeteaseLyricResponse>(
    fetchImpl,
    buildUrl("/netease/lyrics", {
      id: String(matchedSong.id),
      word: String(word),
      v: "2"
    }),
    word
  );
  if (word) {
    return timedWordsToSyllableLyrics(
      lyricsPayload?.lyrics?.map((line) => ({
        ...line,
        text: Array.isArray(line.text) ? line.text : []
      }))
    );
  }

  return (
    timedLinesToLineLyrics(lyricsPayload?.lyrics, track.durationSeconds) ??
    convertLrcToLineLyrics(lyricsPayload?.metadata?.rawData?.lrc?.lyric, track.durationSeconds)
  );
}

async function getYouTubeLyrics(fetchImpl: FetchLike, track: TrackMetadata): Promise<BeautifulLyrics | undefined> {
  if (track.name.length === 0 || firstArtist(track).length === 0) {
    return undefined;
  }

  const videos =
    (await getJson<YouTubeSearchVideo[]>(
      fetchImpl,
      buildUrl("/youtube/search", {
        q: `${track.name} ${firstArtist(track)}`
      })
    )) ?? [];
  console.log(`[lyrically:youtube] search "${track.name} ${firstArtist(track)}": ${videos.length} result(s)`);

  const matchedVideos = videos
    .map((video, index) => ({ video, index, rank: rankYouTubeCandidate(video, track) }))
    .filter((candidate): candidate is { video: YouTubeSearchVideo; index: number; rank: number } => candidate.rank !== undefined)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((candidate) => candidate.video);
  if (matchedVideos.length === 0) {
    return undefined;
  }

  for (const matchedVideo of matchedVideos) {
    if (matchedVideo.videoId === undefined) {
      continue;
    }
    console.log(`[lyrically:youtube] matched ${matchedVideo.videoId} "${matchedVideo.title ?? "unknown title"}"`);

    const payload = await getJson<unknown>(
      fetchImpl,
      buildUrl("/youtube/lyrics", {
        id: matchedVideo.videoId
      })
    );
    const lyrics = parseLyricallyTextLyrics(payload, track.durationSeconds);
    if (lyrics !== undefined) {
      return lyrics;
    }
    console.log(`[lyrically:youtube] lyrics ${matchedVideo.videoId}: no usable lyrics`);
  }

  return undefined;
}

async function searchDeezer(fetchImpl: FetchLike, track: TrackMetadata): Promise<DeezerSearchSong | undefined> {
  const query =
    track.isrc !== undefined && track.isrc.length > 0
      ? `isrc:"${track.isrc}"`
      : `${track.name} ${firstArtist(track)}`.trim();
  if (query.length === 0) {
    return undefined;
  }

  const payload = await getJson<DeezerSearchResponse>(
    fetchImpl,
    buildExternalUrl("https://api.deezer.com/search/track", { q: query }),
    true
  );
  const songs = payload?.data ?? [];
  console.log(`[lyrically:deezer] search "${query}": ${songs.length} result(s)`);

  return songs.find(
    (song) =>
      song.id !== undefined &&
      titleMatches(song.title, track) &&
      artistMatches(song.artist?.name, track) &&
      durationMatches(song.duration, track.durationSeconds)
  );
}

async function getDeezerLyrics(fetchImpl: FetchLike, track: TrackMetadata): Promise<BeautifulLyrics | undefined> {
  const matchedSong = await searchDeezer(fetchImpl, track);
  if (matchedSong?.id === undefined) {
    return undefined;
  }
  console.log(`[lyrically:deezer] matched ${matchedSong.id} "${matchedSong.title ?? "unknown title"}"`);

  const payload = await getJson<DeezerLyricResponse>(
    fetchImpl,
    buildUrl("/deezer/lyrics", {
      id: String(matchedSong.id),
      v: "2"
    }),
    true
  );
  if (payload === undefined || payload.isError === true) {
    console.log(
      `[lyrically:deezer] lyrics ${matchedSong.id}: ${
        typeof payload?.plain_lyrics === "string" ? payload.plain_lyrics : "no lyrics found"
      }`
    );
    return undefined;
  }

  const lyrics =
    (payload.syncType === "Syllable"
      ? timedWordsToSyllableLyrics(payload.lyrics)
      : payload.syncType === "Line"
        ? timedLinesToLineLyrics(payload.lyrics, track.durationSeconds)
        : undefined) ?? convertPlainTextToStatic(payload.plain_lyrics);
  if (lyrics === undefined) {
    console.log(`[lyrically:deezer] lyrics ${matchedSong.id}: no usable lyrics`);
  }
  return lyrics;
}

async function searchGenius(fetchImpl: FetchLike, track: TrackMetadata): Promise<string | undefined> {
  if (track.name.length === 0 || firstArtist(track).length === 0) {
    return undefined;
  }

  const query = `${track.name} ${firstArtist(track)}`;
  const payload = await getJson<GeniusSearchResponse>(
    fetchImpl,
    buildExternalUrl("https://genius.com/api/search/song", { q: query })
  );
  const hits = payload?.response?.sections?.flatMap((section) => section.hits ?? []) ?? [];
  console.log(`[lyrically:genius] search "${query}": ${hits.length} result(s)`);

  const matchedHit = hits.find((hit) => {
    const result = hit.result;
    return result !== undefined && titleMatches(result.title, track) && artistMatches(result.primary_artist_names ?? result.artist_names, track);
  });

  return matchedHit?.result?.url;
}

async function getGeniusLyrics(fetchImpl: FetchLike, track: TrackMetadata): Promise<StaticSyncedLyrics | undefined> {
  const geniusUrl = await searchGenius(fetchImpl, track);
  if (geniusUrl === undefined) {
    return undefined;
  }
  console.log(`[lyrically:genius] matched ${geniusUrl}`);

  const payload = await getJson<GeniusLyricResponse>(
    fetchImpl,
    buildUrl("/genius/lyrics", {
      url: geniusUrl
    })
  );
  if (payload === undefined || payload.error === true) {
    return undefined;
  }

  return convertPlainTextToStatic(payload.lyrics);
}

export function createLyricallyProvider(fetchImpl: FetchLike = fetch): LyricallyProvider {
  return {
    /*
    async getSyllableLyrics(track: TrackMetadata): Promise<SyllableSyncedLyrics | undefined> {
      return getMusixmatchWordLyrics(fetchImpl, track);
    },
    */

    async getKugouLyrics(track: TrackMetadata, word: boolean): Promise<BeautifulLyrics | undefined> {
      return getKugouLyrics(fetchImpl, track, word);
    },

    async getNeteaseLyrics(track: TrackMetadata, word: boolean): Promise<BeautifulLyrics | undefined> {
      return getNeteaseLyrics(fetchImpl, track, word);
    },

    async getLyrics(track: TrackMetadata): Promise<BeautifulLyrics | undefined> {
      return getSpotifyLineLyrics(fetchImpl, track);
    },

    async getYouTubeLyrics(track: TrackMetadata): Promise<BeautifulLyrics | undefined> {
      return getYouTubeLyrics(fetchImpl, track);
    },

    async getDeezerLyrics(track: TrackMetadata): Promise<BeautifulLyrics | undefined> {
      return getDeezerLyrics(fetchImpl, track);
    },

    async getGeniusLyrics(track: TrackMetadata): Promise<StaticSyncedLyrics | undefined> {
      return getGeniusLyrics(fetchImpl, track);
    }
  };
}

export const lyricallyProvider = createLyricallyProvider();
