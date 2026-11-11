import { appendAttributionLyric } from "./attribution";
import { feedbackResponse, type FeedbackEnv } from "./feedback";
import { PluginFetch as fetch } from "../../Universal/Modules/Http";
import { saveDiagnostics, cleanupFeedback, logLyricsQuery } from "./diagnostics";
import type { RequestDiagnostics } from "./types";
import { extensionReleaseResponse } from "./extension-release";
// import { amllDbProvider } from "./providers/amlldb";
import { appleMusicProvider } from "./providers/applemusic";
import { kugouProvider } from "./providers/kugou";
import { lrclibProvider } from "./providers/lrclib";
import { lrcRedProvider } from "./providers/lrcred";
import { neteaseProvider } from "./providers/netease";
import { qqMusicProvider } from "./providers/qqmusic";
import { spotifyProvider } from "./providers/spotify";
import { spicyLyricsProvider } from "./providers/spicylyrics";
import { createLyricsService, type LyricsService } from "./service";
import type { BeautifulLyrics, SpotifyClientContext, TrackMetadata } from "./types";
import { dashboardHtml } from "./dashboard";
import { cacheIdentity, cacheStatus, createOriginRequest, originBudgetMs, readOriginResponse, type OriginBinding, type OriginContext } from "./cache";
import { createLyricsOrigin, keepAlive } from "./lyrics-origin";
import { Abortable, CreateAbortScope } from "../../Universal/Modules/Async";
import { lyricsCacheVersion } from "./cache-version";
import { loadSourcePolicy, validSpotifyId } from "./source-policy";
import { metricsResponse, recordRequestMetrics, detailedStatistics, type MetricsEnv } from "./metrics";
import { createLyricsAuth, lyricsCorsHeaders, lyricsResponseHeaders, type LyricsAuthEnv } from "./lyrics-auth";
import { LyricsSessionPath } from "../../Universal/Modules/LyricsSession";

export const defaultService = createLyricsService({
  // amlldb: amllDbProvider,
  qqmusic: qqMusicProvider,
  kugou: kugouProvider,
  netease: neteaseProvider,
  spicylyrics: spicyLyricsProvider,
  applemusic: appleMusicProvider,
  lrcred: lrcRedProvider,
  spotify: spotifyProvider,
  lrclib: lrclibProvider
});

const corsHeaders = lyricsCorsHeaders;

function emptyLyricsResponse(headers: Record<string, string> = {}): Response {
  return new Response("", {
    status: 200,
    headers: { ...lyricsResponseHeaders, ...headers }
  });
}

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      ...corsHeaders,
      ...headers,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
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

export type WorkerEnv = FeedbackEnv & MetricsEnv & LyricsAuthEnv & {
  RELEASE_ASSETS?: Fetcher;
  STATS?: AnalyticsEngineDataset;
  STATS_ACCOUNT_ID?: string;
  STATS_API_TOKEN?: string;
  SPICY_LYRICS_KEY?: string;
  LYRICS_CACHE_MODE?: "workers-cache" | "off";
};

function recordOutcome(env: WorkerEnv, lyrics: BeautifulLyrics | undefined): void {
  const outcome = lyrics === undefined ? "none" : lyrics.Type.toLowerCase();
  env.STATS?.writeDataPoint({ blobs: [outcome], indexes: [outcome] });
}

async function statsResponse(env: WorkerEnv, url: URL): Promise<Response> {
  if (env.STATS_ACCOUNT_ID === undefined || env.STATS_API_TOKEN === undefined) {
    return new Response("Stats not configured", { status: 503, headers: corsHeaders });
  }

  const requestedDays = Number(url.searchParams.get("days"));
  const days = Number.isFinite(requestedDays) && requestedDays > 0 ? Math.min(90, Math.max(1, Math.floor(requestedDays))) : 30;
  const sql = `SELECT blob1 AS outcome, sum(_sample_interval) AS n
    FROM lyrics_outcomes
    WHERE timestamp > NOW() - INTERVAL '${days}' DAY
    GROUP BY outcome`;

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.STATS_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.STATS_API_TOKEN}` },
      body: sql,
      signal: AbortSignal.timeout(10000)
    }
  );
  if (!response.ok) {
    return new Response("Statistics unavailable", {
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

  let metrics;
  try { metrics = await detailedStatistics(env, days); }
  catch { metrics = { available: false, server: [], providers: [], client: [], trend: [], latency: [], providerLatency: [], cache: [], origins: [] }; }
  const result = jsonResponse({ days, total, ...stats, metrics });
  result.headers.set("Cache-Control", "no-store");
  return result;
}

export type WorkerOptions = { origin?: (env: WorkerEnv, ctx?: ExecutionContext) => OriginBinding };

export function createWorker(service: LyricsService, auth = createLyricsAuth(), options: WorkerOptions = {}): ExportedHandler<WorkerEnv> {
  // The standalone handler is also usable in Node tests. The deployment adapter
  // supplies the real ctx.exports binding; this direct transport has no cache.
  const directOrigin = createLyricsOrigin(service);
  return {
    scheduled(_event, env, ctx) {
      ctx.waitUntil(cleanupFeedback(env.FEEDBACK_DB).catch(() => console.warn("Feedback cleanup failed")));
    },
    async fetch(request: Request, env: WorkerEnv, ctx?: ExecutionContext): Promise<Response> {
      if (new URL(request.url).pathname === LyricsSessionPath) return auth.session(request, env);
      if (new URL(request.url).pathname === "/metrics") return metricsResponse(request, env);
      const feedback = await feedbackResponse(request, env);
      if (feedback) return feedback;
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: lyricsResponseHeaders
        });
      }

      const url = new URL(request.url);

      const policyRoute = /^\/lyrics-policy\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && policyRoute) {
        const headers = { ...corsHeaders, "Cache-Control": "no-store" };
        let spotifyId: string;
        try { spotifyId = decodeURIComponent(policyRoute[1]!); }
        catch { return new Response("Invalid track ID", { status: 400, headers }); }
        if (!validSpotifyId(spotifyId)) return new Response("Invalid track ID", { status: 400, headers });
        try {
          if (!env.FEEDBACK_DB) throw new Error("Missing source policy database");
          const response = jsonResponse({ blocks: await loadSourcePolicy(env.FEEDBACK_DB, spotifyId) });
          response.headers.set("Cache-Control", "no-store");
          return response;
        } catch {
          console.warn("Lyrics source policy read failed");
          return new Response("Source policy unavailable", { status: 503, headers });
        }
      }

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
        try { return await statsResponse(env, url); }
        catch { return new Response("Statistics unavailable", { status: 503, headers: { ...corsHeaders, "Cache-Control": "no-store" } }); }
      }

      const routeMatch = /^\/lyrics\/([^/]+)$/.exec(url.pathname);

      if (request.method !== "GET" || routeMatch === null) {
        return new Response("Not found", {
          status: 404,
          headers: corsHeaders
        });
      }

      const authorized = await auth.authorize(request, env);
      if (authorized instanceof Response) return authorized;
      const { accessToken } = authorized;

      const trackIdMatch = routeMatch[1];
      if (trackIdMatch === undefined) {
        return new Response("Not found", {
          status: 404,
          headers: lyricsResponseHeaders
        });
      }

      let trackId: string;
      try { trackId = decodeURIComponent(trackIdMatch); }
      catch { return new Response("Invalid track ID", { status: 400, headers: lyricsResponseHeaders }); }
      if (!/^[a-zA-Z0-9]+$/.test(trackId) || trackId.length > 100) return new Response("Invalid track ID", { status: 400, headers: lyricsResponseHeaders });
      const metadata = extractTrackMetadata(url, trackId);
      const started = Date.now();
      const diagnostics: RequestDiagnostics = {
        id: crypto.randomUUID(), track: metadata ?? { id: trackId, name: "", artists: [] },
        startedAt: new Date(started).toISOString(), durationMs: 0, outcome: "pending", attempts: [], cacheVersion: lyricsCacheVersion
      };
      let lyrics: BeautifulLyrics | undefined;
      let failed = false;
      try {
        request.signal.throwIfAborted();
        let sourceBlocks: Awaited<ReturnType<typeof loadSourcePolicy>> = [];
        try {
          if (!env.FEEDBACK_DB) throw new Error("Missing source policy database");
          const policyScope = CreateAbortScope(2000, request.signal);
          try {
            sourceBlocks = await Abortable(policyScope.Signal, () => loadSourcePolicy(env.FEEDBACK_DB, trackId));
          } finally { policyScope.Destroy(); }
          diagnostics.sourcePolicyStatus = "applied";
        } catch {
          request.signal.throwIfAborted();
          diagnostics.sourcePolicyStatus = "unavailable";
          diagnostics.outcome = "failed";
          console.warn("Lyrics source policy read failed");
          return Response.json({ code: "source_policy_unavailable", message: "Lyrics source policy is temporarily unavailable." },
            { status: 503, headers: { ...lyricsResponseHeaders, "Retry-After": "5" } });
        }
        diagnostics.sourceBlocks = sourceBlocks;
        const normalized = await cacheIdentity(trackId, metadata, sourceBlocks);
        diagnostics.cache = env.LYRICS_CACHE_MODE === "off" ? "bypass" : "unknown";
        const origin = options.origin?.(env, ctx) ?? {
          fetch: async (internal: Request) => {
            const response = await directOrigin(internal, env, ctx);
            response.headers.set("CF-Cache-Status", "BYPASS");
            return response;
          },
          purgeTrack: async () => {}
        };
        const scope = CreateAbortScope(originBudgetMs, request.signal);
        try {
          const clientContext = extractSpotifyClientContext(request);
          const context: OriginContext = {
            sourceBlocks: normalized.sourceBlocks, deadline: scope.Deadline, triggerRequestId: diagnostics.id,
            ...(normalized.metadata ? { metadata: normalized.metadata } : {}),
            ...(clientContext ? { clientContext } : {})
          };
          for (let attempt = 0; attempt < 2; attempt++) {
            scope.Signal.throwIfAborted();
            const bypass = env.LYRICS_CACHE_MODE === "off" || attempt > 0;
            if (bypass) diagnostics.cache = "bypass";
            // Parse and verify the body as part of the fill lifetime, even when
            // this caller disconnects while another caller is waiting for it.
            const pending = (async () => {
              const response = await origin.fetch(createOriginRequest(normalized.identity, context, accessToken),
                bypass ? { cache: "no-store" } : undefined);
              const entry = await readOriginResponse(response, normalized.identity, sourceBlocks);
              return { entry, status: bypass ? "bypass" as const : cacheStatus(response),
                rawStatus: response.headers.get("CF-Cache-Status") };
            })();
            keepAlive(ctx, pending);
            try {
              const { entry, status, rawStatus } = await Abortable(scope.Signal, () => pending);
              scope.Signal.throwIfAborted();
              diagnostics.cache = status;
              if (rawStatus) diagnostics.edgeCacheStatus = rawStatus;
              diagnostics.originRunId = entry.originRunId;
              diagnostics.cacheGeneratedAt = new Date(entry.generatedAt).toISOString();
              diagnostics.outcome = entry.outcome;
              failed = entry.outcome === "failed";
              lyrics = entry.lyrics;
              if (lyrics) {
                lyrics.RequestId = diagnostics.id;
                lyrics.RetrievedAt = diagnostics.startedAt;
                lyrics.LyricsHash = entry.lyricsHash!;
                diagnostics.lyricsHash = entry.lyricsHash!;
                if (lyrics.Source) diagnostics.source = lyrics.Source;
              }
              break;
            } catch {
              scope.Signal.throwIfAborted();
              if (attempt > 0 || env.LYRICS_CACHE_MODE === "off") throw new Error("Lyrics cache unavailable");
              console.warn("Lyrics cache response unavailable; bypassing once");
              const purge = Promise.resolve().then(() => origin.purgeTrack(trackId))
                .catch(() => console.warn("Lyrics cache purge failed"));
              keepAlive(ctx, purge);
            }
          }
        } finally { scope.Destroy(); }
      } catch {
        diagnostics.outcome = request.signal.aborted ? "cancelled" : "failed";
        failed = !request.signal.aborted;
        lyrics = undefined;
      } finally {
        diagnostics.durationMs = Date.now() - started;
        // Real queries log inside the origin. Only accepted hits log here.
        if (diagnostics.cache === "hit" && diagnostics.outcome === "success") logLyricsQuery(diagnostics, lyrics?.Type);
        recordRequestMetrics(env, diagnostics, lyrics);
        // One waitUntil for all background writes keeps the response a single unit of work.
        const background: Promise<unknown>[] = [];
        if (env.FEEDBACK_DB) {
          const record = structuredClone(diagnostics);
          background.push(saveDiagnostics(env.FEEDBACK_DB, record)
            .catch(() => console.warn("Lyrics diagnostics write failed")));
        }
        if (background.length > 0) {
          const pending = Promise.all(background);
          if (ctx?.waitUntil) ctx.waitUntil(pending);
          else await pending;
        }
      }
      const cacheHeaders = diagnostics.cache ? { "X-Lyrics-Cache": diagnostics.cache } : {};
      if (failed) return new Response("Lyrics request failed", { status: 502, headers: { ...lyricsResponseHeaders, ...cacheHeaders } });

      recordOutcome(env, lyrics);

      if (lyrics === undefined) {
        return emptyLyricsResponse(cacheHeaders);
      }

      return jsonResponse(appendAttributionLyric(lyrics, metadata?.durationSeconds), { ...lyricsResponseHeaders, ...cacheHeaders });
    }
  };
}

export default createWorker(defaultService);
