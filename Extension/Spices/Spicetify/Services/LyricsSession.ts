import { Abortable, CreateAbortScope } from "../../../../Universal/Modules/Async.ts";
import { PluginFetch } from "../../../../Universal/Modules/Http.ts";
import { LyricsSessionPath, LyricsSessionHeader, LyricsSessionLifetimeMs, RetryAfterSeconds,
  type LyricsSession, type LyricsAuthErrorCode } from "../../../../Universal/Modules/LyricsSession.ts";

const apiOrigin = "https://lyrics.txw.qzz.io";
const refreshAheadMs = 30_000;
export class LyricsSessionError extends Error {
  readonly status: number;
  readonly code: LyricsAuthErrorCode;
  readonly retryAfter: number | undefined;
  constructor(status: number, code: LyricsAuthErrorCode, retryAfter?: number) {
    super(code === "rate_limited" ? "Lyrics requests are temporarily rate limited." : "Lyrics authentication failed. Please retry or reload Spotify.");
    this.name = "LyricsSessionError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

type Options = {
  getSpotifyToken: () => Promise<string>;
  getSpotifyClient: () => { appPlatform: string; appVersion: string };
  invalidateSpotifyToken: (rejectedToken: string) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sessionTimeoutMs?: number;
};
type Entry = { spotifyToken: string; session?: LyricsSession; pending?: Promise<LyricsSession> };

export function createLyricsSessionClient({ getSpotifyToken, getSpotifyClient, invalidateSpotifyToken,
  fetchImpl = PluginFetch, now = Date.now, sessionTimeoutMs = 5000 }: Options) {
  // Credentials stay in memory. One cancelled song must not cancel the session
  // exchange used by other songs, so exchanges have their own bounded lifetime.
  let current: Entry | undefined;
  let blockedUntil = 0;
  function checkCooldown(): void {
    if (blockedUntil > now()) throw new LyricsSessionError(429, "rate_limited", Math.ceil((blockedUntil - now()) / 1000));
  }
  async function responseError(response: Response): Promise<LyricsSessionError> {
    if (response.status === 429) {
      const seconds = RetryAfterSeconds(response.headers.get("Retry-After"), now());
      blockedUntil = Math.max(blockedUntil, now() + seconds * 1000);
      await response.body?.cancel().catch(() => {});
      return new LyricsSessionError(429, "rate_limited", seconds);
    }
    let code: LyricsAuthErrorCode = "auth_unavailable";
    try {
      const body = await response.json() as { code?: unknown };
      const codes: LyricsAuthErrorCode[] = ["missing_spotify_token", "invalid_spotify_token", "invalid_spotify_client", "spotify_forbidden", "invalid_session", "auth_unavailable"];
      if (codes.includes(body?.code as LyricsAuthErrorCode)) code = body.code as LyricsAuthErrorCode;
    } catch { /* Never expose an upstream body, headers, or credentials in errors. */ }
    return new LyricsSessionError(response.status, code);
  }
  async function exchange(spotifyToken: string): Promise<LyricsSession> {
    const scope = CreateAbortScope(sessionTimeoutMs);
    try {
      return await Abortable(scope.Signal, async () => {
        checkCooldown();
        const client = getSpotifyClient();
        if (!client?.appPlatform || !client.appVersion) throw new LyricsSessionError(400, "invalid_spotify_client");
        const response = await fetchImpl(apiOrigin + LyricsSessionPath, {
          method: "POST", cache: "no-store", credentials: "omit", redirect: "error",
          headers: { Authorization: `Bearer ${spotifyToken}`, "X-Spotify-App-Platform": client.appPlatform,
            "X-Spotify-App-Version": client.appVersion }, signal: scope.Signal
        });
        if (!response.ok) throw await responseError(response);
        const session = await response.json() as LyricsSession;
        if (typeof session?.token !== "string" || !session.token.length || session.token.length > 2048
          || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= now() + refreshAheadMs) {
          throw new LyricsSessionError(503, "auth_unavailable");
        }
        // Bound local reuse even if a malformed response claims a longer life.
        return { token: session.token, expiresAt: Math.min(session.expiresAt, now() + LyricsSessionLifetimeMs) };
      });
    } catch (error) {
      if (error instanceof LyricsSessionError) throw error;
      throw new LyricsSessionError(503, "auth_unavailable");
    } finally { scope.Destroy(); }
  }
  function sessionFor(spotifyToken: string): Promise<LyricsSession> {
    checkCooldown();
    if (current?.spotifyToken === spotifyToken) {
      if (current.session && current.session.expiresAt > now() + refreshAheadMs) return Promise.resolve(current.session);
      if (current.pending) return current.pending;
    }
    const entry: Entry = { spotifyToken };
    current = entry;
    entry.pending = exchange(spotifyToken).then(session => {
      entry.session = session;
      return session;
    }).finally(() => { delete entry.pending; });
    return entry.pending;
  }
  function invalidateSession(spotifyToken: string, token?: string): void {
    if (current?.spotifyToken === spotifyToken && (token === undefined || current.session?.token === token)) {
      delete current.session;
    }
  }

  return async function fetchLyrics(url: string, init: RequestInit = {}): Promise<Response> {
    const destination = new URL(url);
    if (destination.origin !== apiOrigin || !/^\/lyrics\/[^/]+$/.test(destination.pathname)) throw new Error("Invalid lyrics API destination");
    const signal = init.signal ?? new AbortController().signal;
    let refreshedSpotify = false;
    let refreshedSession = false;
    for (;;) {
      signal.throwIfAborted();
      checkCooldown();
      const spotifyToken = await Abortable(signal, getSpotifyToken);
      let session: LyricsSession;
      try {
        session = await Abortable(signal, () => sessionFor(spotifyToken));
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof LyricsSessionError && error.status === 401 && error.code === "invalid_spotify_token" && !refreshedSpotify) {
          refreshedSpotify = true;
          invalidateSpotifyToken(spotifyToken);
          invalidateSession(spotifyToken);
          continue;
        }
        throw error;
      }
      signal.throwIfAborted();
      checkCooldown();
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${spotifyToken}`);
      headers.set(LyricsSessionHeader, session.token);
      const response = await fetchImpl(url, { ...init, method: "GET", body: null,
        cache: "no-store", credentials: "omit", redirect: "error", headers, signal });
      signal.throwIfAborted();
      if (response.status !== 401 && response.status !== 429) return response;
      const error = await Abortable(signal, () => responseError(response));
      if (error.status === 401 && error.code === "invalid_session" && !refreshedSession) {
        refreshedSession = true;
        invalidateSession(spotifyToken, session.token);
        continue;
      }
      if (error.status === 401 && error.code === "invalid_spotify_token" && !refreshedSpotify) {
        refreshedSpotify = true;
        invalidateSpotifyToken(spotifyToken);
        invalidateSession(spotifyToken);
        continue;
      }
      throw error;
    }
  };
}
