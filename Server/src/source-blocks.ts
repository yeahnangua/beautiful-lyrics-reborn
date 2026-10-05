import { lyricsTypes, sourceProviders, validSpotifyId } from "./source-policy";
import type { BeautifulLyrics } from "./types";

export class SourceBlockError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type BlockRow = { id: string; spotify_id: string; provider: string; lyrics_type: BeautifulLyrics["Type"]; enabled: number;
  reason: string; report_id: string | null; created_at: string; updated_at: string };
const publicRule = (row: BlockRow) => ({ id: row.id, spotifyId: row.spotify_id, provider: row.provider, lyricsType: row.lyrics_type,
  enabled: row.enabled === 1, reason: row.reason, reportId: row.report_id, createdAt: row.created_at, updatedAt: row.updated_at });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (message: string): never => { throw new SourceBlockError(400, message); };

export async function listSourceBlocks(db: D1Database, url: URL) {
  const filters: string[] = [];
  const values: (string | number)[] = [];
  const add = (sql: string, ...args: (string | number)[]) => { filters.push(sql); values.push(...args); };
  for (const [param, column, valid] of [
    ["spotifyId", "spotify_id", (v: string) => validSpotifyId(v)],
    ["source", "provider", (v: string) => sourceProviders.includes(v as typeof sourceProviders[number])],
    ["lyricsType", "lyrics_type", (v: string) => lyricsTypes.includes(v as BeautifulLyrics["Type"])]
  ] as const) {
    const value = url.searchParams.get(param);
    if (value) { if (!valid(value)) invalid(`Invalid ${param}`); add(`${column}=?`, value); }
  }
  const enabled = url.searchParams.get("enabled");
  if (enabled) { if (!["true", "false"].includes(enabled)) invalid("Invalid enabled filter"); add("enabled=?", enabled === "true" ? 1 : 0); }
  const cursor = url.searchParams.get("cursor");
  if (cursor) {
    const [date, id, ...extra] = cursor.split("|");
    if (!date || !id || extra.length || !Number.isFinite(Date.parse(date)) || !uuid.test(id)) invalid("Invalid cursor");
    add("(created_at < ? OR (created_at = ? AND id < ?))", date!, date!, id!);
  }
  const rows = await db.prepare(`SELECT * FROM source_blocks ${filters.length ? "WHERE " + filters.join(" AND ") : ""}
    ORDER BY created_at DESC,id DESC LIMIT 51`).bind(...values).all<BlockRow>();
  const items = rows.results.slice(0, 50);
  const last = items.at(-1);
  return { items: items.map(publicRule), nextCursor: rows.results.length > 50 && last ? `${last.created_at}|${last.id}` : null };
}

export async function sourceBlockDetail(db: D1Database, id: string) {
  const row = await db.prepare("SELECT * FROM source_blocks WHERE id=?").bind(id).first<BlockRow>();
  if (!row) throw new SourceBlockError(404, "Source block not found");
  const history = await db.prepare("SELECT id,created_at,enabled,reason,report_id FROM source_block_history WHERE block_id=? ORDER BY created_at,id")
    .bind(id).all<{ id: string; created_at: string; enabled: number; reason: string; report_id: string | null }>();
  return { ...publicRule(row), history: history.results.map(item => ({ id: item.id, createdAt: item.created_at,
    enabled: item.enabled === 1, reason: item.reason, reportId: item.report_id })) };
}

export async function putSourceBlock(db: D1Database, input: Record<string, unknown>) {
  const { spotifyId, provider, lyricsType, enabled, reason, reportId } = input;
  if (typeof spotifyId !== "string" || !validSpotifyId(spotifyId)) invalid("Invalid Spotify ID");
  if (typeof provider !== "string" || !sourceProviders.includes(provider as typeof sourceProviders[number])) invalid("Invalid provider");
  if (typeof lyricsType !== "string" || !lyricsTypes.includes(lyricsType as BeautifulLyrics["Type"])) invalid("Invalid lyrics type");
  if (typeof enabled !== "boolean") invalid("Invalid enabled flag");
  if (typeof reason !== "string" || reason.length > 2000) invalid("Invalid or overlong reason");
  if (reportId !== undefined && (typeof reportId !== "string" || !uuid.test(reportId))) invalid("Invalid report ID");
  if (reportId !== undefined) {
    const report = await db.prepare(`SELECT r.spotify_id,r.provider,s.original FROM lyric_reports r
      JOIN report_snapshots s ON s.report_id=r.id WHERE r.id=?`).bind(reportId).first<{ spotify_id: string; provider: string; original: string }>();
    if (!report) throw new SourceBlockError(404, "Report not found");
    if (report.spotify_id !== spotifyId || report.provider !== provider || JSON.parse(report.original).Type !== lyricsType) invalid("Rule does not match report");
  }
  const time = new Date().toISOString();
  const args = [spotifyId, provider, lyricsType] as [string, string, string];
  // changes() is evaluated immediately after the conditional upsert in this D1 transaction.
  // Identical concurrent/retried PUTs create neither a duplicate rule nor a history entry.
  const results = await db.batch([
    db.prepare(`INSERT INTO source_blocks(id,spotify_id,provider,lyrics_type,enabled,reason,report_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(spotify_id,provider,lyrics_type) DO UPDATE SET
      enabled=excluded.enabled,reason=excluded.reason,report_id=COALESCE(excluded.report_id,source_blocks.report_id),updated_at=excluded.updated_at
      WHERE source_blocks.enabled<>excluded.enabled OR source_blocks.reason<>excluded.reason
      OR source_blocks.report_id IS NOT COALESCE(excluded.report_id,source_blocks.report_id)`)
      .bind(crypto.randomUUID(), ...args, enabled ? 1 : 0, (reason as string).trim(), reportId ?? null, time, time),
    db.prepare(`INSERT INTO source_block_history(id,block_id,created_at,enabled,reason,report_id)
      SELECT ?,id,?,enabled,reason,report_id FROM source_blocks
      WHERE spotify_id=? AND provider=? AND lyrics_type=? AND changes()=1`).bind(crypto.randomUUID(), time, ...args),
    db.prepare("SELECT * FROM source_blocks WHERE spotify_id=? AND provider=? AND lyrics_type=?").bind(...args)
  ]);
  const row = results[2]?.results[0] as BlockRow | undefined;
  if (!row) throw new Error("Missing committed source block");
  return sourceBlockDetail(db, row.id);
}
