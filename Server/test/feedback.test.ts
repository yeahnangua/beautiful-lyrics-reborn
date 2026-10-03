import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { feedbackResponse } from "../src/feedback";
import { cleanupFeedback, saveDiagnostics, loadDiagnostics, hashLyrics } from "../src/diagnostics";
import { createWorker, type WorkerEnv } from "../src/index";
import type { RequestDiagnostics, BeautifulLyrics } from "../src/types";

let mf: Miniflare;
let db: D1Database;
let env: WorkerEnv;
const base = "https://lyrics.test";
const original: BeautifulLyrics = { Type: "Static", Lines: [{ Text: "  lyric <script>alert(1)</script>  " }] };
function payload(extra: Record<string, unknown> = {}) {
  return { submissionId: crypto.randomUUID(), track: { id: "track", name: "Song", artists: ["Artist"] },
    playbackPosition: 10, lyricsOffset: .2, extensionVersion: "5.2.2", fromCache: false, original, displayed: original, ...extra };
}
function record(extra: Partial<RequestDiagnostics> = {}): RequestDiagnostics {
  return { id: crypto.randomUUID(), track: { id: "track", name: "Song", artists: ["Artist"] },
    startedAt: new Date().toISOString(), durationMs: 12, outcome: "success",
    source: { Provider: "netease", Transport: "direct", TrackId: "123" }, attempts: [{ provider: "netease direct", stage: "syllable", startedAt: new Date().toISOString(), durationMs: 10, outcome: "success", retries: 0, upstream: [] }], ...extra };
}
async function call(path: string, method = "GET", data?: unknown, cookie?: string) {
  const headers: Record<string, string> = { "CF-Connecting-IP": "127.0.0.1" };
  if (method !== "GET") { headers["Content-Type"] = "application/json"; headers.Origin = base; }
  if (cookie) headers.Cookie = cookie;
  return (await feedbackResponse(new Request(base + path, { method, headers, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) }), env))!;
}
async function login() {
  const response = await call("/admin/api/login", "POST", { password: env.ADMIN_PASSWORD });
  expect(response.status).toBe(200);
  return response.headers.get("Set-Cookie")!.split(";")[0]!;
}
async function saveLegacyDiagnostics(log: RequestDiagnostics) {
  const { attempts, ...summary } = log;
  await db.batch([
    db.prepare(`INSERT INTO lyric_requests(id,created_at,spotify_id,song,artists,provider,outcome,data)
      VALUES(?,?,?,?,?,?,?,?)`).bind(log.id, log.startedAt, log.track.id, log.track.name,
      log.track.artists.join(", "), log.source?.Provider ?? "unknown", log.outcome, JSON.stringify(summary)),
    ...attempts.map((attempt, ordinal) => db.prepare("INSERT INTO provider_attempts(request_id,ordinal,data) VALUES(?,?,?)")
      .bind(log.id, ordinal, JSON.stringify(attempt)))
  ]);
}
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: ["FEEDBACK_DB"], compatibilityDate: "2026-05-22" });
  db = await mf.getD1Database("FEEDBACK_DB") as unknown as D1Database;
  for (const file of (await readdir("migrations")).filter(file => file.endsWith(".sql")).sort()) {
    const migration = await readFile("migrations/" + file, "utf8");
    // D1 exec accepts one statement per line. Preserve SQL semantics when stripping line comments.
    await db.exec(migration.replace(/^\s*--.*$/gm, "").replace(/\n/g, " "));
  }
}, 20000);
afterAll(async () => { await mf?.dispose(); });
beforeEach(async () => {
  env = { FEEDBACK_DB: db, ADMIN_PASSWORD: "test-password", ADMIN_SESSION_SECRET: "test-session-key-with-at-least-32-bytes",
    DIAGNOSTICS_SUCCESS_SAMPLE_RATE: "1", DIAGNOSTICS_FAILURE_SAMPLE_RATE: "1" };
  await db.batch(["lyric_reports", "lyric_requests", "rate_limits", "admin_sessions", "diagnostic_daily_budget"].map(table => db.prepare(`DELETE FROM ${table}`)));
});

describe("feedback with real local D1", () => {
  it("accepts empty optional fields, preserves snapshots, handles concurrent idempotent retries", async () => {
    const data = payload({ email: "", description: "", category: "" });
    const responses = await Promise.all([call("/reports", "POST", data), call("/reports", "POST", data)]);
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    const ids = await Promise.all(responses.map(response => response.json() as Promise<{ id: string }>));
    expect(ids[0]?.id).toBe(ids[1]?.id);
    const cookie = await login();
    const detail = await (await call("/admin/api/reports/" + ids[0]!.id, "GET", undefined, cookie)).json() as any;
    expect(detail.original).toEqual(original);
    expect(detail.category).toBe("other");
    expect(detail.diagnosticsAvailable).toBe(false);
    const count = await db.prepare("SELECT count(*) AS count FROM report_snapshots").first<{ count: number }>();
    expect(count?.count).toBe(1);
  });
  it.each([{ email: "bad@" }, { email: "a".repeat(255) }, { description: "a".repeat(2001) }, { category: "invalid" }, { submissionId: "invalid" }, { playbackPosition: null }, { original: { Type: "Unknown" } }])("rejects invalid report input %j", async extra => {
    expect((await call("/reports", "POST", payload(extra))).status).toBe(400);
  });
  it("limits streaming body size and IP submission rate, while permitting an idempotent retry", async () => {
    expect((await call("/reports", "POST", payload({ description: "a".repeat(1048576) }))).status).toBe(413);
    const first = payload();
    for (let i = 0; i < 5; i++) expect((await call("/reports", "POST", i === 0 ? first : payload())).status).toBe(201);
    expect((await call("/reports", "POST", payload())).status).toBe(429);
    for (let i = 0; i < 10; i++) expect((await call("/reports", "POST", payload())).status).toBe(429);
    expect((await db.prepare("SELECT count FROM rate_limits").first<{ count: number }>())?.count).toBe(5);
    expect((await call("/reports", "POST", first)).status).toBe(200);
  });
  it("copies diagnostics and fills in late waitUntil logs", async () => {
    const log = record();
    const response = await call("/reports", "POST", payload({ requestId: log.id, source: log.source }));
    const { id } = await response.json() as { id: string };
    await saveDiagnostics(db, log);
    expect(await loadDiagnostics(db, log.id)).toEqual(log);
    const cookie = await login();
    let detail = await (await call("/admin/api/reports/" + id, "GET", undefined, cookie)).json() as any;
    expect(detail.diagnostics).toEqual(log);
    await db.prepare("DELETE FROM lyric_requests WHERE id=?").bind(log.id).run();
    detail = await (await call("/admin/api/reports/" + id, "GET", undefined, cookie)).json() as any;
    expect(detail.diagnostics).toEqual(log);
    expect((await db.prepare("SELECT * FROM provider_attempts").all()).results).toHaveLength(0);
  });
  it("copies already persisted logs into new feedback", async () => {
    const log = record(); await saveDiagnostics(db, log);
    const { id } = await (await call("/reports", "POST", payload({ requestId: log.id }))).json() as { id: string };
    expect((await db.prepare("SELECT diagnostics FROM lyric_reports WHERE id=?").bind(id).first<{ diagnostics: string }>())?.diagnostics).toBe(JSON.stringify(log));
  });
  it.each(["packed", "legacy"])("closes the race between %s diagnostics lookup and report insert", async format => {
    const log = record();
    const originalPrepare = db.prepare.bind(db);
    let inserted = false;
    const racedDb = { ...db, prepare: (sql: string) => {
      const statement = originalPrepare(sql);
      if (sql === "SELECT data FROM lyric_requests WHERE id=?") return { bind: () => ({ first: async () => {
        if (!inserted) { inserted = true; await (format === "legacy" ? saveLegacyDiagnostics(log) : saveDiagnostics(db, log)); }
        return null;
      } }) };
      return statement;
    }, batch: db.batch.bind(db) } as unknown as D1Database;
    env.FEEDBACK_DB = racedDb;
    const { id } = await (await call("/reports", "POST", payload({ requestId: log.id }))).json() as { id: string };
    const saved = await db.prepare("SELECT diagnostics FROM lyric_reports WHERE id=?").bind(id).first<{ diagnostics: string }>();
    expect(JSON.parse(saved!.diagnostics)).toEqual(log);
  });
  it("authenticates all admin data, rejects CSRF, expires and revokes sessions", async () => {
    expect((await call("/admin/api/reports")).status).toBe(401);
    const cookie = await login();
    expect(cookie).toContain("__Host-lyrics_admin=");
    expect((await call("/admin/api/requests", "GET", undefined, cookie)).status).toBe(200);
    const hostile = await feedbackResponse(new Request(base + "/admin/api/logout", { method: "POST", headers: { Cookie: cookie, Origin: "https://evil.test" } }), env);
    expect(hostile?.status).toBe(403);
    expect(hostile?.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect((await call("/admin/api/logout", "POST", {}, cookie)).status).toBe(200);
    expect((await call("/admin/api/reports", "GET", undefined, cookie)).status).toBe(401);
    const next = await login();
    await db.prepare("UPDATE admin_sessions SET expires=0").run();
    expect((await call("/admin/api/reports", "GET", undefined, next)).status).toBe(401);
  });
  it("sets secure cookies and rate limits failed login", async () => {
    const response = await call("/admin/api/login", "POST", { password: env.ADMIN_PASSWORD });
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly; Secure; SameSite=Strict");
    for (let i = 0; i < 4; i++) expect((await call("/admin/api/login", "POST", { password: "wrong" })).status).toBe(401);
    expect((await call("/admin/api/login", "POST", { password: "wrong" })).status).toBe(429);
    for (let i = 0; i < 10; i++) expect((await call("/admin/api/login", "POST", { password: "wrong" })).status).toBe(429);
    expect((await db.prepare("SELECT count FROM rate_limits").first<{ count: number }>())?.count).toBe(5);
  });
  it("paginates 50 records without duplicates, applies filters and records processing history", async () => {
    const logs = Array.from({ length: 53 }, () => record({ startedAt: "2026-09-30T01:00:00.000Z" }));
    for (const log of logs) await saveDiagnostics(db, log);
    const cookie = await login();
    const page = await (await call("/admin/api/requests?q=Artist&source=netease&outcome=success&spotifyId=track", "GET", undefined, cookie)).json() as any;
    expect(page.items).toHaveLength(50);
    const second = await (await call("/admin/api/requests?cursor=" + encodeURIComponent(page.nextCursor), "GET", undefined, cookie)).json() as any;
    expect(second.items).toHaveLength(3);
    expect(new Set([...page.items, ...second.items].map(item => item.id)).size).toBe(53);
    expect((await (await call("/admin/api/requests?from=2026-10-01", "GET", undefined, cookie)).json() as any).items).toEqual([]);
    const { id } = await (await call("/reports", "POST", payload())).json() as { id: string };
    const updated = await (await call("/admin/api/reports/" + id, "PATCH", { status: "resolved", note: "Checked source" }, cookie)).json() as any;
    expect(updated.status).toBe("resolved");
    expect(updated.history).toEqual([expect.objectContaining({ status: "resolved", note: "Checked source" })]);
    const reports = await (await call("/admin/api/reports?status=resolved&category=other&q=Song", "GET", undefined, cookie)).json() as any;
    expect(reports.items[0].id).toBe(id);
    expect((await call("/admin/api/reports/" + id, "PATCH", { status: "bad" }, cookie)).status).toBe(400);
  });
  it("cleans expired rows with cascades and retains copied feedback logs", async () => {
    const old = record({ startedAt: new Date(Date.now() - 61 * 86400_000).toISOString() });
    await saveDiagnostics(db, old);
    const { id } = await (await call("/reports", "POST", payload({ requestId: old.id }))).json() as { id: string };
    await cleanupFeedback(db);
    expect(await loadDiagnostics(db, old.id)).toBeNull();
    expect((await db.prepare("SELECT diagnostics FROM lyric_reports WHERE id=?").bind(id).first())).not.toBeNull();
    await db.prepare("UPDATE lyric_reports SET created_at=?").bind(new Date(Date.now() - 366 * 86400_000).toISOString()).run();
    await cleanupFeedback(db);
    expect((await db.prepare("SELECT * FROM report_snapshots").all()).results).toEqual([]);
  });
  it("fails explicitly without D1 while lyrics continue without scheduling a write", async () => {
    delete env.FEEDBACK_DB;
    expect((await call("/reports", "POST", payload())).status).toBe(503);
    const pending: Promise<unknown>[] = [];
    const handler = createWorker({ getLyrics: async () => structuredClone(original) });
    const response = await handler.fetch!(new Request(base + "/lyrics/track", { headers: { Authorization: "Bearer PRIVATE" } }), {}, { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext);
    const lyrics = await response.json() as BeautifulLyrics;
    expect(lyrics.LyricsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(lyrics.RequestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(pending).toHaveLength(0);
    await Promise.all(pending);
  });
  it("schedules sampled logs through waitUntil", async () => {
    const pending: Promise<unknown>[] = [];
    const handler = createWorker({ getLyrics: async () => structuredClone(original) });
    const response = await handler.fetch!(new Request(base + "/lyrics/track", { headers: { Authorization: "Bearer PRIVATE" } }), env,
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext);
    const lyrics = await response.json() as BeautifulLyrics;
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect((await loadDiagnostics(db, lyrics.RequestId!))?.outcome).toBe("success");
  });
  it("keeps all provider attempts in one row and reads legacy logs", async () => {
    const log = record();
    log.attempts = Array.from({ length: 30 }, () => structuredClone(log.attempts[0]!));
    await saveDiagnostics(db, log);
    expect(await loadDiagnostics(db, log.id)).toEqual(log);
    expect((await db.prepare("SELECT * FROM provider_attempts").all()).results).toHaveLength(0);
    const legacy = record();
    await saveLegacyDiagnostics(legacy);
    expect(await loadDiagnostics(db, legacy.id)).toEqual(legacy);
    const { id } = await (await call("/reports", "POST", payload({ requestId: legacy.id }))).json() as { id: string };
    expect(JSON.parse((await db.prepare("SELECT diagnostics FROM lyric_reports WHERE id=?").bind(id).first<{ diagnostics: string }>())!.diagnostics)).toEqual(legacy);
  });
  it("enforces a global daily log cap even with concurrent writers, and resumes on a new UTC day", async () => {
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    await db.prepare("INSERT INTO diagnostic_daily_budget(day,count) VALUES(?,1000)").bind(yesterday).run();
    await Promise.all(Array.from({ length: 12 }, () => saveDiagnostics(db, record(), 3)));
    expect((await db.prepare("SELECT count(*) AS n FROM lyric_requests").first<{ n: number }>())?.n).toBe(3);
    expect((await db.prepare("SELECT count FROM diagnostic_daily_budget WHERE day=?").bind(new Date().toISOString().slice(0, 10)).first<{ count: number }>())?.count).toBe(3);
    // Rejected reservations do not increment the counter, even on later invocations.
    await saveDiagnostics(db, record(), 3);
    expect((await db.prepare("SELECT count(*) AS n FROM lyric_requests").first<{ n: number }>())?.n).toBe(3);
  });
  it.each(["sample rates", "daily limit"])("avoids D1 entirely when logging is disabled via %s", async setting => {
    if (setting === "sample rates") { env.DIAGNOSTICS_SUCCESS_SAMPLE_RATE = "0"; env.DIAGNOSTICS_FAILURE_SAMPLE_RATE = "0"; }
    else env.DIAGNOSTICS_DAILY_LIMIT = "0";
    const prepare = vi.fn(() => { throw Error("unexpected D1 query"); });
    env.FEEDBACK_DB = { prepare } as unknown as D1Database;
    for (const outcome of ["success", "none", "failed"] as const) {
      const handler = createWorker({ getLyrics: async () => { if (outcome === "failed") throw Error("upstream failed"); return outcome === "success" ? structuredClone(original) : undefined; } });
      const response = await handler.fetch!(new Request(base + "/lyrics/track", { headers: { Authorization: "Bearer PRIVATE" } }), env, {} as ExecutionContext);
      expect(response.status).toBe(outcome === "failed" ? 502 : 200);
    }
    expect(prepare).not.toHaveBeenCalled();
  });
  it("accepts feedback for an unsampled request and identifies the missing diagnostics", async () => {
    env.DIAGNOSTICS_SUCCESS_SAMPLE_RATE = "0";
    const handler = createWorker({ getLyrics: async () => structuredClone(original) });
    const response = await handler.fetch!(new Request(base + "/lyrics/track", { headers: { Authorization: "Bearer PRIVATE" } }), env, {} as ExecutionContext);
    const lyrics = await response.json() as BeautifulLyrics;
    const { id } = await (await call("/reports", "POST", payload({ requestId: lyrics.RequestId, lyricsHash: lyrics.LyricsHash }))).json() as { id: string };
    const detail = await (await call("/admin/api/reports/" + id, "GET", undefined, await login())).json() as any;
    expect(detail.original).toEqual(original);
    expect(detail.diagnosticsAvailable).toBe(false);
    expect(await loadDiagnostics(db, lyrics.RequestId!)).toBeNull();
  });
  it("bounds legacy attempt deletion before removing expired parents", async () => {
    const old = record({ startedAt: new Date(Date.now() - 61 * 86400_000).toISOString(), attempts: [] });
    await saveLegacyDiagnostics(old);
    await db.prepare(`WITH RECURSIVE ord(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM ord WHERE n<1004)
      INSERT INTO provider_attempts(request_id,ordinal,data) SELECT ?,n,'{}' FROM ord`).bind(old.id).run();
    await cleanupFeedback(db);
    expect((await db.prepare("SELECT count(*) AS n FROM provider_attempts").first<{ n: number }>())?.n).toBe(5);
    expect(await loadDiagnostics(db, old.id)).not.toBeNull();
    await cleanupFeedback(db);
    expect(await loadDiagnostics(db, old.id)).toBeNull();
    expect((await db.prepare("SELECT * FROM provider_attempts").all()).results).toHaveLength(0);
  });
  it.each(["none", "failed", "cancelled"] as const)("persists %s lyric request outcomes without credentials", async outcome => {
    const handler = createWorker({ getLyrics: async () => { if (outcome === "failed") throw Error("PRIVATE token"); return undefined; } });
    const controller = new AbortController();
    if (outcome === "cancelled") controller.abort();
    const response = await handler.fetch!(new Request(base + "/lyrics/track?track_name=Song&artist_name=Artist", {
      headers: { Authorization: "Bearer PRIVATE" }, signal: controller.signal
    }), env, {} as ExecutionContext);
    expect(response.status).toBe(outcome === "failed" ? 502 : 200);
    const row = await db.prepare("SELECT outcome,data FROM lyric_requests").first<{ outcome: string; data: string }>();
    expect(row?.outcome).toBe(outcome);
    expect(row?.data).not.toContain("PRIVATE");
  });
  it("does not let storage failures fail a lyric response", async () => {
    const broken = { prepare: () => { throw Error("db offline"); } } as unknown as D1Database;
    env.FEEDBACK_DB = broken;
    expect((await call("/reports", "POST", payload())).status).toBe(503);
    const handler = createWorker({ getLyrics: async () => structuredClone(original) });
    const response = await handler.fetch!(new Request(base + "/lyrics/track", { headers: { Authorization: "Bearer PRIVATE" } }), env, {} as ExecutionContext);
    expect(response.status).toBe(200);
  });
  it("hashes lyrics and timing independently of provenance", async () => {
    const lyrics = { ...original, Source: { Provider: "spotify", Transport: "direct" as const }, RequestId: crypto.randomUUID() };
    expect(await hashLyrics(lyrics)).toBe(await hashLyrics(original));
    expect(await hashLyrics(original)).not.toBe(await hashLyrics({ Type: "Static", Lines: [{ Text: "different" }] }));
    const line: BeautifulLyrics = { Type: "Line", StartTime: 1, EndTime: 2, Content: [] };
    expect(await hashLyrics(line)).not.toBe(await hashLyrics({ ...line, StartTime: 1.1 }));
  });
});
