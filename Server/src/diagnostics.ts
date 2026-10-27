import type { BeautifulLyrics, RequestDiagnostics } from "./types";

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
    db.prepare("DELETE FROM lyric_reports WHERE id IN (SELECT id FROM lyric_reports WHERE created_at < ? LIMIT 100)").bind(reportCutoff),
    db.prepare("DELETE FROM rate_limits WHERE (key,minute) IN (SELECT key,minute FROM rate_limits WHERE minute < ? LIMIT 1000)").bind(Math.floor(now / 60000) - 2),
    db.prepare("DELETE FROM admin_sessions WHERE id IN (SELECT id FROM admin_sessions WHERE expires < ? LIMIT 100)").bind(now)
  ];
  while (true) {
    const results = await db.batch(statements);
    if (results.every(result => result.meta.changes === 0)) break;
  }
  // Kept out of the batch: an unapplied 0005 migration must not block retention.
  for (let pass = 0; pass < 20; pass++) {
    const purged = await db
      .prepare("DELETE FROM lyrics_cache WHERE spotify_id IN (SELECT spotify_id FROM lyrics_cache WHERE expires_at < ? LIMIT 1000)")
      .bind(now).run().catch(() => undefined);
    if (!purged || purged.meta.changes === 0) break;
  }
}
