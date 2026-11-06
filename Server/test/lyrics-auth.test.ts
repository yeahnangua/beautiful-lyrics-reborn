import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorker } from "../src/index";
import { createLyricsAuth, createLyricsSession, type LyricsAuthEnv } from "../src/lyrics-auth";
import { LyricsSessionHeader, LyricsSessionLifetimeMs, type LyricsSession } from "../../Universal/Modules/LyricsSession";
import { lyricsAuthFixture, spotifyClientHeaders, spotifyProbeBody, spotifyProbeUrl, testSessionSecret } from "./lyrics-auth-fixture";

const sessionRequest = (token = "spotify-private", method = "POST") => new Request("https://lyrics.test/auth/lyrics-session", {
  method, headers: { Authorization: `Bearer ${token}`, "CF-Connecting-IP": "203.0.113.10", ...spotifyClientHeaders }
}) as Request<unknown, IncomingRequestCfProperties>;
const lyricsRequest = (headers: HeadersInit) => new Request("https://lyrics.test/lyrics/track?track_name=Song&artist_name=Artist", { headers }) as Request<unknown, IncomingRequestCfProperties>;
afterEach(() => vi.useRealTimers());

describe("Spotify-verified lyrics sessions", () => {
  it("issues a ten-minute session only after Spotify returns lyrics, without credentials or probe lyrics in telemetry", async () => {
    const fixture = await lyricsAuthFixture();
    const writeDataPoint = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(spotifyProbeBody));
    const now = Date.now();
    const auth = createLyricsAuth(fetcher, () => now);
    const response = await auth.session(sessionRequest(), { ...fixture.env, METRICS: { writeDataPoint } as unknown as AnalyticsEngineDataset });
    expect(response.status).toBe(200);
    const session = await response.json() as LyricsSession;
    expect(session.expiresAt).toBe(now + LyricsSessionLifetimeMs);
    expect(fetcher).toHaveBeenCalledWith(spotifyProbeUrl, expect.objectContaining({
      headers: { Authorization: "Bearer spotify-private", "App-Platform": "OSX_ARM64", "Spotify-App-Version": "1.3.8.620", Accept: "application/json" },
      redirect: "manual", cache: "no-store", signal: expect.any(AbortSignal)
    }));
    const claims = JSON.parse(Buffer.from(session.token.split(".")[0]!, "base64url").toString());
    expect(claims).not.toHaveProperty("subject");
    expect(claims.spotify).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify([claims, writeDataPoint.mock.calls])).not.toMatch(/spotify-private|verification lyrics/);
    const access = await auth.authorize(lyricsRequest({ Authorization: "Bearer spotify-private", [LyricsSessionHeader]: session.token }), fixture.env);
    expect(access).toEqual({ accessToken: "spotify-private" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const name of ["Cache-Control", "CDN-Cache-Control", "Cloudflare-CDN-Cache-Control"]) expect(response.headers.get(name)).toContain("no-store");
  });

  it.each([302, 401, 403, 429, 500])("maps Spotify %s without returning its response body", async status => {
    const fixture = await lyricsAuthFixture();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("PRIVATE upstream detail", { status, headers: { "Retry-After": "123" } }));
    const response = await createLyricsAuth(fetcher).session(sessionRequest(), fixture.env);
    expect(response.status).toBe(status === 500 || status === 302 ? 503 : status);
    const expected = status === 401 ? "invalid_spotify_token" : status === 403 ? "spotify_forbidden" : status === 429 ? "rate_limited" : "auth_unavailable";
    expect(await response.json()).toMatchObject({ code: expected });
    if (status === 429) expect(response.headers.get("Retry-After")).toBe("123");
  });

  it.each([null, {}, { id: "listener" }, { lyrics: null }, { lyrics: { lines: [] } },
    { lyrics: { lines: "fake" } }, { lyrics: { lines: [{ words: 123 }] } },
    { lyrics: { lines: [null, { words: "  " }] } }])("does not authorize a successful response without usable lyrics", async payload => {
    const fixture = await lyricsAuthFixture();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    const response = await createLyricsAuth(fetcher).session(sessionRequest(), fixture.env);
    expect(response.status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("tries one fixed fallback probe on 404 and never accepts a caller-supplied resource or account", async () => {
    const fixture = await lyricsAuthFixture();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json(spotifyProbeBody));
    const request = new Request(sessionRequest(), { body: JSON.stringify({
      track: "caller-controlled", account_id: "forged-account", url: "https://untrusted.test"
    }) });
    const response = await createLyricsAuth(fetcher).session(request, fixture.env);
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      spotifyProbeUrl, spotifyProbeUrl.replace("6OsRo5kez17uDLwddaKfrI", "4PTG3Z6ehGkBFwjybzWkR8")
    ]);
    expect(await response.text()).not.toContain("forged-account");
  });

  it("fails closed if both fixed probes are unavailable", async () => {
    const fixture = await lyricsAuthFixture();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 404 }));
    expect((await createLyricsAuth(fetcher).session(sessionRequest(), fixture.env)).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("requires bounded client metadata instead of silently guessing WebPlayer", async () => {
    const fixture = await lyricsAuthFixture();
    const fetcher = vi.fn<typeof fetch>();
    for (const [name, value] of [
      ["X-Spotify-App-Platform", ""], ["X-Spotify-App-Version", ""],
      ["X-Spotify-App-Platform", "https://other.test"], ["X-Spotify-App-Version", "x".repeat(65)]
    ]) {
      const request = sessionRequest();
      request.headers.set(name!, value!);
      const response = await createLyricsAuth(fetcher).session(request, fixture.env);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_spotify_client" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("limits session issuance by IP before calling Spotify, and counts only anonymous outcomes", async () => {
    const fixture = await lyricsAuthFixture();
    fixture.env.LYRICS_SESSION_LIMITER.limit.mockResolvedValue({ success: false });
    const fetcher = vi.fn<typeof fetch>();
    const writeDataPoint = vi.fn();
    const result = await createLyricsAuth(fetcher).session(sessionRequest(), { ...fixture.env, METRICS: { writeDataPoint } as unknown as AnalyticsEngineDataset });
    expect(result.status).toBe(429);
    expect(result.headers.get("Retry-After")).toBe("60");
    expect(fetcher).not.toHaveBeenCalled();
    expect(fixture.env.LYRICS_SESSION_LIMITER.limit.mock.calls[0]?.[0].key).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(writeDataPoint.mock.calls)).toContain("rate_limited");
    expect(JSON.stringify(writeDataPoint.mock.calls)).not.toMatch(/203\.0\.113|spotify-private/);
  });

  it.each(["fetch", "body"])("bounds a stalled Spotify %s to five seconds", async phase => {
    const fixture = await lyricsAuthFixture();
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (phase === "fetch") return new Promise<Response>(() => {});
      return { ok: true, status: 200, json: () => new Promise(() => {}) } as Response;
    });
    const pending = createLyricsAuth(fetcher).session(sessionRequest(), fixture.env);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).status).toBe(503);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("supports unauthenticated preflight but requires a POST and a bearer to issue", async () => {
    const fixture = await lyricsAuthFixture();
    const fetcher = vi.fn<typeof fetch>();
    const auth = createLyricsAuth(fetcher);
    const options = await auth.session(new Request("https://lyrics.test/auth/lyrics-session", { method: "OPTIONS" }), {});
    expect(options.status).toBe(204);
    expect(options.headers.get("Access-Control-Allow-Headers")).toContain(LyricsSessionHeader);
    expect(options.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");
    expect((await auth.session(sessionRequest("token", "GET"), fixture.env)).status).toBe(405);
    for (const value of ["", "Basic token", "Bearer", "Bearer two tokens"]) {
      expect((await auth.session(new Request("https://lyrics.test/auth/lyrics-session", { method: "POST", headers: { Authorization: value } }), fixture.env)).status).toBe(401);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("lyrics authorization gate", () => {
  it("requires a signed, unexpired session bound to the exact Spotify token before any DB or provider work", async () => {
    const fixture = await lyricsAuthFixture("spotify-private");
    const getLyrics = vi.fn();
    const prepare = vi.fn(() => { throw Error("Database must not be touched"); });
    const env = { ...fixture.env, FEEDBACK_DB: { prepare } as unknown as D1Database, LYRICS_CACHE_DB: { prepare } as unknown as D1Database };
    const worker = createWorker({ getLyrics });
    const expired = await createLyricsSession(testSessionSecret, "spotify-private", Date.now() - LyricsSessionLifetimeMs);
    const future = await createLyricsSession(testSessionSecret, "spotify-private", Date.now() + 10_000);
    const otherSecret = await createLyricsSession("another-completely-separate-32-byte-secret", "spotify-private");
    const changed = fixture.session.token.slice(0, -4) + "AAAA";
    for (const headers of [
      {}, { Authorization: "Bearer anything" },
      { Authorization: "Bearer different", [LyricsSessionHeader]: fixture.session.token },
      ...["fake", changed, expired.token, future.token, otherSecret.token, "x".repeat(2049)].map(token => ({ Authorization: "Bearer spotify-private", [LyricsSessionHeader]: token }))
    ]) {
      const response = await worker.fetch!(lyricsRequest(headers), env, {} as ExecutionContext);
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(getLyrics).not.toHaveBeenCalled();
    expect(fixture.env.LYRICS_TOKEN_LIMITER.limit).not.toHaveBeenCalled();
    expect(fixture.env.LYRICS_IP_LIMITER.limit).not.toHaveBeenCalled();
  });

  it.each(["LYRICS_SESSION_SECRET", "LYRICS_SESSION_LIMITER", "LYRICS_TOKEN_LIMITER", "LYRICS_IP_LIMITER"] as const)("fails closed when %s is missing", async binding => {
    const fixture = await lyricsAuthFixture();
    const env: LyricsAuthEnv = { ...fixture.env };
    delete env[binding];
    const auth = createLyricsAuth(vi.fn());
    expect((await auth.session(sessionRequest(), env)).status).toBe(503);
    const response = await auth.authorize(lyricsRequest(fixture.headers), env) as Response;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "auth_unavailable" });
  });

  it("preserves the token quota across renewed sessions and different caller IPs", async () => {
    const one = await lyricsAuthFixture("first-token");
    const two = await lyricsAuthFixture("first-token");
    const other = await lyricsAuthFixture("third-token");
    const counts = new Map<string, number>();
    one.env.LYRICS_TOKEN_LIMITER.limit.mockImplementation(async ({ key }) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { success: counts.get(key)! <= 1 };
    });
    const auth = createLyricsAuth(vi.fn());
    expect(await auth.authorize(lyricsRequest(one.headers), one.env)).toEqual({ accessToken: "first-token" });
    const limited = await auth.authorize(lyricsRequest({ ...two.headers, "CF-Connecting-IP": "203.0.113.11" }), one.env) as Response;
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(await auth.authorize(lyricsRequest(other.headers), one.env)).toEqual({ accessToken: "third-token" });
    expect(counts.size).toBe(2);
  });

  it("preserves the IP quota when the Spotify token changes", async () => {
    const one = await lyricsAuthFixture("first-token");
    const two = await lyricsAuthFixture("refreshed-token");
    const counts = new Map<string, number>();
    one.env.LYRICS_IP_LIMITER.limit.mockImplementation(async ({ key }) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { success: counts.get(key)! <= 1 };
    });
    const auth = createLyricsAuth(vi.fn());
    expect(await auth.authorize(lyricsRequest({ ...one.headers, "CF-Connecting-IP": "203.0.113.10" }), one.env)).toEqual({ accessToken: "first-token" });
    const limited = await auth.authorize(lyricsRequest({ ...two.headers, "CF-Connecting-IP": "203.0.113.10", "X-Forwarded-For": "198.51.100.1" }), one.env) as Response;
    expect(limited.status).toBe(429);
    expect(one.env.LYRICS_TOKEN_LIMITER.limit).toHaveBeenCalledTimes(1);
    expect(await auth.authorize(lyricsRequest({ ...two.headers, "CF-Connecting-IP": "203.0.113.11" }), one.env)).toEqual({ accessToken: "refreshed-token" });
  });

  it("fails closed when any limiter throws", async () => {
    const fixture = await lyricsAuthFixture();
    fixture.env.LYRICS_SESSION_LIMITER.limit.mockRejectedValue(Error("private limiter failure"));
    fixture.env.LYRICS_TOKEN_LIMITER.limit.mockRejectedValue(Error("private limiter failure"));
    const auth = createLyricsAuth(vi.fn());
    expect((await auth.session(sessionRequest(), fixture.env)).status).toBe(503);
    const response = await auth.authorize(lyricsRequest(fixture.headers), fixture.env) as Response;
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
    fixture.env.LYRICS_IP_LIMITER.limit.mockRejectedValue(Error("private IP limiter failure"));
    expect((await auth.authorize(lyricsRequest(fixture.headers), fixture.env) as Response).status).toBe(503);
  });

  it("routes the session endpoint and keeps empty lyrics responses private", async () => {
    const fixture = await lyricsAuthFixture();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(spotifyProbeBody));
    const getLyrics = vi.fn().mockResolvedValue(undefined);
    const worker = createWorker({ getLyrics }, createLyricsAuth(fetcher));
    expect((await worker.fetch!(sessionRequest(), fixture.env, {} as ExecutionContext)).status).toBe(200);
    expect(getLyrics).not.toHaveBeenCalled();
    const response = await worker.fetch!(lyricsRequest(fixture.headers), fixture.env, {} as ExecutionContext);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
