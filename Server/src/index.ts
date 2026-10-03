import { feedbackResponse, type FeedbackEnv } from "./feedback";
import { hashLyrics, saveDiagnostics, cleanupFeedback } from "./diagnostics";
import type { RequestDiagnostics } from "./types";
import { extensionReleaseResponse } from "./extension-release";
// import { amllDbProvider } from "./providers/amlldb";
import { kugouProvider } from "./providers/kugou";
import { lrclibProvider } from "./providers/lrclib";
import { lyricallyProvider } from "./providers/lyrically";
import { musixmatchProvider } from "./providers/musixmatch";
import { neteaseProvider } from "./providers/netease";
import { qqMusicProvider } from "./providers/qqmusic";
import { spotifyProvider } from "./providers/spotify";
import { createLyricsService, type LyricsService } from "./service";
import type { BeautifulLyrics, SpotifyClientContext, TrackMetadata } from "./types";
import { dashboardHtml } from "./dashboard";

const defaultService = createLyricsService({
  // amlldb: amllDbProvider,
  qqmusic: qqMusicProvider,
  kugou: kugouProvider,
  netease: neteaseProvider,
  musixmatch: musixmatchProvider,
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
    const appleMusicTitle = nonEmptyParameter(url, "apple_title");
    if (appleMusicTitle !== undefined) {
      trackMetadata.appleMusicTitle = appleMusicTitle;
    }
  }

  return trackMetadata;
}

export type WorkerEnv = FeedbackEnv & {
  RELEASE_ASSETS?: Fetcher;
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
    scheduled(_event, env, ctx) {
      ctx.waitUntil(cleanupFeedback(env.FEEDBACK_DB).catch(() => console.warn("Feedback cleanup failed")));
    },
    async fetch(request: Request, env: WorkerEnv, ctx?: ExecutionContext): Promise<Response> {
      const feedback = await feedbackResponse(request, env);
      if (feedback) return feedback;
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }

      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname.startsWith("/extension/")) {
        return extensionReleaseResponse(request, env.RELEASE_ASSETS);
      }

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

      let trackId: string;
      try { trackId = decodeURIComponent(trackIdMatch); }
      catch { return new Response("Invalid track ID", { status: 400, headers: corsHeaders }); }
      if (!/^[a-zA-Z0-9]+$/.test(trackId) || trackId.length > 100) return new Response("Invalid track ID", { status: 400, headers: corsHeaders });
      const metadata = extractTrackMetadata(url, trackId);
      const started = Date.now();
      const diagnostics: RequestDiagnostics = {
        id: crypto.randomUUID(), track: metadata ?? { id: trackId, name: "", artists: [] },
        startedAt: new Date(started).toISOString(), durationMs: 0, outcome: "pending", attempts: []
      };
      let lyrics: BeautifulLyrics | undefined;
      let failed = false;
      try {
        lyrics = await service.getLyrics(trackId, accessToken, metadata, extractSpotifyClientContext(request),
          { signal: request.signal, diagnostics });
        diagnostics.outcome = request.signal.aborted ? "cancelled" : lyrics ? "success" : "none";
        if (lyrics) {
          // Metadata never participates in the content fingerprint.
          const hash = await hashLyrics(lyrics);
          lyrics.RequestId = diagnostics.id;
          lyrics.RetrievedAt = diagnostics.startedAt;
          lyrics.LyricsHash = hash;
          diagnostics.lyricsHash = hash;
          if (lyrics.Source) diagnostics.source = lyrics.Source;
        }
      } catch {
        diagnostics.outcome = request.signal.aborted ? "cancelled" : "failed";
        failed = true;
      } finally {
        // Allow scope cancellation handlers to settle before snapshotting attempts.
        await Promise.resolve();
        diagnostics.durationMs = Date.now() - started;
        if (env.FEEDBACK_DB) {
          const record = structuredClone(diagnostics);
          const write = saveDiagnostics(env.FEEDBACK_DB, record)
            .catch(() => console.warn("Lyrics diagnostics write failed"));
          if (ctx?.waitUntil) ctx.waitUntil(write);
          else await write;
        }
      }
      if (failed) return new Response("Lyrics request failed", { status: 502, headers: corsHeaders });

      recordOutcome(env, lyrics);

      if (lyrics === undefined) {
        return emptyLyricsResponse();
      }

      return jsonResponse(lyrics);
    }
  };
}

export default createWorker(defaultService);
