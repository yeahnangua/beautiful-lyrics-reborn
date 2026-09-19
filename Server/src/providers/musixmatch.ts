// Adapted from Spicetify lyrics-plus/ProviderMusixmatch.js and Settings.js (LGPL-2.1).
// Changed 2026-09-19: native fetch, shared anonymous tokens, bounded requests,
// authentication refresh, and Beautiful Lyrics richsync conversion.
// See NOTICE.md and LICENSES/Spicetify-LGPL-2.1.txt.
import { convertRichsyncToSyllableLyrics } from "../convert/richsync";
import { withLyricRequestRetries } from "./request";
import type { SyllableLyricsProvider, TrackMetadata } from "../types";

type Message<T> = { header?: { status_code?: number }; body?: T };
type MacroCalls = {
  "matcher.track.get"?: { message?: Message<{ track?: { has_richsync?: number; instrumental?: number; restricted?: number } }> };
  "track.lyrics.get"?: { message?: Message<{ lyrics?: { restricted?: number } }> };
  "track.richsync.get"?: { message?: Message<{ richsync?: { richsync_body?: string; restricted?: number } }> };
};

const baseUrl = "https://apic-appmobile.musixmatch.com/ws/1.1/";
const headers = {
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Cookie": "x-mxm-token-guid=",
  "x-mxm-app-version": "10.1.1",
  "X-User-Agent": "Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0"
};

export function createMusixmatchProvider(fetchImpl: typeof fetch = fetch): SyllableLyricsProvider {
  let cachedToken: { value: string; expires: number } | undefined;
  let tokenRequest: Promise<string | undefined> | undefined;
  let tokenRetryAt = 0;

  async function request<T>(endpoint: string, parameters: Record<string, string>): Promise<Message<T> | undefined> {
    const url = new URL(endpoint, baseUrl);
    url.search = new URLSearchParams({ app_id: "mac-ios-v2.0", ...parameters }).toString();
    return withLyricRequestRetries(async (signal) => {
      const response = await fetchImpl(url.toString(), { headers, signal });
      if (!response.ok) {
        return { header: { status_code: response.status } };
      }
      const payload = await response.json() as { message?: Message<T> };
      return payload.message;
    }, `musixmatch ${endpoint}`);
  }

  async function getToken(): Promise<string | undefined> {
    if (cachedToken !== undefined && cachedToken.expires > Date.now()) {
      return cachedToken.value;
    }
    if (Date.now() < tokenRetryAt) {
      return undefined;
    }
    if (tokenRequest === undefined) {
      tokenRequest = (async () => {
        const response = await request<{ user_token?: string }>("token.get", {});
        const token = response?.body?.user_token;
        if (response?.header?.status_code !== 200 || typeof token !== "string" || !token.trim()) {
          tokenRetryAt = Date.now() + 60_000;
          return undefined;
        }
        cachedToken = { value: token, expires: Date.now() + 24 * 60 * 60_000 };
        return token;
      })().finally(() => { tokenRequest = undefined; });
    }
    return tokenRequest;
  }

  function parameters(track: TrackMetadata, token: string): Record<string, string> {
    const result: Record<string, string> = {
      format: "json",
      namespace: "lyrics_richsynched",
      subtitle_format: "mxm",
      q_artist: track.artists[0] ?? "",
      q_artists: track.artists.join(", "),
      q_track: track.name,
      track_spotify_id: `spotify:track:${track.id}`,
      usertoken: token,
      optional_calls: "track.richsync",
      richsync_compact_type: "words"
    };
    if (track.album) {
      result.q_album = track.album;
    }
    if (track.durationSeconds !== undefined) {
      result.q_duration = String(track.durationSeconds);
      result.f_subtitle_length = String(Math.floor(track.durationSeconds));
    }
    return result;
  }

  return {
    async getSyllableLyrics(track) {
      if (!track.name.trim() || !track.artists[0]?.trim()) {
        return undefined;
      }
      let token = await getToken();
      if (token === undefined) {
        return undefined;
      }
      let response = await request<{ macro_calls?: MacroCalls }>("macro.subtitles.get", parameters(track, token));
      if (response?.header?.status_code === 401) {
        if (cachedToken?.value === token) {
          cachedToken = undefined;
        }
        token = await getToken();
        if (token === undefined) {
          return undefined;
        }
        response = await request<{ macro_calls?: MacroCalls }>("macro.subtitles.get", parameters(track, token));
      }
      if (response?.header?.status_code !== 200) {
        if (response?.header?.status_code === 401 && cachedToken?.value === token) {
          cachedToken = undefined;
          tokenRetryAt = Date.now() + 60_000;
        }
        return undefined;
      }
      const calls = response.body?.macro_calls;
      const match = calls?.["matcher.track.get"]?.message;
      const metadata = match?.body?.track;
      const richsync = calls?.["track.richsync.get"]?.message;
      if (match?.header?.status_code !== 200 || !metadata?.has_richsync || metadata.instrumental ||
        metadata.restricted || calls?.["track.lyrics.get"]?.message?.body?.lyrics?.restricted ||
        richsync?.header?.status_code !== 200 || richsync.body?.richsync?.restricted) {
        return undefined;
      }
      return convertRichsyncToSyllableLyrics(richsync.body?.richsync?.richsync_body);
    }
  };
}

export const musixmatchProvider = createMusixmatchProvider();
