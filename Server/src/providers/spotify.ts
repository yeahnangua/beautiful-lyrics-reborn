import { convertSpotifyLyricsPayload } from "../convert/spotify";
import type { BeautifulLyrics, SpotifyClientContext, SpotifyProvider, TrackMetadata } from "../types";

type FetchLike = typeof fetch;

type SpotifyTrackResponse = {
  id: string;
  name: string;
  duration_ms?: number;
  album?: {
    name?: string;
  };
  artists?: Array<{
    name?: string;
  }>;
  external_ids?: {
    isrc?: string;
  };
};

type SpotifyInternalTrackResponse = {
  gid?: string;
  name?: string;
  duration?: number;
  album?: {
    name?: string;
  };
  artist?: Array<{
    name?: string;
  }>;
  external_id?: Array<{
    type?: string;
    id?: string;
  }>;
};

const spotifyLyricsBaseUrl = "https://spclient.wg.spotify.com/color-lyrics/v2/track";
const spotifyTrackBaseUrl = "https://api.spotify.com/v1/tracks";
const spotifyInternalTrackBaseUrl = "https://spclient.wg.spotify.com/metadata/4/track";
const spotifyBase62Alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function spotifyHeaders(accessToken: string, clientContext?: SpotifyClientContext): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "App-Platform": clientContext?.appPlatform ?? "WebPlayer",
    "Spotify-App-Version": clientContext?.appVersion ?? "1.2.0"
  };
}

async function getJson(
  fetchImpl: FetchLike,
  url: string,
  accessToken: string,
  clientContext: SpotifyClientContext | undefined,
  description: string
): Promise<unknown | undefined> {
  const response = await fetchImpl(url, {
    headers: spotifyHeaders(accessToken, clientContext)
  });

  if (response.ok === false) {
    console.log(`[spotify] ${description}: ${response.status} ${response.statusText}`);
    return undefined;
  }

  try {
    return await response.json();
  } catch (error) {
    console.warn(
      `[spotify] ${description}: failed to parse JSON (${response.headers.get("Content-Type") ?? "unknown content type"})`,
      error
    );
    return undefined;
  }
}

export function spotifyTrackIdToGid(trackId: string): string {
  let value = 0n;
  for (const character of trackId) {
    const digit = spotifyBase62Alphabet.indexOf(character);
    if (digit < 0) {
      throw new Error(`Invalid Spotify track id character: ${character}`);
    }

    value = value * 62n + BigInt(digit);
  }

  return value.toString(16).padStart(32, "0");
}

function convertWebTrack(trackId: string, payload: SpotifyTrackResponse): TrackMetadata {
  const track: TrackMetadata = {
    id: payload.id || trackId,
    name: payload.name,
    artists: payload.artists?.map((artist) => artist.name).filter((name): name is string => Boolean(name)) ?? []
  };

  if (payload.album?.name !== undefined) {
    track.album = payload.album.name;
  }

  if (payload.duration_ms !== undefined) {
    track.durationSeconds = payload.duration_ms / 1000;
  }

  if (payload.external_ids?.isrc !== undefined) {
    track.isrc = payload.external_ids.isrc;
  }

  return track;
}

function convertInternalTrack(trackId: string, payload: SpotifyInternalTrackResponse): TrackMetadata | undefined {
  if (payload.name === undefined) {
    return undefined;
  }

  const track: TrackMetadata = {
    id: trackId,
    name: payload.name,
    artists: payload.artist?.map((artist) => artist.name).filter((name): name is string => Boolean(name)) ?? []
  };

  if (payload.album?.name !== undefined) {
    track.album = payload.album.name;
  }

  if (payload.duration !== undefined) {
    track.durationSeconds = payload.duration;
  }

  const isrc = payload.external_id?.find((externalId) => externalId.type === "isrc")?.id;
  if (isrc !== undefined) {
    track.isrc = isrc;
  }

  return track;
}

export function createSpotifyProvider(fetchImpl: FetchLike = fetch): SpotifyProvider {
  return {
    async getLyrics(
      trackId: string,
      accessToken: string,
      clientContext?: SpotifyClientContext
    ): Promise<BeautifulLyrics | undefined> {
      const url = `${spotifyLyricsBaseUrl}/${encodeURIComponent(trackId)}?format=json&vocalRemoval=false&market=from_token`;
      const payload = await getJson(fetchImpl, url, accessToken, clientContext, `${trackId} lyrics`);
      if (payload === undefined) {
        return undefined;
      }

      const lyrics = convertSpotifyLyricsPayload(payload as Parameters<typeof convertSpotifyLyricsPayload>[0]);
      if (lyrics === undefined) {
        console.log(`[spotify] ${trackId} lyrics: response contained no usable lyrics`);
      }

      return lyrics;
    },

    async getTrackMetadata(
      trackId: string,
      accessToken: string,
      clientContext?: SpotifyClientContext
    ): Promise<TrackMetadata | undefined> {
      const webUrl = `${spotifyTrackBaseUrl}/${encodeURIComponent(trackId)}?market=from_token`;
      const webPayload = (await getJson(
        fetchImpl,
        webUrl,
        accessToken,
        clientContext,
        `${trackId} Web API metadata`
      )) as
        | SpotifyTrackResponse
        | undefined;
      if (webPayload !== undefined) {
        return convertWebTrack(trackId, webPayload);
      }

      const gid = spotifyTrackIdToGid(trackId);
      const internalUrl = `${spotifyInternalTrackBaseUrl}/${gid}`;
      const internalPayload = (await getJson(
        fetchImpl,
        internalUrl,
        accessToken,
        clientContext,
        `${trackId} internal metadata`
      )) as
        | SpotifyInternalTrackResponse
        | undefined;
      if (internalPayload === undefined) {
        return undefined;
      }

      return convertInternalTrack(trackId, internalPayload);
    }
  };
}

export const spotifyProvider = createSpotifyProvider();
