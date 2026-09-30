import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { feedbackResponse, type FeedbackEnv } from "../src/feedback";
import { cleanupFeedback, saveDiagnostics, loadDiagnostics, hashLyrics } from "../src/diagnostics";
import { createWorker } from "../src/index";
import type { RequestDiagnostics, BeautifulLyrics } from "../src/types";

let mf: Miniflare;
let db: D1Database;
let env: FeedbackEnv;
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
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: ["FEEDBACK_DB"], compatibilityDate: "2026-05-22" });
  db = await mf.getD1Database("FEEDBACK_DB") as unknown as D1Database;
  const migration = await readFile("migrations/0001_feedback.sql", "utf8");
  // D1 exec accepts one statement per line. Execute the real migration, not a mocked SQL adapter.
  await db.exec(migration.replace(/\n/g, " "));
}, 20000);
afterAll(async () => { await mf?.dispose(); });
beforeEach(async () => {
  env = { FEEDBACK_DB: db, ADMIN_PASSWORD: "test-password", ADMIN_SESSION_SECRET: "test-session-key-with-at-least-32-bytes" };
  await db.batch(["lyric_reports", "lyric_requests", "rate_limits", "admin_sessions"].map(table => db.prepare(`DELETE FROM ${table}`)));
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
  it("closes the race between diagnostics lookup and report insert", async () => {
    const log = record();
    const originalPrepare = db.prepare.bind(db);
    let inserted = false;
    const racedDb = { ...db, prepare: (sql: string) => {
      const statement = originalPrepare(sql);
      if (sql === "SELECT data FROM lyric_requests WHERE id=?") return { bind: () => ({ first: async () => {
        if (!inserted) { inserted = true; await saveDiagnostics(db, log); }
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
  it("fails explicitly without D1 while lyrics continue and logs use waitUntil", async () => {
    delete env.FEEDBACK_DB;
    expect((await call("/reports", "POST", payload())).status).toBe(503);
    const pending: Promise<unknown>[] = [];
    const handler = createWorker({ getLyrics: async () => structuredClone(original) });
    const response = await handler.fetch!(new Request(base + "/lyrics/track", { headers: { Authorization: "Bearer PRIVATE" } }), {}, { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext);
    const lyrics = await response.json() as BeautifulLyrics;
    expect(lyrics.LyricsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(lyrics.RequestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
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
