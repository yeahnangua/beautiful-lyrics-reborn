import type { BeautifulLyrics, RequestDiagnostics } from "./types";
import { providerName } from "./source-policy";
import { unpackOrigin } from "./origin-storage";

export function logLyricsQuery(record: RequestDiagnostics, lyricsType?: BeautifulLyrics["Type"],
  event: "lyrics-query" | "lyrics-request" = "lyrics-query"): void {
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
    `[${event}] ${title}${artists ? ` — ${artists}` : ""}`,
    outcome,
    ...(record.cache === "hit" && record.outcome === "success" ? ["命中缓存"] : []),
    `来源：${source}`,
    ...(record.outcome === "success" && type ? [type] : []),
    `${Math.round(record.durationMs)}ms`
  ].join(" | ");
  console.log(JSON.stringify({
    message,
    level: record.outcome === "failed" ? "error" : "info",
    event,
    requestId: record.triggerRequestId ?? record.id,
    originRunId: record.originRunId,
    cache: record.cache,
    edgeCacheStatus: record.edgeCacheStatus,
    cacheGeneratedAt: record.cacheGeneratedAt,
    cacheVersion: record.cacheVersion,
    sourcePolicyStatus: record.sourcePolicyStatus,
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
const cleanupBatchesPerDay = 3;
const diagnosticBatchSize = 1000;

export async function cleanupFeedback(db: D1Database | undefined, now = Date.now()): Promise<void> {
  if (!db) return;
  const requestCutoff = new Date(now - 14 * 86400_000).toISOString();
  const reportCutoff = new Date(now - 365 * 86400_000).toISOString();
  const day = "cleanup:" + new Date(now).toISOString().slice(0, 10);
  // Each batch consumes a slot in the same transaction as its deletes. The
  // shared counter bounds the work even if a cron is retried or overlaps.
  const hasBudget = "NOT EXISTS (SELECT 1 FROM diagnostic_daily_budget WHERE day=? AND count>=?)";
  const oldestRequests = "SELECT id FROM lyric_requests WHERE created_at < ? ORDER BY created_at,id LIMIT ?";
  const statements = [
    db.prepare(`DELETE FROM provider_attempts WHERE ${hasBudget} AND (request_id,ordinal) IN (
      SELECT request_id,ordinal FROM provider_attempts WHERE request_id IN (${oldestRequests}) LIMIT ?)`)
      .bind(day, cleanupBatchesPerDay, requestCutoff, diagnosticBatchSize, diagnosticBatchSize),
    db.prepare(`DELETE FROM lyric_requests WHERE ${hasBudget} AND id IN (${oldestRequests})
      AND NOT EXISTS(SELECT 1 FROM provider_attempts WHERE request_id=lyric_requests.id)`)
      .bind(day, cleanupBatchesPerDay, requestCutoff, diagnosticBatchSize),
    db.prepare(`DELETE FROM lyric_origin_runs WHERE ${hasBudget} AND id IN (
      SELECT id FROM lyric_origin_runs WHERE created_at < ? ORDER BY created_at,id LIMIT ?)`)
      .bind(day, cleanupBatchesPerDay, requestCutoff, diagnosticBatchSize),
    db.prepare(`DELETE FROM lyric_reports WHERE ${hasBudget} AND id IN (
      SELECT id FROM lyric_reports WHERE created_at < ? ORDER BY created_at,id LIMIT 100)`)
      .bind(day, cleanupBatchesPerDay, reportCutoff),
    db.prepare(`DELETE FROM rate_limits WHERE ${hasBudget} AND (key,minute) IN (
      SELECT key,minute FROM rate_limits WHERE minute < ? LIMIT 1000)`)
      .bind(day, cleanupBatchesPerDay, Math.floor(now / 60000) - 2),
    db.prepare(`DELETE FROM admin_sessions WHERE ${hasBudget} AND id IN (
      SELECT id FROM admin_sessions WHERE expires < ? LIMIT 100)`)
      .bind(day, cleanupBatchesPerDay, now),
    db.prepare(`INSERT INTO diagnostic_daily_budget(day,count) VALUES(?,1)
      ON CONFLICT(day) DO UPDATE SET count=count+1 WHERE count<?`).bind(day, cleanupBatchesPerDay)
  ];
  for (let batch = 0; batch < cleanupBatchesPerDay; batch++) {
    const results = await db.batch(statements);
    if (results.slice(0, -1).every(result => result.meta.changes === 0)) break;
  }
}
