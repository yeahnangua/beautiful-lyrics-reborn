import type { BeautifulLyrics, RequestDiagnostics } from "./types";
import { PluginFetch as fetch } from "../../Universal/Modules/Http";
import { candidateSource } from "./source-policy";

export type MetricsEnv = {
  METRICS?: AnalyticsEngineDataset;
  METRICS_LIMITER?: RateLimit;
  STATS_ACCOUNT_ID?: string;
  STATS_API_TOKEN?: string;
};
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, User-Agent", "Cache-Control": "no-store" };
const kinds = ["session", "fullscreen_first", "lyrics_load", "lyrics_display", "fullscreen_load", "fullscreen_mode"];
const modes = ["classic", "cadenza", "partita", "cappella", "tilt", "claddagh", "monet", "diorama", "pendolo", "sonnet", "tempera", "lumiere", "still"];
type ClientEvent = { kind: string; version: string; durationMs?: number; source?: string; outcome?: string; lyricsType?: string; view?: string; mode?: string };
export function validateEvents(input: unknown): ClientEvent[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Invalid payload");
  const payload = input as Record<string, unknown>;
  if (payload.schema !== 1 || !Array.isArray(payload.events) || !payload.events.length || payload.events.length > 20) throw Error("Invalid batch");
  return payload.events.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid event");
    const event = value as Record<string, unknown>;
    if (Object.keys(event).some(key => !["kind", "version", "durationMs", "source", "outcome", "lyricsType", "view", "mode"].includes(key))) throw Error("Unknown field");
    if (!kinds.includes(String(event.kind)) || typeof event.version !== "string" || !/^(?:\d+\.\d+\.\d+|dev|unknown)$/.test(event.version)) throw Error("Invalid kind/version");
    const result: ClientEvent = { kind: String(event.kind), version: event.version };
    const select = (key: "source" | "outcome" | "lyricsType" | "view" | "mode", allowed: string[], required = false) => {
      if (event[key] === undefined && !required) return;
      if (typeof event[key] !== "string" || !allowed.includes(event[key])) throw Error("Invalid dimension");
      result[key] = event[key];
    };
    const timed = ["lyrics_load", "lyrics_display", "fullscreen_load"].includes(result.kind);
    if (timed) {
      if (typeof event.durationMs !== "number" || !Number.isFinite(event.durationMs) || event.durationMs < 0 || event.durationMs > 600000) throw Error("Invalid duration");
      result.durationMs = Math.round(event.durationMs);
      select("outcome", result.kind === "lyrics_display" ? ["success"] : ["success", "none", "failed"], true);
    } else if (event.durationMs !== undefined || event.outcome !== undefined) throw Error("Unexpected duration/outcome");
    if (result.kind === "lyrics_load") { select("source", ["cache", "prefetch", "network"], true); select("lyricsType", ["Syllable", "Line", "Static", "none"], true); }
    else if (result.kind === "fullscreen_load") select("source", ["cache", "network", "memory", "embedded"], true);
    else if (event.source !== undefined) throw Error("Unexpected source");
    if (result.kind === "lyrics_display") { select("view", ["card", "page", "fullscreen"], true); select("lyricsType", ["Syllable", "Line", "Static"], true); }
    else if (event.view !== undefined) throw Error("Unexpected view");
    if (result.kind === "fullscreen_mode") select("mode", modes, true);
    else if (event.mode !== undefined) throw Error("Unexpected mode");
    if (!["lyrics_load", "lyrics_display"].includes(result.kind) && event.lyricsType !== undefined) throw Error("Unexpected lyrics type");
    return result;
  });
}

export async function metricsResponse(request: Request, env: MetricsEnv): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
  if (!env.METRICS) return new Response("Metrics unavailable", { status: 503, headers: cors });
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return new Response("Expected JSON", { status: 415, headers: cors });
  if (env.METRICS_LIMITER) {
    try {
      const { success } = await env.METRICS_LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") ?? "local" });
      if (!success) return new Response("Rate limited", { status: 429, headers: { ...cors, "Retry-After": "60" } });
    } catch { return new Response("Metrics unavailable", { status: 503, headers: cors }); }
  }
  const reader = request.body?.getReader();
  if (!reader) return new Response("Missing body", { status: 400, headers: cors });
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 16384) { await reader.cancel(); return new Response("Too large", { status: 413, headers: cors }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const events = validateEvents(JSON.parse(new TextDecoder().decode(bytes)));
    for (const event of events) env.METRICS.writeDataPoint({
      indexes: [`client:${event.kind}`],
      blobs: ["client", event.kind, event.version, event.source ?? "", event.outcome ?? "", event.lyricsType ?? "", event.view ?? "", event.mode ?? ""],
      doubles: [event.durationMs ?? 0],
    });
    return new Response(null, { status: 204, headers: cors });
  } catch { return new Response("Invalid metrics", { status: 400, headers: cors }); }
  finally { reader.releaseLock(); }
}

export function recordRequestMetrics(env: MetricsEnv, record: RequestDiagnostics, lyrics?: BeautifulLyrics): void {
  if (!env.METRICS) return;
  try {
    const type = lyrics?.Type ?? "none";
    env.METRICS.writeDataPoint({ indexes: ["server:request"], blobs: ["server", "request", "v1", record.outcome, type, record.cache ?? "none"], doubles: [record.durationMs] });
    for (const attempt of record.attempts) {
      if (attempt.stage === "metadata") continue;
      const source = attempt.source ?? candidateSource(attempt.provider, { Type: "Static", Lines: [] });
      // A return value is selected by provider label + actual source, not merely platform.
      const selected = attempt.selected === true;
      env.METRICS.writeDataPoint({ indexes: [`provider:${source.Provider}:${source.Transport}`],
        blobs: ["server", "provider", "v1", source.Provider, source.Transport, attempt.stage, attempt.outcome, attempt.lyricsType ?? "none"],
        doubles: [attempt.durationMs, attempt.retries, selected ? 1 : 0] });
    }
  } catch { console.warn("Metrics write failed"); }
}

export type MetricRow = Record<string, string | number>;
export async function queryMetrics(env: MetricsEnv, sql: string): Promise<MetricRow[]> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.STATS_ACCOUNT_ID}/analytics_engine/sql`, {
    method: "POST", headers: { Authorization: `Bearer ${env.STATS_API_TOKEN}` }, body: sql, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error("Statistics unavailable");
  const payload = await response.json() as { data?: MetricRow[] };
  if (!Array.isArray(payload.data)) throw Error("Invalid statistics response");
  return payload.data;
}
const latency = "sum(double1 * _sample_interval) / sum(_sample_interval) AS avgMs, quantileExactWeighted(0.5)(double1, _sample_interval) AS p50Ms, quantileExactWeighted(0.95)(double1, _sample_interval) AS p95Ms";
export const statisticsQueries = (days: number) => {
  const range = `timestamp > NOW() - INTERVAL '${days}' DAY`;
  return {
    server: `SELECT blob4 AS outcome, blob5 AS lyricsType, sum(_sample_interval) AS count, ${latency}, min(timestamp) AS since FROM lyrics_metrics WHERE ${range} AND blob1='server' AND blob2='request' GROUP BY outcome, lyricsType`,
    providers: `SELECT blob4 AS provider, blob5 AS transport, blob6 AS stage, blob7 AS outcome, sum(_sample_interval) AS count, sum(double2 * _sample_interval) AS retries, sum(double3 * _sample_interval) AS selected, ${latency} FROM lyrics_metrics WHERE ${range} AND blob1='server' AND blob2='provider' GROUP BY provider, transport, stage, outcome`,
    client: `SELECT blob2 AS kind, blob4 AS source, blob5 AS outcome, blob6 AS lyricsType, blob7 AS view, blob8 AS mode, sum(_sample_interval) AS count, ${latency}, min(timestamp) AS since FROM lyrics_metrics WHERE ${range} AND blob1='client' GROUP BY kind, source, outcome, lyricsType, view, mode`,
    trend: `SELECT toDate(timestamp) AS day, blob1 AS origin, blob2 AS kind, blob4 AS dimension, sum(_sample_interval) AS count FROM lyrics_metrics WHERE ${range} AND ((blob1='server' AND blob2='request') OR (blob1='client' AND blob2 IN ('session','fullscreen_first','lyrics_load','fullscreen_load'))) GROUP BY day, origin, kind, dimension ORDER BY day`,
    latency: `SELECT blob1 AS origin, blob2 AS kind, ${latency} FROM lyrics_metrics WHERE ${range} AND ((blob1='server' AND blob2='request' AND blob4!='cancelled') OR (blob1='client' AND blob2 IN ('lyrics_load','lyrics_display','fullscreen_load'))) GROUP BY origin, kind`,
    cache: `SELECT blob6 AS cache, blob4 AS outcome, blob5 AS lyricsType, sum(_sample_interval) AS count, ${latency} FROM lyrics_metrics WHERE ${range} AND blob1='server' AND blob2='request' GROUP BY cache, outcome, lyricsType`,
    providerLatency: `SELECT blob4 AS provider, blob5 AS transport, ${latency} FROM lyrics_metrics WHERE ${range} AND blob1='server' AND blob2='provider' AND blob7 IN ('success','none','failed','timeout') GROUP BY provider, transport`,
  };
};
export async function detailedStatistics(env: MetricsEnv, days: number) {
  if (!env.METRICS) return { available: false, server: [], providers: [], client: [], trend: [], latency: [], providerLatency: [], cache: [] };
  const queries = statisticsQueries(days);
  const entries = await Promise.all(Object.entries(queries).map(async ([key, sql]) => [key, await queryMetrics(env, sql)] as const));
  return { available: true, ...Object.fromEntries(entries) };
}
