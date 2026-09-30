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
  const { attempts, ...summary } = record;
  await db.batch([
    db.prepare(`INSERT INTO lyric_requests(id,created_at,spotify_id,song,artists,provider,outcome,data)
      VALUES(?,?,?,?,?,?,?,?)`).bind(record.id, record.startedAt, record.track.id, record.track.name,
      record.track.artists.join(", "), record.source?.Provider ?? "unknown", record.outcome, JSON.stringify(summary)),
    ...attempts.map((attempt, index) => db.prepare("INSERT INTO provider_attempts(request_id,ordinal,data) VALUES(?,?,?)")
      .bind(record.id, index, JSON.stringify(attempt))),
    // A report can arrive before waitUntil has committed this request. Backfill it atomically.
    db.prepare("UPDATE lyric_reports SET diagnostics=? WHERE request_id=? AND diagnostics IS NULL")
      .bind(JSON.stringify(record), record.id)
  ]);
}
export async function loadDiagnostics(db: D1Database, id: string): Promise<RequestDiagnostics | null> {
  const row = await db.prepare("SELECT data FROM lyric_requests WHERE id=?").bind(id).first<{ data: string }>();
  if (!row) return null;
  const attempts = await db.prepare("SELECT data FROM provider_attempts WHERE request_id=? ORDER BY ordinal").bind(id).all<{ data: string }>();
  return { ...JSON.parse(row.data), attempts: attempts.results.map(row => JSON.parse(row.data)) };
}
export async function cleanupFeedback(db: D1Database | undefined): Promise<void> {
  if (!db) return;
  const requestCutoff = new Date(Date.now() - 60 * 86400_000).toISOString();
  const reportCutoff = new Date(Date.now() - 365 * 86400_000).toISOString();
  // Bounded batches keep scheduled invocations below D1 limits; continue on the next day.
  for (let batch = 0; batch < 20; batch++) {
    const results = await db.batch([
      db.prepare("DELETE FROM lyric_requests WHERE id IN (SELECT id FROM lyric_requests WHERE created_at < ? LIMIT 500)").bind(requestCutoff),
      db.prepare("DELETE FROM lyric_reports WHERE id IN (SELECT id FROM lyric_reports WHERE created_at < ? LIMIT 100)").bind(reportCutoff)
    ]);
    if (results.every(result => result.meta.changes === 0)) break;
  }
  await db.batch([
    db.prepare("DELETE FROM rate_limits WHERE minute < ?").bind(Math.floor(Date.now() / 60000) - 2),
    db.prepare("DELETE FROM admin_sessions WHERE expires < ?").bind(Date.now())
  ]);
}
