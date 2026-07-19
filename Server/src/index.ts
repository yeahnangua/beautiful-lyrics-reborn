// import { amllDbProvider } from "./providers/amlldb";
import { lrclibProvider } from "./providers/lrclib";
import { lyricallyProvider } from "./providers/lyrically";
import { qqMusicProvider } from "./providers/qqmusic";
import { spotifyProvider } from "./providers/spotify";
import { createLyricsService, type LyricsService } from "./service";
import type { BeautifulLyrics, SpotifyClientContext, TrackMetadata } from "./types";
import { dashboardHtml } from "./dashboard";

const defaultService = createLyricsService({
  // amlldb: amllDbProvider,
  qqmusic: qqMusicProvider,
  lyrically: lyricallyProvider,
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

  const appleMusicId = nonEmptyParameter(url, "apple_id");
  if (appleMusicId !== undefined && /^\d+$/.test(appleMusicId)) {
    trackMetadata.appleMusicId = appleMusicId;
  }

  return trackMetadata;
}

type WorkerEnv = {
  STATS?: AnalyticsEngineDataset;
  STATS_ACCOUNT_ID?: string;
  STATS_API_TOKEN?: string;
};

function recordOutcome(env: WorkerEnv, lyrics: BeautifulLyrics | undefined): void {
  const outcome = lyrics === undefined ? "none" : lyrics.Type.toLowerCase();
  env.STATS?.writeDataPoint({ blobs: [outcome], indexes: [outcome] });
}

async function statsResponse(env: WorkerEnv, url: URL): Promise<Response> {
  if (env.STATS_ACCOUNT_ID === undefined || env.STATS_API_TOKEN === undefined) {
    return new Response("Stats not configured", { status: 503, headers: corsHeaders });
  }

  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const sql = `SELECT blob1 AS outcome, sum(_sample_interval) AS n
    FROM lyrics_outcomes
    WHERE timestamp > NOW() - INTERVAL '${days}' DAY
    GROUP BY outcome`;

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.STATS_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.STATS_API_TOKEN}` },
      body: sql
    }
  );
  if (!response.ok) {
    return new Response(`Stats query failed: ${await response.text()}`, {
      status: 502,
      headers: corsHeaders
    });
  }

  const { data } = (await response.json()) as { data: { outcome: string; n: number }[] };
  const counts: Record<string, number> = { syllable: 0, line: 0, static: 0, none: 0 };
  for (const row of data) {
    counts[row.outcome] = (counts[row.outcome] ?? 0) + Number(row.n);
  }
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const stats = Object.fromEntries(
    Object.entries(counts).map(([outcome, n]) => [
      outcome,
      { count: n, percent: total === 0 ? 0 : Math.round((n / total) * 1000) / 10 }
    ])
  );

  return jsonResponse({ days, total, ...stats });
}

export function createWorker(service: LyricsService): ExportedHandler<WorkerEnv> {
  return {
    async fetch(request: Request, env: WorkerEnv): Promise<Response> {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }

      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/") {
        return new Response(dashboardHtml, {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" }
        });
      }

      if (request.method === "GET" && url.pathname === "/stats") {
        return statsResponse(env, url);
      }

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

      recordOutcome(env, lyrics);

      if (lyrics === undefined) {
        return emptyLyricsResponse();
      }

      return jsonResponse(lyrics);
    }
  };
}

export default createWorker(defaultService);
