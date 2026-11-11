import type { BeautifulLyrics, RequestDiagnostics } from "./types";
import { providerName } from "./source-policy";
import { packOrigin, unpackOrigin } from "./origin-storage";

/** Called by the origin for a real query, or by the gateway for an accepted hit. */
export function logLyricsQuery(record: RequestDiagnostics, lyricsType?: BeautifulLyrics["Type"]): void {
  const brief = (value: string | undefined) => typeof value === "string" ? value.slice(0, 200) : undefined;
  const summaryText = (value: string | undefined) => value?.replace(/\s+/g, " ").trim().slice(0, 120);
  const title = summaryText(record.track.name) || summaryText(record.track.id) || "未知歌曲";
  const artists = summaryText(record.track.artists.slice(0, 3).join(" / "));
  const outcome = {
    pending: "查询中", success: "✅", none: "❌", failed: "查询失败", cancelled: "查询已取消"
  }[record.outcome];
  const source = record.outcome === "success" ? summaryText(record.source?.Provider) || "未知" : "无";
  const type = lyricsType && { Syllable: "逐字", Line: "逐行", Static: "纯文本" }[lyricsType];
  // Workers Logs uses these top-level fields for the Message and Level columns.
  const message = [
    `[lyrics-query] ${title}${artists ? ` — ${artists}` : ""}`,
    outcome,
    ...(record.cache === "hit" && record.outcome === "success" ? ["命中缓存"] : []),
    `来源：${source}`,
    ...(record.outcome === "success" && type ? [type] : []),
    `${Math.round(record.durationMs)}ms`
  ].join(" | ");
  console.log(JSON.stringify({
    message,
    level: record.outcome === "failed" ? "error" : "info",
    event: "lyrics-query",
    requestId: record.triggerRequestId ?? record.id,
    originRunId: record.originRunId,
    cache: record.cache,
    edgeCacheStatus: record.edgeCacheStatus,
    cacheGeneratedAt: record.cacheGeneratedAt,
    cacheVersion: record.cacheVersion,
    track: { id: record.track.id, name: brief(record.track.name), artists: record.track.artists.slice(0, 5).map(brief) },
    outcome: record.outcome,
    durationMs: record.durationMs,
    provider: record.source?.Provider,
    lyricsType,
    queries: (record.cache === "hit" ? [] : record.attempts).map(attempt => ({
      provider: providerName(attempt.provider),
      stage: attempt.stage,
      outcome: attempt.outcome,
      found: attempt.outcome === "success" || attempt.blockAction === "filtered" ? true
        : attempt.outcome === "none" && !attempt.reason ? false : undefined,
      reason: attempt.reason ?? attempt.error,
      durationMs: attempt.durationMs,
      retries: attempt.retries,
      selected: attempt.selected,
      lyricsType: attempt.lyricsType,
      blockAction: attempt.blockAction,
      matches: attempt.matches?.slice(0, 3).map(match => ({ id: match.TrackId ?? match.LyricsId, title: brief(match.MatchedTitle) })),
      requests: attempt.upstream.map(upstream => ({
        endpoint: upstream.endpoint.split("?")[0]?.slice(0, 300),
        operation: upstream.operation,
        status: upstream.status,
        codes: upstream.codes,
        outcome: upstream.outcome,
        result: upstream.result,
        query: brief(upstream.query),
        resultCount: upstream.resultCount,
        matchedCount: upstream.matchedCount,
        durationMs: upstream.durationMs
      }))
    }))
  }));
}

export async function hashLyrics(lyrics: BeautifulLyrics): Promise<string> {
  const { Source: _source, RequestId: _id, RetrievedAt: _time, LyricsHash: _hash, ...content } = lyrics;
  return sha256(JSON.stringify(content));
}
export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function saveDiagnostics(db: D1Database | undefined, record: RequestDiagnostics): Promise<void> {
  if (!db) return;
  const { origin: _origin, originStatus: _status, ...summary } = record;
  const data = JSON.stringify(summary);
  await db.batch([
    db.prepare(`INSERT INTO lyric_requests(id,created_at,spotify_id,song,artists,provider,outcome,data)
      VALUES(?,?,?,?,?,?,?,?)`).bind(record.id, record.startedAt, record.track.id, record.track.name,
      record.track.artists.join(", "), record.source?.Provider ?? "unknown", record.outcome, data),
    // A report can arrive before waitUntil has committed this request. Backfill it atomically.
    db.prepare("UPDATE lyric_reports SET origin_run_id=?, diagnostics=CASE WHEN ? IS NULL THEN ? " +
      "ELSE json_set(?, '$.origin', json((SELECT data FROM lyric_origin_runs WHERE id=?))) END " +
      "WHERE request_id=? AND diagnostics IS NULL")
      .bind(record.originRunId ?? null, record.originRunId ?? null, data, data, record.originRunId ?? null, record.id)
  ]);
}
export async function saveOriginDiagnostics(db: D1Database | undefined, record: RequestDiagnostics): Promise<void> {
  if (!db) return;
  const data = await packOrigin(record);
  await db.batch([
    db.prepare("INSERT INTO lyric_origin_runs(id,created_at,spotify_id,data) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING")
      .bind(record.id, record.startedAt, record.track.id, data),
    // The request, report and shared fill may finish in any order. Preserve the
    // origin snapshot in the report before the 14-day origin retention expires.
    db.prepare("UPDATE lyric_reports SET diagnostics=json_set(diagnostics,'$.origin',json(?),'$.originStatus','available') " +
      "WHERE origin_run_id=? AND diagnostics IS NOT NULL " +
      "AND (json_type(diagnostics,'$.origin') IS NULL OR json_type(diagnostics,'$.origin')='null')")
      .bind(data, record.id)
  ]);
}
export async function hydrateOriginDiagnostics(db: D1Database, record: RequestDiagnostics): Promise<RequestDiagnostics> {
  if (!record.originRunId) return record;
  const { origin: snapshot, ...request } = record;
  try {
    if (snapshot) return { ...request, origin: await unpackOrigin(snapshot), originStatus: "available" };
    const row = await db.prepare("SELECT data FROM lyric_origin_runs WHERE id=?").bind(record.originRunId).first<{ data: string }>();
    if (row) return { ...request, origin: await unpackOrigin(JSON.parse(row.data)), originStatus: "available" };
  } catch { /* Missing diagnostics must not make an otherwise readable report fail. */ }
  return { ...request, originStatus: "unavailable" };
}
export async function loadDiagnostics(db: D1Database, id: string): Promise<RequestDiagnostics | null> {
  const row = await db.prepare("SELECT data FROM lyric_requests WHERE id=?").bind(id).first<{ data: string }>();
  if (!row) return null;
  const record = JSON.parse(row.data) as RequestDiagnostics;
  if (Array.isArray(record.attempts)) return hydrateOriginDiagnostics(db, record);
  // Read pre-optimization logs without rewriting the existing database.
  const attempts = await db.prepare("SELECT data FROM provider_attempts WHERE request_id=? ORDER BY ordinal").bind(id).all<{ data: string }>();
  return hydrateOriginDiagnostics(db, { ...record, attempts: attempts.results.map(row => JSON.parse(row.data)) });
}
export async function cleanupFeedback(db: D1Database | undefined): Promise<void> {
  if (!db) return;
  const now = Date.now();
  const requestCutoff = new Date(now - 14 * 86400_000).toISOString();
  const reportCutoff = new Date(now - 365 * 86400_000).toISOString();
  // Keep each transaction small, including legacy children, but drain the entire backlog.
  // Fixed cutoffs keep concurrent new requests outside this run's cleanup window.
  const statements = [
    db.prepare(`DELETE FROM provider_attempts WHERE (request_id,ordinal) IN
      (SELECT a.request_id,a.ordinal FROM lyric_requests r JOIN provider_attempts a ON a.request_id=r.id
      WHERE r.created_at < ? LIMIT 1000)`).bind(requestCutoff),
    db.prepare(`DELETE FROM lyric_requests WHERE id IN (SELECT r.id FROM lyric_requests r WHERE created_at < ?
      AND NOT EXISTS(SELECT 1 FROM provider_attempts a WHERE a.request_id=r.id) LIMIT 1000)`).bind(requestCutoff),
    db.prepare("DELETE FROM lyric_origin_runs WHERE id IN (SELECT id FROM lyric_origin_runs WHERE created_at < ? LIMIT 1000)").bind(requestCutoff),
    db.prepare("DELETE FROM lyric_reports WHERE id IN (SELECT id FROM lyric_reports WHERE created_at < ? LIMIT 100)").bind(reportCutoff),
    db.prepare("DELETE FROM rate_limits WHERE (key,minute) IN (SELECT key,minute FROM rate_limits WHERE minute < ? LIMIT 1000)").bind(Math.floor(now / 60000) - 2),
    db.prepare("DELETE FROM admin_sessions WHERE id IN (SELECT id FROM admin_sessions WHERE expires < ? LIMIT 100)").bind(now)
  ];
  while (true) {
    const results = await db.batch(statements);
    if (results.every(result => result.meta.changes === 0)) break;
  }
}
