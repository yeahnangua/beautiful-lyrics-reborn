import { vi } from "vitest";
import { createLyricsSession, type LyricsAuthEnv } from "../src/lyrics-auth";
import { LyricsSessionHeader } from "../../Universal/Modules/LyricsSession";

export const testSessionSecret = "local-test-secret-for-lyrics-sessions-only-32-bytes";
export const spotifyClientHeaders = { "X-Spotify-App-Platform": "OSX_ARM64", "X-Spotify-App-Version": "1.3.8.620" };
export const spotifyProbeUrl = "https://spclient.wg.spotify.com/color-lyrics/v2/track/6OsRo5kez17uDLwddaKfrI?format=json&vocalRemoval=false&market=from_token";
export const spotifyProbeBody = { lyrics: { syncType: "LINE_SYNCED", lines: [{ words: "verification lyrics" }] } };
export async function lyricsAuthFixture(accessToken = "token") {
  const session = await createLyricsSession(testSessionSecret, accessToken);
  const env = {
    LYRICS_SESSION_SECRET: testSessionSecret,
    LYRICS_SESSION_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    LYRICS_TOKEN_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    LYRICS_IP_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) }
  } satisfies LyricsAuthEnv;
  return { env, session, headers: { Authorization: `Bearer ${accessToken}`, [LyricsSessionHeader]: session.token } };
}
