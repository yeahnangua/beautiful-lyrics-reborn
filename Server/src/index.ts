import { amllDbProvider } from "./providers/amlldb";
import { lrclibProvider } from "./providers/lrclib";
import { neteaseProvider } from "./providers/netease";
import { qqMusicProvider } from "./providers/qqmusic";
import { spotifyProvider } from "./providers/spotify";
import { createLyricsService, type LyricsService } from "./service";
import type { SpotifyClientContext, TrackMetadata } from "./types";

const defaultService = createLyricsService({
  amlldb: amllDbProvider,
  qqmusic: qqMusicProvider,
  netease: neteaseProvider,
  spotify: spotifyProvider,
  lrclib: lrclibProvider
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-Spotify-App-Platform, X-Spotify-App-Version"
};

function emptyLyricsResponse(): Response {
  return new Response("", {
    status: 200,
    headers: corsHeaders
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function extractBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("Authorization");
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  return match?.[1];
}

function nonEmptyParameter(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function nonEmptyHeader(request: Request, name: string): string | undefined {
  const value = request.headers.get(name)?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function extractSpotifyClientContext(request: Request): SpotifyClientContext | undefined {
  const appPlatform = nonEmptyHeader(request, "X-Spotify-App-Platform");
  const appVersion = nonEmptyHeader(request, "X-Spotify-App-Version");

  if (appPlatform === undefined && appVersion === undefined) {
    return undefined;
  }

  const clientContext: SpotifyClientContext = {};
  if (appPlatform !== undefined) {
    clientContext.appPlatform = appPlatform;
  }
  if (appVersion !== undefined) {
    clientContext.appVersion = appVersion;
  }

  return clientContext;
}

function extractTrackMetadata(url: URL, trackId: string): TrackMetadata | undefined {
  const trackName = nonEmptyParameter(url, "track_name");
  const artistNames = url.searchParams
    .getAll("artist_name")
    .map((artistName) => artistName.trim())
    .filter((artistName) => artistName.length > 0);

  if (trackName === undefined || artistNames.length === 0) {
    return undefined;
  }

  const trackMetadata: TrackMetadata = {
    id: trackId,
    name: trackName,
    artists: artistNames
  };

  const albumName = nonEmptyParameter(url, "album_name");
  if (albumName !== undefined) {
    trackMetadata.album = albumName;
  }

  const duration = nonEmptyParameter(url, "duration");
  if (duration !== undefined) {
    const durationSeconds = Number(duration);
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
      trackMetadata.durationSeconds = durationSeconds;
    }
  }

  const isrc = nonEmptyParameter(url, "isrc");
  if (isrc !== undefined) {
    trackMetadata.isrc = isrc;
  }

  return trackMetadata;
}

export function createWorker(service: LyricsService): ExportedHandler {
  return {
    async fetch(request: Request): Promise<Response> {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }

      const url = new URL(request.url);
      const routeMatch = /^\/lyrics\/([^/]+)$/.exec(url.pathname);

      if (request.method !== "GET" || routeMatch === null) {
        return new Response("Not found", {
          status: 404,
          headers: corsHeaders
        });
      }

      const accessToken = extractBearerToken(request);
      if (accessToken === undefined) {
        return new Response("Missing Spotify bearer token", {
          status: 401,
          headers: corsHeaders
        });
      }

      const trackIdMatch = routeMatch[1];
      if (trackIdMatch === undefined) {
        return new Response("Not found", {
          status: 404,
          headers: corsHeaders
        });
      }

      const trackId = decodeURIComponent(trackIdMatch);
      const lyrics = await service.getLyrics(
        trackId,
        accessToken,
        extractTrackMetadata(url, trackId),
        extractSpotifyClientContext(request)
      );

      if (lyrics === undefined) {
        return emptyLyricsResponse();
      }

      return jsonResponse(lyrics);
    }
  };
}

export default createWorker(defaultService);
