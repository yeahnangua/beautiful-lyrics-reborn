import { Abortable, CreateAbortScope } from "../../Universal/Modules/Async";
import { PluginFetch } from "../../Universal/Modules/Http";
import { LyricsSessionHeader, LyricsSessionLifetimeMs, RetryAfterSeconds,
  type LyricsSession, type LyricsAuthErrorCode } from "../../Universal/Modules/LyricsSession";

export type LyricsAuthEnv = {
  LYRICS_SESSION_SECRET?: string;
  LYRICS_SESSION_LIMITER?: RateLimit;
  LYRICS_TOKEN_LIMITER?: RateLimit;
  LYRICS_IP_LIMITER?: RateLimit;
  METRICS?: AnalyticsEngineDataset;
};

export const lyricsCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    `Authorization, Content-Type, User-Agent, X-Spotify-App-Platform, X-Spotify-App-Version, ${LyricsSessionHeader}`,
  "Access-Control-Expose-Headers": "Retry-After"
};
export const lyricsResponseHeaders = {
  ...lyricsCorsHeaders,
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store"
};

const encoder = new TextEncoder();
const signaturePrefix = "beautiful-lyrics-reborn:lyrics-session:v1:";
// Fixed server-owned probes avoid trusting a caller's track, account ID or URL.
const spotifyProbeTracks = ["6OsRo5kez17uDLwddaKfrI", "4PTG3Z6ehGkBFwjybzWkR8"];
const messages: Record<LyricsAuthErrorCode, string> = {
  missing_spotify_token: "Spotify credentials are required.",
  invalid_spotify_token: "Spotify credentials have expired or are invalid.",
  invalid_spotify_client: "Spotify client platform and version are required.",
  spotify_forbidden: "Spotify did not authorize this account.",
  invalid_session: "A current lyrics session is required. Reload or update the extension.",
  rate_limited: "Too many requests. Retry after the specified delay.",
  auth_unavailable: "Lyrics authentication is temporarily unavailable."
};
class AuthError extends Error {
  constructor(readonly status: number, readonly code: LyricsAuthErrorCode, readonly retryAfter?: number) {
    super(messages[code]);
  }
}

function bearer(request: Request): string {
  const header = request.headers.get("Authorization");
  const match = header && header.length <= 8192 ? /^Bearer ([^\s]+)$/i.exec(header) : null;
  if (!match) throw new AuthError(401, "missing_spotify_token");
  return match[1]!;
}

let signingKey: { secret: string; key: Promise<CryptoKey> } | undefined;
function keyFor(secret: string | undefined): Promise<CryptoKey> {
  if (!secret || encoder.encode(secret).length < 32) throw new AuthError(503, "auth_unavailable");
  if (signingKey?.secret !== secret) {
    signingKey = { secret, key: crypto.subtle.importKey("raw", encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]) };
  }
  return signingKey.key;
}

function configured(env: LyricsAuthEnv): Promise<CryptoKey> {
  if (!env.LYRICS_SESSION_LIMITER || !env.LYRICS_TOKEN_LIMITER || !env.LYRICS_IP_LIMITER) throw new AuthError(503, "auth_unavailable");
  return keyFor(env.LYRICS_SESSION_SECRET);
}

const hex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
const digest = async (value: string): Promise<string> => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const encode = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error("Invalid encoding");
  return bytes;
}

type Claims = { v: 1; spotify: string; issuedAt: number; expiresAt: number };

// Only called after Spotify returns usable lyrics for this exact bearer.
export async function createLyricsSession(secret: string, accessToken: string, now = Date.now()): Promise<LyricsSession> {
  const key = await keyFor(secret);
  const claims: Claims = {
    v: 1,
    spotify: await digest(accessToken),
    issuedAt: now,
    expiresAt: now + LyricsSessionLifetimeMs
  };
  const payload = encode(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signaturePrefix + payload));
  return { token: `${payload}.${encode(new Uint8Array(signature))}`, expiresAt: claims.expiresAt };
}

async function verifySession(token: string, key: CryptoKey, accessToken: string, now: number): Promise<Claims> {
  try {
    if (token.length > 2048) throw new Error("Oversized session");
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Invalid session");
    const signature = decode(parts[1]);
    if (signature.length !== 32 || !await crypto.subtle.verify("HMAC", key, signature, encoder.encode(signaturePrefix + parts[0]))) {
      throw new Error("Invalid signature");
    }
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as Claims;
    if (!claims || claims.v !== 1 || !/^[a-f0-9]{64}$/.test(claims.spotify)
      || !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt)
      || claims.issuedAt > now + 5000 || claims.expiresAt <= now
      || claims.expiresAt - claims.issuedAt !== LyricsSessionLifetimeMs
      || claims.spotify !== await digest(accessToken)) throw new Error("Invalid claims");
    return claims;
  } catch {
    throw new AuthError(401, "invalid_session");
  }
}

function errorResponse(error: unknown): Response {
  const failure = error instanceof AuthError ? error : new AuthError(503, "auth_unavailable");
  return Response.json({ code: failure.code, message: failure.message }, {
    status: failure.status,
    headers: { ...lyricsResponseHeaders, ...(failure.retryAfter === undefined ? {} : { "Retry-After": String(failure.retryAfter) }) }
  });
}

function recordAuth(env: LyricsAuthEnv, operation: "session" | "lyrics", outcome: string, status: number, duration: number): void {
  try {
    env.METRICS?.writeDataPoint({ indexes: [`auth:${operation}`],
      blobs: ["auth", operation, "v1", outcome, String(status)], doubles: [duration] });
  } catch { /* Metrics cannot change the authorization decision. */ }
}

function spotifyClientHeaders(request: Request, accessToken: string): HeadersInit {
  const platform = request.headers.get("X-Spotify-App-Platform");
  const version = request.headers.get("X-Spotify-App-Version");
  if (!platform || !/^[a-z0-9_-]{1,64}$/i.test(platform)
    || !version || !/^[a-z0-9._+-]{1,64}$/i.test(version)) throw new AuthError(400, "invalid_spotify_client");
  // These are compatibility metadata, not proof of identity. Spotify decides
  // whether the bearer is authorized for its lyrics resource.
  return { Authorization: `Bearer ${accessToken}`, "App-Platform": platform,
    "Spotify-App-Version": version, Accept: "application/json" };
}

const ipKey = (request: Request): Promise<string> =>
  digest(`lyrics-ip:v1:${request.headers.get("CF-Connecting-IP") ?? "local"}`);

async function verifySpotifyLyrics(fetchImpl: typeof fetch, request: Request, accessToken: string,
  signal: AbortSignal, now: () => number): Promise<void> {
  const headers = spotifyClientHeaders(request, accessToken);
  // workerd supports no-store; the pinned Workers types omit RequestInit.cache.
  const init: RequestInit & { cache: "no-store" } = { headers, signal, redirect: "manual", cache: "no-store" };
  for (const track of spotifyProbeTracks) {
    // Workers supports manual/follow only. Never forward credentials to a redirect.
    const response = await fetchImpl(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${track}?format=json&vocalRemoval=false&market=from_token`, init);
    if (response.status === 401) throw new AuthError(401, "invalid_spotify_token");
    if (response.status === 403) throw new AuthError(403, "spotify_forbidden");
    if (response.status === 429) throw new AuthError(429, "rate_limited", RetryAfterSeconds(response.headers.get("Retry-After"), now()));
    if (response.status === 404) {
      await response.body?.cancel();
      continue;
    }
    if (response.status !== 200) throw new AuthError(503, "auth_unavailable");
    const body = await response.json() as { lyrics?: { lines?: { words?: unknown }[] } } | null;
    if (!Array.isArray(body?.lyrics?.lines)
      || !body.lyrics.lines.some(line => typeof line?.words === "string" && line.words.trim())) throw new AuthError(503, "auth_unavailable");
    return;
  }
  throw new AuthError(503, "auth_unavailable");
}

export function createLyricsAuth(fetchImpl: typeof fetch = PluginFetch, now = Date.now) {
  return {
    async session(request: Request, env: LyricsAuthEnv): Promise<Response> {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: lyricsResponseHeaders });
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { ...lyricsResponseHeaders, Allow: "POST, OPTIONS" } });
      const started = now();
      let result: Response;
      let outcome = "success";
      try {
        const accessToken = bearer(request);
        await configured(env);
        const ip = await ipKey(request);
        if (!(await env.LYRICS_SESSION_LIMITER!.limit({ key: ip })).success) throw new AuthError(429, "rate_limited", 60);
        const scope = CreateAbortScope(5000, request.signal);
        try {
          await Abortable(scope.Signal, () => verifySpotifyLyrics(fetchImpl, request, accessToken, scope.Signal, now));
        } finally { scope.Destroy(); }
        request.signal.throwIfAborted();
        const session = await createLyricsSession(env.LYRICS_SESSION_SECRET!, accessToken, now());
        result = Response.json(session, { headers: lyricsResponseHeaders });
      } catch (error) {
        outcome = error instanceof AuthError ? error.code : "auth_unavailable";
        result = errorResponse(error);
      }
      recordAuth(env, "session", outcome, result.status, now() - started);
      return result;
    },
    async authorize(request: Request, env: LyricsAuthEnv): Promise<{ accessToken: string } | Response> {
      const started = now();
      try {
        const accessToken = bearer(request);
        const token = request.headers.get(LyricsSessionHeader);
        if (!token) throw new AuthError(401, "invalid_session");
        const key = await configured(env);
        const claims = await verifySession(token, key, accessToken, now());
        if (!(await env.LYRICS_IP_LIMITER!.limit({ key: await ipKey(request) })).success) throw new AuthError(429, "rate_limited", 60);
        if (!(await env.LYRICS_TOKEN_LIMITER!.limit({ key: claims.spotify })).success) throw new AuthError(429, "rate_limited", 60);
        recordAuth(env, "lyrics", "success", 200, now() - started);
        return { accessToken };
      } catch (error) {
        const result = errorResponse(error);
        recordAuth(env, "lyrics", error instanceof AuthError ? error.code : "auth_unavailable", result.status, now() - started);
        return result;
      }
    }
  };
}
