export const LyricsSessionPath = "/auth/lyrics-session";
export const LyricsSessionHeader = "X-Lyrics-Session";
export const LyricsSessionLifetimeMs = 10 * 60 * 1000;

export type LyricsSession = { token: string; expiresAt: number };
export type LyricsAuthErrorCode =
  | "missing_spotify_token"
  | "invalid_spotify_token"
  | "invalid_spotify_client"
  | "spotify_forbidden"
  | "invalid_session"
  | "rate_limited"
  | "auth_unavailable";
export type LyricsAuthErrorBody = { code: LyricsAuthErrorCode; message: string };

export function RetryAfterSeconds(value: string | null, now = Date.now()): number {
  if (value !== null && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds <= Number.MAX_SAFE_INTEGER / 1000) return Math.max(1, Math.ceil(seconds));
  }
  const date = value === null ? NaN : Date.parse(value);
  return Number.isFinite(date) ? Math.max(1, Math.ceil((date - now) / 1000)) : 60;
}
