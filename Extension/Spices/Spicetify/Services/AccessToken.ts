export type TokenResponse = { accessToken: string; expiresAtTime: number; tokenType: "Bearer" };

export function createAccessTokenProvider(
  request: () => Promise<TokenResponse>,
  fallback: () => TokenResponse | undefined | Promise<TokenResponse | undefined>,
  timing = { timeoutMs: 5_000, retryDelayMs: 250 }
) {
  let cached: TokenResponse | undefined;
  let pending: Promise<string> | undefined;
  const valid = (token: TokenResponse | undefined): token is TokenResponse =>
    token !== undefined && typeof token.accessToken === "string" && token.accessToken.length > 0 &&
    Number.isFinite(token.expiresAtTime) && token.expiresAtTime > Date.now() + 2_000;

  return function getToken(): Promise<string> {
    if (valid(cached)) return Promise.resolve(cached.accessToken);
    if (pending) return pending;
    cached = undefined;
    pending = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const token = await Promise.race([
            Promise.resolve().then(request).catch(async error => {
              if (error instanceof Error && error.message.includes("Resolver not found")) {
                const token = await fallback();
                if (token) return token;
              }
              throw error;
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("Spotify token request timed out")), timing.timeoutMs);
            })
          ]);
          if (!valid(token)) throw new Error("Spotify returned an empty or expired token");
          cached = token;
          return token.accessToken;
        } catch (error) {
          const status = Number((error as { status?: number; code?: number } | null)?.status ?? (error as { code?: number } | null)?.code);
          const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
          if (attempt === 1 || permanent) throw error;
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
        await new Promise(resolve => setTimeout(resolve, timing.retryDelayMs));
      }
      throw new Error("Spotify token unavailable");
    })().finally(() => { pending = undefined; });
    return pending;
  };
}

/** Recent desktop clients moved credentials from Session into AuthorizationAPI. */
export async function getPlatformToken(platform: {
  Session?: { accessToken?: string; accessTokenExpirationTimestampMs?: number };
  AuthorizationAPI?: { getState(): unknown | Promise<unknown> };
}): Promise<TokenResponse | undefined> {
  const state = await platform.AuthorizationAPI?.getState() as {
    token?: { accessToken?: string; accessTokenExpirationTimestampMs?: number }
  } | undefined;
  const token = state?.token ?? platform.Session;
  if (!token?.accessToken || typeof token.accessTokenExpirationTimestampMs !== "number") return undefined;
  return { accessToken: token.accessToken, expiresAtTime: token.accessTokenExpirationTimestampMs, tokenType: "Bearer" };
}
