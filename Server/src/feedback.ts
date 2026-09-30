import { adminHtml } from "./admin";
import { loadDiagnostics, sha256 } from "./diagnostics";
import type { BeautifulLyrics, LyricsSource, TrackMetadata } from "./types";

export type FeedbackEnv = {
  FEEDBACK_DB?: D1Database;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
};
const reportCors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const statuses = ["pending", "in_progress", "resolved", "ignored"];
const categories = ["lyrics", "timing", "version", "display", "other"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Invalid object");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, optional = false): string {
  if (optional && (value === undefined || value === null)) return "";
  if (typeof value !== "string" || value.length > max) throw new HttpError(400, "Invalid or overlong text");
  return value.trim();
}
function numeric(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HttpError(400, "Invalid number");
  return value;
}
async function body(request: Request, limit = 1048576): Promise<Record<string, unknown>> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Expected application/json");
  if (Number(request.headers.get("Content-Length")) > limit) throw new HttpError(413, "Request too large");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel(); throw new HttpError(413, "Request too large"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return object(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON body");
  } finally { reader.releaseLock(); }
}
function source(value: unknown): LyricsSource | undefined {
  if (value === undefined) return undefined;
  const input = object(value);
  const Provider = text(input.Provider, 50);
  if (!/^[a-z0-9_-]+$/.test(Provider) || !["direct", "lyrically"].includes(String(input.Transport))) throw new HttpError(400, "Invalid source");
  const result: LyricsSource = { Provider, Transport: input.Transport as LyricsSource["Transport"] };
  for (const key of ["TrackId", "LyricsId", "MatchedTitle"] as const) {
    if (input[key] !== undefined) result[key] = text(input[key], key === "MatchedTitle" ? 500 : 300);
  }
  return result;
}
const snapshotKeys = new Set(["Type", "Text", "Lines", "Content", "StartTime", "EndTime", "OppositeAligned", "Lead", "Background", "Syllables", "IsPartOfWord", "NaturalAlignment", "Language"]);
function cleanSnapshot(value: unknown, depth = 0): unknown {
  if (depth > 8) throw new HttpError(400, "Invalid snapshot depth");
  if (typeof value === "string") { text(value, 10000); return value; }
  if (typeof value === "number") return numeric(value);
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (value.length > 10000) throw new HttpError(400, "Invalid snapshot length");
    return value.map(item => cleanSnapshot(item, depth + 1));
  }
  return Object.fromEntries(Object.entries(object(value)).filter(([key]) => snapshotKeys.has(key))
    .map(([key, child]) => [key, cleanSnapshot(child, depth + 1)]));
}
function snapshot(value: unknown): BeautifulLyrics {
  const clean = object(cleanSnapshot(value));
  if (!["Static", "Line", "Syllable"].includes(String(clean.Type)) ||
      !Array.isArray(clean.Type === "Static" ? clean.Lines : clean.Content)) throw new HttpError(400, "Invalid lyric snapshot");
  return clean as BeautifulLyrics;
}
function reportPayload(input: Record<string, unknown>) {
  const submissionId = text(input.submissionId, 36);
  if (!uuid.test(submissionId)) throw new HttpError(400, "Invalid submission ID");
  const trackInput = object(input.track);
  const track: TrackMetadata = { id: text(trackInput.id, 100), name: text(trackInput.name, 500), artists: [] };
  if (!/^[a-zA-Z0-9]+$/.test(track.id) || track.name.length === 0 || !Array.isArray(trackInput.artists) || trackInput.artists.length > 30) throw new HttpError(400, "Invalid track");
  track.artists = trackInput.artists.map(artist => text(artist, 300));
  const category = text(input.category, 30, true) || "other";
  if (!categories.includes(category)) throw new HttpError(400, "Invalid category");
  const email = text(input.email, 254, true);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Invalid email");
  const requestId = text(input.requestId, 36, true);
  if (requestId && !uuid.test(requestId)) throw new HttpError(400, "Invalid request ID");
  const lyricsHash = text(input.lyricsHash, 64, true);
  if (lyricsHash && !/^[a-f0-9]{64}$/i.test(lyricsHash)) throw new HttpError(400, "Invalid lyrics hash");
  const retrievedAt = text(input.retrievedAt, 40, true);
  if (retrievedAt && !Number.isFinite(Date.parse(retrievedAt))) throw new HttpError(400, "Invalid retrieved time");
  if (typeof input.fromCache !== "boolean") throw new HttpError(400, "Invalid cache flag");
  return { submissionId, track, category, email, description: text(input.description, 2000, true),
    requestId, lyricsHash, retrievedAt, source: source(input.source), playbackPosition: numeric(input.playbackPosition),
    lyricsOffset: numeric(input.lyricsOffset), extensionVersion: text(input.extensionVersion, 80),
    fromCache: input.fromCache, original: snapshot(input.original), displayed: snapshot(input.displayed) };
}
async function rateLimit(db: D1Database, request: Request, kind: string): Promise<void> {
  const key = await sha256(kind + ":" + (request.headers.get("CF-Connecting-IP") ?? "local"));
  const minute = Math.floor(Date.now() / 60000);
  const row = await db.prepare(`INSERT INTO rate_limits(key,minute,count) VALUES(?,?,1)
    ON CONFLICT(key,minute) DO UPDATE SET count=count+1 RETURNING count`).bind(key, minute).first<{ count: number }>();
  if (!row || row.count > 5) throw new HttpError(429, "Too many requests; retry in a minute");
}
async function signature(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function equals(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
const cookieName = "__Host-lyrics_admin";
function cookie(value: string, seconds: number): string {
  return `${cookieName}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Strict`;
}
async function session(request: Request, env: FeedbackEnv, db: D1Database): Promise<string> {
  const token = request.headers.get("Cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
  const parts = token?.split(".");
  if (!parts || parts.length !== 3 || !env.ADMIN_SESSION_SECRET) throw new HttpError(401, "Sign in required");
  const [id, expires, mac] = parts as [string, string, string];
  if (!uuid.test(id) || !/^\d+$/.test(expires) || Number(expires) <= Date.now() ||
    !await equals(mac, await signature(env.ADMIN_SESSION_SECRET, `${id}.${expires}`))) throw new HttpError(401, "Session expired");
  const found = await db.prepare("SELECT id FROM admin_sessions WHERE id=? AND expires>?").bind(id, Date.now()).first();
  if (!found) throw new HttpError(401, "Session expired");
  return id;
}
function sameOrigin(request: Request): void {
  if (request.headers.get("Origin") !== new URL(request.url).origin) throw new HttpError(403, "Same-origin request required");
}
async function list(db: D1Database, url: URL, reports: boolean) {
  const filters: string[] = [];
  const values: (string | number)[] = [];
  const add = (clause: string, ...items: (string | number)[]) => { filters.push(clause); values.push(...items); };
  const query = url.searchParams.get("q");
  if (query) add("(instr(lower(song),lower(?))>0 OR instr(lower(artists),lower(?))>0)", query, query);
  for (const [param, column] of [["spotifyId", "spotify_id"], ["source", "provider"], ["requestId", reports ? "request_id" : "id"], ...(reports ? [["category", "category"], ["status", "status"]] : [["outcome", "outcome"]])]) {
    const value = url.searchParams.get(param!);
    if (value) add(`${column}=?`, value);
  }
  for (const [param, operator] of [["from", ">="], ["to", "<="]]) {
    const value = url.searchParams.get(param!);
    if (value) {
      if (!Number.isFinite(Date.parse(value))) throw new HttpError(400, "Invalid date filter");
      add(`created_at${operator}?`, new Date(value).toISOString());
    }
  }
  const cursor = url.searchParams.get("cursor");
  if (cursor) {
    const [date, id, ...extra] = cursor.split("|");
    if (!date || !id || extra.length || !Number.isFinite(Date.parse(date)) || !uuid.test(id)) throw new HttpError(400, "Invalid cursor");
    add("(created_at < ? OR (created_at = ? AND id < ?))", date, date, id);
  }
  const rows = await db.prepare(`SELECT id,created_at,spotify_id,song,artists,provider,${reports ? "category,status,request_id" : "outcome"}
    FROM ${reports ? "lyric_reports" : "lyric_requests"} ${filters.length ? "WHERE " + filters.join(" AND ") : ""}
    ORDER BY created_at DESC,id DESC LIMIT 51`).bind(...values).all<Record<string, string>>();
  const items = rows.results.slice(0, 50);
  const last = items.at(-1);
  return { items, nextCursor: rows.results.length > 50 && last ? `${last.created_at}|${last.id}` : null };
}
async function reportDetail(db: D1Database, id: string) {
  const row = await db.prepare("SELECT * FROM lyric_reports WHERE id=?").bind(id).first<{ id: string; created_at: string; status: string; request_id: string | null; data: string; diagnostics: string | null }>();
  if (!row) throw new HttpError(404, "Report not found");
  const snapshots = await db.prepare("SELECT original,displayed FROM report_snapshots WHERE report_id=?").bind(id).first<{ original: string; displayed: string }>();
  const history = await db.prepare("SELECT created_at,status,note FROM report_history WHERE report_id=? ORDER BY created_at,id").bind(id).all();
  const diagnostics = row.diagnostics ? JSON.parse(row.diagnostics) : row.request_id ? await loadDiagnostics(db, row.request_id) : null;
  return { id: row.id, createdAt: row.created_at, ...JSON.parse(row.data), status: row.status,
    original: snapshots ? JSON.parse(snapshots.original) : null, displayed: snapshots ? JSON.parse(snapshots.displayed) : null,
    diagnostics, diagnosticsAvailable: diagnostics !== null, history: history.results };
}
export async function feedbackResponse(request: Request, env: FeedbackEnv): Promise<Response | undefined> {
  const url = new URL(request.url);
  const isReport = url.pathname === "/reports";
  const isAdmin = url.pathname === "/admin" || url.pathname.startsWith("/admin/");
  if (!isReport && !isAdmin) return undefined;
  const headers = isReport ? reportCors : {};
  try {
    if (isReport && request.method === "OPTIONS") return new Response(null, { status: 204, headers: reportCors });
    if (url.pathname === "/admin" && request.method === "GET") return new Response(adminHtml, { headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    } });
    const db = env.FEEDBACK_DB;
    if (!db) throw new HttpError(503, "Feedback storage is unavailable; retry later");
    if (isReport) {
      if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
      const payload = reportPayload(await body(request));
      const previous = await db.prepare("SELECT id FROM lyric_reports WHERE submission_id=?").bind(payload.submissionId).first<{ id: string }>();
      if (previous) return json({ id: previous.id }, 200, headers);
      await rateLimit(db, request, "report");
      const { original, displayed, ...data } = payload;
      const id = crypto.randomUUID();
      const diagnostics = payload.requestId ? await loadDiagnostics(db, payload.requestId) : null;
      await db.batch([
        db.prepare(`INSERT INTO lyric_reports(id,submission_id,created_at,spotify_id,song,artists,provider,category,request_id,data,diagnostics)
          VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(submission_id) DO NOTHING`).bind(id, payload.submissionId, new Date().toISOString(), payload.track.id,
          payload.track.name, payload.track.artists.join(", "), payload.source?.Provider ?? "unknown", payload.category, payload.requestId || null,
          JSON.stringify(data), diagnostics ? JSON.stringify(diagnostics) : null),
        db.prepare(`INSERT INTO report_snapshots(report_id,original,displayed) SELECT id,?,? FROM lyric_reports WHERE submission_id=?
          ON CONFLICT(report_id) DO NOTHING`).bind(JSON.stringify(original), JSON.stringify(displayed), payload.submissionId),
        // Close the race where logging committed after the first lookup but before this batch.
        db.prepare(`UPDATE lyric_reports SET diagnostics=(SELECT json_set(data,'$.attempts',json(COALESCE(
          (SELECT json_group_array(json(data)) FROM (SELECT data FROM provider_attempts WHERE request_id=? ORDER BY ordinal)),'[]')))
          FROM lyric_requests WHERE id=?) WHERE submission_id=? AND diagnostics IS NULL`).bind(payload.requestId, payload.requestId, payload.submissionId)
      ]);
      const saved = await db.prepare("SELECT id FROM lyric_reports WHERE submission_id=?").bind(payload.submissionId).first<{ id: string }>();
      if (!saved) throw new Error("Missing committed report");
      return json({ id: saved.id }, 201, headers);
    }
    if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32) throw new HttpError(503, "Admin authentication is not configured");
    if (request.method !== "GET") sameOrigin(request);
    if (url.pathname === "/admin/api/login" && request.method === "POST") {
      await rateLimit(db, request, "login");
      const passwordInput = (await body(request, 4096)).password;
      text(passwordInput, 1024);
      const password = passwordInput as string;
      if (!await equals(password, env.ADMIN_PASSWORD)) throw new HttpError(401, "Incorrect password");
      const id = crypto.randomUUID();
      const expires = Date.now() + 12 * 3600_000;
      await db.prepare("INSERT INTO admin_sessions(id,expires) VALUES(?,?)").bind(id, expires).run();
      return json({ ok: true }, 200, { "Set-Cookie": cookie(`${id}.${expires}.${await signature(env.ADMIN_SESSION_SECRET, `${id}.${expires}`)}`, 43200) });
    }
    const sessionId = await session(request, env, db);
    if (url.pathname === "/admin/api/logout" && request.method === "POST") {
      await db.prepare("DELETE FROM admin_sessions WHERE id=?").bind(sessionId).run();
      return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
    }
    const match = /^\/admin\/api\/(reports|requests)(?:\/([a-f0-9-]+))?$/.exec(url.pathname);
    if (!match) throw new HttpError(404, "Not found");
    const reports = match[1] === "reports";
    const id = match[2];
    if (request.method === "GET") {
      if (!id) return json(await list(db, url, reports));
      if (reports) return json(await reportDetail(db, id));
      const data = await loadDiagnostics(db, id);
      if (!data) throw new HttpError(404, "Request log unavailable or expired");
      return json(data);
    }
    if (reports && id && request.method === "PATCH") {
      const input = await body(request, 16000);
      const status = text(input.status, 30);
      const note = text(input.note, 2000, true);
      if (!statuses.includes(status)) throw new HttpError(400, "Invalid report status");
      const results = await db.batch([
        db.prepare("UPDATE lyric_reports SET status=? WHERE id=?").bind(status, id),
        db.prepare("INSERT INTO report_history(id,report_id,created_at,status,note) SELECT ?,id,?,?,? FROM lyric_reports WHERE id=?")
          .bind(crypto.randomUUID(), new Date().toISOString(), status, note, id)
      ]);
      if (results[0]?.meta.changes === 0) throw new HttpError(404, "Report not found");
      return json(await reportDetail(db, id));
    }
    throw new HttpError(405, "Method not allowed");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    return json({ error: error instanceof HttpError ? error.message : "Storage operation failed; retry later" }, status,
      { ...headers, ...(status === 429 ? { "Retry-After": "60" } : {}) });
  }
}
