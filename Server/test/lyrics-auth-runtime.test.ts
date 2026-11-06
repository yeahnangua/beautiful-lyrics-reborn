import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { Miniflare, Request as RuntimeRequest, Response as RuntimeResponse } from "miniflare";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LyricsSessionHeader, type LyricsSession } from "../../Universal/Modules/LyricsSession";
import { spotifyClientHeaders, spotifyProbeBody, spotifyProbeUrl, testSessionSecret } from "./lyrics-auth-fixture";

let modules: { type: "ESModule"; path: string; contents: string }[];

// Run the actual auth code and its HTTP wrapper inside workerd. Node fetch and
// mocked fetch do not reject unsupported Worker options such as redirect:error.
beforeAll(async () => {
  const dependencies = await Promise.all([
    "../src/lyrics-auth.ts", "../../Universal/Modules/Async.ts",
    "../../Universal/Modules/Http.ts", "../../Universal/Modules/LyricsSession.ts"
  ].map(async relative => {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    const contents = transpileModule(await readFile(path, "utf8"), {
      compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext }
    }).outputText;
    return { type: "ESModule" as const, path: path.replace(/\.ts$/, ""), contents };
  }));
  modules = [{
    type: "ESModule", path: fileURLToPath(new URL("./lyrics-auth-runtime-worker.mjs", import.meta.url)),
    contents: `import { createLyricsAuth } from "../src/lyrics-auth";
      const auth = createLyricsAuth();
      export default { async fetch(request, env) {
        if (new URL(request.url).pathname === "/auth/lyrics-session") return auth.session(request, env);
        const access = await auth.authorize(request, env);
        return access instanceof Response ? access : Response.json({ authenticated: true });
      } };`
  }, ...dependencies];
});

function runtime(outboundService: (request: RuntimeRequest) => RuntimeResponse, tokenLimit = 60, ipLimit = 300) {
  return new Miniflare({
    modules, modulesRoot: fileURLToPath(new URL("../../", import.meta.url)),
    compatibilityDate: "2026-05-22",
    bindings: { LYRICS_SESSION_SECRET: testSessionSecret },
    ratelimits: {
      LYRICS_SESSION_LIMITER: { simple: { limit: 60, period: 60 } },
      LYRICS_TOKEN_LIMITER: { simple: { limit: tokenLimit, period: 60 } },
      LYRICS_IP_LIMITER: { simple: { limit: ipLimit, period: 60 } }
    },
    outboundService
  });
}

describe("lyrics authentication in the Worker runtime", () => {
  it("exchanges credentials, verifies signatures and preserves the native token quota across session renewal", async () => {
    const upstream = vi.fn((_request: RuntimeRequest) => RuntimeResponse.json(spotifyProbeBody));
    const worker = runtime(upstream, 1);
    try {
      const sessionResponse = await worker.dispatchFetch("https://lyrics.test/auth/lyrics-session", {
        method: "POST", headers: { Authorization: "Bearer spotify-first", ...spotifyClientHeaders }
      });
      expect(sessionResponse.status).toBe(200);
      expect(sessionResponse.headers.get("Cache-Control")).toContain("no-store");
      const session = await sessionResponse.json() as LyricsSession;
      expect(session.expiresAt).toBeGreaterThan(Date.now() + 590_000);
      const url = "https://lyrics.test/lyrics/track";
      expect((await worker.dispatchFetch(url)).status).toBe(401);
      expect((await worker.dispatchFetch(url, {
        headers: { Authorization: "Bearer spotify-refreshed", [LyricsSessionHeader]: session.token }
      })).status).toBe(401);
      expect((await worker.dispatchFetch(url, {
        headers: { Authorization: "Bearer spotify-first", [LyricsSessionHeader]: session.token }
      })).status).toBe(200);

      const refreshed = await worker.dispatchFetch("https://lyrics.test/auth/lyrics-session", {
        method: "POST", headers: { Authorization: "Bearer spotify-first", ...spotifyClientHeaders }
      });
      expect(refreshed.status).toBe(200);
      const next = await refreshed.json() as LyricsSession;
      const limited = await worker.dispatchFetch(url, {
        headers: { Authorization: "Bearer spotify-first", [LyricsSessionHeader]: next.token }
      });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("Retry-After")).toBe("60");
      expect(upstream.mock.calls.map(([request]) => [request.url, request.headers.get("Authorization")])).toEqual([
        [spotifyProbeUrl, "Bearer spotify-first"],
        [spotifyProbeUrl, "Bearer spotify-first"]
      ]);
      expect(upstream.mock.calls[0]![0].headers.get("App-Platform")).toBe("OSX_ARM64");
      expect(upstream.mock.calls[0]![0].headers.get("Spotify-App-Version")).toBe("1.3.8.620");
    } finally { await worker.dispose(); }
  });

  it("preserves the native IP quota when a caller changes its Spotify token", async () => {
    const worker = runtime(() => RuntimeResponse.json(spotifyProbeBody), 60, 1);
    try {
      for (const [token, status] of [["first", 200], ["refreshed", 429]] as const) {
        const response = await worker.dispatchFetch("https://lyrics.test/auth/lyrics-session", {
          method: "POST", headers: { Authorization: `Bearer ${token}`, ...spotifyClientHeaders }
        });
        expect(response.status).toBe(200);
        const session = await response.json() as LyricsSession;
        const lyrics = await worker.dispatchFetch("https://lyrics.test/lyrics/track", {
          headers: { Authorization: `Bearer ${token}`, [LyricsSessionHeader]: session.token }
        });
        expect(lyrics.status).toBe(status);
      }
    } finally { await worker.dispose(); }
  });

  it("refuses Spotify redirects without forwarding the bearer to another origin", async () => {
    const upstream = vi.fn((request: RuntimeRequest) => new URL(request.url).hostname === "spclient.wg.spotify.com"
      ? new RuntimeResponse("", { status: 302, headers: { location: "https://redirect.test/profile" } })
      : RuntimeResponse.json(spotifyProbeBody));
    const worker = runtime(upstream);
    try {
      const response = await worker.dispatchFetch("https://lyrics.test/auth/lyrics-session", {
        method: "POST", headers: { Authorization: "Bearer spotify-private", ...spotifyClientHeaders }
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "auth_unavailable" });
      expect(upstream.mock.calls.map(([request]) => request.url)).toEqual([spotifyProbeUrl]);
    } finally { await worker.dispose(); }
  });
});
