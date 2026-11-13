import { convertLrcToLineLyrics } from "../convert/lrc";
import { convertQrcXmlToSyllableLyrics } from "../convert/karaoke";
import { convertLrcRedTtml } from "../convert/lrcred-ttml";
import { recordMatch, withSource } from "./matched-title";
import { contextFetch, recordUpstreamResult } from "./request";
import { browserLyricsHeaders } from "./browser-headers";
import type { BeautifulLyrics, RequestContext, TrackMetadata } from "../types";

const apiUrl = "https://api.betterlyrics.org";
const validDuration = (track: TrackMetadata): number | undefined =>
  typeof track.durationSeconds === "number" && Number.isFinite(track.durationSeconds) && track.durationSeconds > 0
    ? track.durationSeconds : undefined;

export function createBetterLyricsProvider(fetchImpl: typeof fetch = fetch) {
  async function get<T extends BeautifulLyrics>(
    track: TrackMetadata,
    endpoint: string,
    field: "ttml" | "lyrics",
    provider: "betterlyrics" | "betterlyrics-qq" | "betterlyrics-kugou",
    convert: (content: string) => T | undefined,
    context: RequestContext = {}
  ): Promise<T | undefined> {
    const artist = track.artists.find(name => name.trim())?.trim();
    if (!track.name.trim() || !artist) return undefined;
    const url = new URL(endpoint, apiUrl);
    url.searchParams.set("s", track.name.trim());
    url.searchParams.set("a", artist);
    if (track.album?.trim()) url.searchParams.set("al", track.album.trim());
    const duration = validDuration(track);
    // The API's lookup and cache keys use whole seconds; keep exact time for conversion.
    if (duration !== undefined && Math.round(duration) > 0) url.searchParams.set("d", String(Math.round(duration)));

    // Public cache reads need no key. Authentication and rate-limit failures
    // remain misses for this source; the other providers can still answer.
    const response = await contextFetch(fetchImpl, context, { preserveUserAgent: true })(url.toString(), {
      method: "GET", headers: browserLyricsHeaders
    });
    recordUpstreamResult(context, { operation: "lyrics" });
    if (!response.ok) {
      recordUpstreamResult(context, { result: response.status === 404 ? "no_lyrics" : "http_error" });
      return undefined;
    }
    const payload: unknown = await response.json().catch(() => undefined);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      recordUpstreamResult(context, { result: "invalid_payload" });
      return undefined;
    }
    const value = (payload as Record<string, unknown>)[field];
    if (value === null || value === "") {
      recordUpstreamResult(context, { result: "no_lyrics" });
      return undefined;
    }
    if (typeof value !== "string") {
      recordUpstreamResult(context, { result: "invalid_payload" });
      return undefined;
    }
    const lyrics = convert(value);
    recordUpstreamResult(context, { result: lyrics ? "found" : "invalid_payload",
      ...(lyrics ? { resultCount: lyrics.Type === "Static" ? lyrics.Lines.length : lyrics.Content.length } : {}) });
    if (!lyrics) return undefined;
    const source = { Provider: provider, Transport: "direct" } as const;
    recordMatch(context, source);
    return withSource({ ...lyrics, Attribution: { provider: "betterlyrics", source: "betterlyrics" } }, source);
  }

  return {
    getLyrics: (track: TrackMetadata, context?: RequestContext) =>
      get(track, "/getLyrics", "ttml", "betterlyrics", convertLrcRedTtml, context),
    getQqLyrics: (track: TrackMetadata, context?: RequestContext) =>
      get(track, "/qq/getLyrics", "lyrics", "betterlyrics-qq", content =>
        convertQrcXmlToSyllableLyrics(content) ?? convertLrcToLineLyrics(content, validDuration(track)), context),
    getKugouLyrics: (track: TrackMetadata, context?: RequestContext) =>
      get(track, "/kugou/getLyrics", "lyrics", "betterlyrics-kugou", content =>
        convertLrcToLineLyrics(content, validDuration(track)), context)
  };
}

export const betterLyricsProvider = createBetterLyricsProvider();
