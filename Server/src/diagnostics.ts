import type { BeautifulLyrics, RequestDiagnostics } from "./types";

export type DiagnosticsEnv = {
  DIAGNOSTICS_SUCCESS_SAMPLE_RATE?: string;
  DIAGNOSTICS_FAILURE_SAMPLE_RATE?: string;
  DIAGNOSTICS_DAILY_LIMIT?: string;
};
const maxDailyLogs = 1000;
function sampleRate(value: string | undefined, fallback: number): number {
  const rate = value?.trim() ? Number(value) : NaN;
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : fallback;
}
export function shouldSaveDiagnostics(env: DiagnosticsEnv, record: RequestDiagnostics, random = Math.random): boolean {
  const failure = record.outcome === "failed" || record.outcome === "none";
  const rate = failure ? sampleRate(env.DIAGNOSTICS_FAILURE_SAMPLE_RATE, 0.1)
    : sampleRate(env.DIAGNOSTICS_SUCCESS_SAMPLE_RATE, 0.01);
  return rate > 0 && (rate === 1 || random() < rate);
}
export function diagnosticsDailyLimit(env: DiagnosticsEnv): number {
  const limit = env.DIAGNOSTICS_DAILY_LIMIT?.trim() ? Number(env.DIAGNOSTICS_DAILY_LIMIT) : NaN;
  return Number.isInteger(limit) && limit >= 0 ? Math.min(limit, maxDailyLogs) : maxDailyLogs;
}

export async function hashLyrics(lyrics: BeautifulLyrics): Promise<string> {
  const { Source: _source, RequestId: _id, RetrievedAt: _time, LyricsHash: _hash, ...content } = lyrics;
  return sha256(JSON.stringify(content));
}
export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function saveDiagnostics(db: D1Database | undefined, record: RequestDiagnostics, dailyLimit = maxDailyLogs): Promise<void> {
  if (!db || dailyLimit <= 0) return;
  // Reserve a slot atomically across Worker isolates. At the cap this is a read only operation.
  // A failed subsequent insert can waste a slot, but can never exceed the daily write budget.
  const slot = await db.prepare(`INSERT INTO diagnostic_daily_budget(day,count) VALUES(?,1)
    ON CONFLICT(day) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`)
    .bind(new Date().toISOString().slice(0, 10), Math.min(dailyLimit, maxDailyLogs)).first<{ count: number }>();
  if (!slot) return;
  const data = JSON.stringify(record);
  await db.batch([
    db.prepare(`INSERT INTO lyric_requests(id,created_at,spotify_id,song,artists,provider,outcome,data)
      VALUES(?,?,?,?,?,?,?,?)`).bind(record.id, record.startedAt, record.track.id, record.track.name,
      record.track.artists.join(", "), record.source?.Provider ?? "unknown", record.outcome, data),
    // A report can arrive before waitUntil has committed this request. Backfill it atomically.
    db.prepare("UPDATE lyric_reports SET diagnostics=? WHERE request_id=? AND diagnostics IS NULL")
      .bind(data, record.id)
  ]);
}
export async function loadDiagnostics(db: D1Database, id: string): Promise<RequestDiagnostics | null> {
  const row = await db.prepare("SELECT data FROM lyric_requests WHERE id=?").bind(id).first<{ data: string }>();
  if (!row) return null;
  const record = JSON.parse(row.data) as RequestDiagnostics;
  if (Array.isArray(record.attempts)) return record;
  // Read pre-optimization logs without rewriting the existing database.
  const attempts = await db.prepare("SELECT data FROM provider_attempts WHERE request_id=? ORDER BY ordinal").bind(id).all<{ data: string }>();
  return { ...record, attempts: attempts.results.map(row => JSON.parse(row.data)) };
}
export async function cleanupFeedback(db: D1Database | undefined): Promise<void> {
  if (!db) return;
  const requestCutoff = new Date(Date.now() - 60 * 86400_000).toISOString();
  const reportCutoff = new Date(Date.now() - 365 * 86400_000).toISOString();
  // Bound legacy child deletions too: a request can contain many provider attempts.
  // Leave parents with remaining attempts for the next scheduled run instead of cascading all at once.
  await db.batch([
    db.prepare(`DELETE FROM provider_attempts WHERE (request_id,ordinal) IN
      (SELECT a.request_id,a.ordinal FROM lyric_requests r JOIN provider_attempts a ON a.request_id=r.id
      WHERE r.created_at < ? LIMIT 1000)`).bind(requestCutoff),
    db.prepare(`DELETE FROM lyric_requests WHERE id IN (SELECT r.id FROM lyric_requests r WHERE created_at < ?
      AND NOT EXISTS(SELECT 1 FROM provider_attempts a WHERE a.request_id=r.id) LIMIT 1000)`).bind(requestCutoff),
    db.prepare("DELETE FROM lyric_reports WHERE id IN (SELECT id FROM lyric_reports WHERE created_at < ? LIMIT 100)").bind(reportCutoff),
    db.prepare("DELETE FROM rate_limits WHERE (key,minute) IN (SELECT key,minute FROM rate_limits WHERE minute < ? LIMIT 1000)").bind(Math.floor(Date.now() / 60000) - 2),
    db.prepare("DELETE FROM admin_sessions WHERE id IN (SELECT id FROM admin_sessions WHERE expires < ? LIMIT 100)").bind(Date.now()),
    db.prepare("DELETE FROM diagnostic_daily_budget WHERE day IN (SELECT day FROM diagnostic_daily_budget WHERE day < ? LIMIT 10)")
      .bind(new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10))
  ]);
}
