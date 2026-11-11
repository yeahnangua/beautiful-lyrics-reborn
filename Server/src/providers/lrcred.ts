import OpenCC from "opencc-js";
import { convertLrcRedTtml } from "../convert/lrcred-ttml";
import { contextFetch, recordUpstreamResult, withLyricRequestRetries } from "./request";
import { recordMatch, withSource } from "./matched-title";
import type { BeautifulLyrics, LrcRedProvider, TrackMetadata } from "../types";

export const lrcRedUserAgent = "beautiful-lyrics-reborn (https://github.com/yeahnangua/beautiful-lyrics-reborn; mailto:1135746060@qq.com)";
const simplify = OpenCC.Converter({ from: "tw", to: "cn" });
const normalized = (text: string) => simplify(text).normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isrc = (value: unknown) => typeof value === "string" && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(value) ? value.toUpperCase() : undefined;
type Candidate = { isrc: string; title: string; artist: string; album?: string; duration?: number };
const canonicalTitle = (title: string) => normalized(title.replace(
  /\s*[([]\s*(?:(?:ep|single|album) version|(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?)\s*[)\]]|\s+-\s+(?:(?:ep|single|album) version|(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?)\s*$/gi, ""
));

function candidate(value: unknown): Candidate | undefined {
  if (!isRecord(value)) return undefined;
  const id = isrc(value.isrc);
  if (!id || typeof value.title !== "string" || typeof value.artist !== "string") return undefined;
  return { isrc: id, title: value.title, artist: value.artist,
    ...(typeof value.album === "string" ? { album: value.album } : {}),
    ...(typeof value.duration === "number" && Number.isFinite(value.duration) && value.duration > 0 ? { duration: value.duration } : {}) };
}

function matches(item: Candidate, track: TrackMetadata): boolean {
  const artists = [item.artist, ...item.artist.split(/[、,，;；&/＋+]|(?:\s+(?:feat|ft|with)\.?\s+)/i)]
    .map(normalized).filter(Boolean);
  return canonicalTitle(item.title) === canonicalTitle(track.name) &&
    track.artists.some(artist => artists.includes(normalized(artist))) &&
    (track.durationSeconds === undefined || item.duration !== undefined && Math.abs(item.duration - track.durationSeconds) <= 8);
}

function retryAfterDeadline(value: string | null, now: number): number {
  const text = value?.trim();
  const fallback = now + 5000;
  if (!text) return fallback;
  // Also tolerate fractional delays, as our session client does; never parse bad numbers as dates.
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const delay = Math.ceil(Number(text) * 1000);
    return Number.isSafeInteger(delay) && delay <= Number.MAX_SAFE_INTEGER - now
      ? now + Math.max(1000, delay) : fallback;
  }
  const imf = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
  const obsolete = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT$|^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/;
  if (!imf.test(text) && !obsolete.test(text)) return fallback;
  // The obsolete asctime format has no zone marker but HTTP dates are always UTC.
  const until = Date.parse(text.endsWith(" GMT") ? text : text + " GMT");
  if (!Number.isFinite(until) || imf.test(text) && new Date(until).toUTCString() !== text) return fallback;
  return Math.max(now + 1000, until);
}

export function createLrcRedProvider(fetchImpl: typeof fetch = fetch): LrcRedProvider {
  let retryAfterUntil = 0;
  return {
    async getLyrics(track, context = {}) {
      if (Date.now() < retryAfterUntil) {
        if (context.trace) context.trace.reason = "upstream_backoff";
        return undefined;
      }
      const directId = isrc(track.isrc);
      if (!directId && (!track.name.trim() || !track.artists[0]?.trim())) return undefined;
      const request = contextFetch(fetchImpl, context);
      const get = async (path: string, operation: "search" | "lyrics", signal: AbortSignal) => {
        const response = await request("https://lrc.red" + path, {
          headers: { "User-Agent": lrcRedUserAgent, Accept: operation === "search" ? "application/json" : "application/ttml+xml, application/xml, text/xml" }, signal
        });
        recordUpstreamResult(context, { operation });
        if (response.status === 429 || response.status === 503) {
          retryAfterUntil = Math.max(retryAfterUntil, retryAfterDeadline(response.headers.get("Retry-After"), Date.now()));
        }
        if (!response.ok) recordUpstreamResult(context, { result: response.status === 404 ? "no_lyrics" : "http_error" });
        return response;
      };
      const readLyrics = async (item: { isrc: string; title: string }, signal: AbortSignal) => {
        const source = { Provider: "lrc.red", Transport: "direct", TrackId: item.isrc, MatchedTitle: item.title } as const;
        recordMatch(context, source);
        const response = await get(`/s/${item.isrc}.ttml`, "lyrics", signal);
        if (!response.ok) return undefined;
        const lyrics = convertLrcRedTtml(await response.text());
        recordUpstreamResult(context, { result: lyrics ? "found" : "invalid_payload",
          ...(lyrics ? { resultCount: lyrics.Type === "Static" ? lyrics.Lines.length : lyrics.Content.length } : {}) });
        return lyrics ? withSource({ ...lyrics, Attribution: { provider: "lrc.red", source: "lrc.red" } }, source) : undefined;
      };
      let fallback: BeautifulLyrics | undefined;
      return withLyricRequestRetries(async signal => {
        // If a later candidate times out, keep the usable result from this lookup.
        if (fallback) return fallback;
        if (directId) {
          const lyrics = await readLyrics({ isrc: directId, title: track.name }, signal);
          if (lyrics) return lyrics;
          if (Date.now() < retryAfterUntil) return undefined;
        }
        if (!track.name.trim() || !track.artists[0]?.trim()) return undefined;
        const query = simplify(`${track.name} ${track.artists[0]}`);
        const response = await get("/search.json?" + new URLSearchParams({ q: query }), "search", signal);
        recordUpstreamResult(context, { query });
        if (!response.ok) return undefined;
        const payload: unknown = await response.json().catch(() => undefined);
        if (!isRecord(payload) || !Array.isArray(payload.hits)) {
          recordUpstreamResult(context, { result: "invalid_payload" });
          return undefined;
        }
        const seen = new Set(directId ? [directId] : []);
        const candidates = payload.hits.flatMap(value => {
          const item = candidate(value);
          if (!item || seen.has(item.isrc) || !matches(item, track)) return [];
          seen.add(item.isrc);
          return [item];
        });
        const score = (item: Candidate) => (track.album && item.album && normalized(track.album) === normalized(item.album) ? 100 : 0)
          - (track.durationSeconds !== undefined && item.duration !== undefined ? Math.abs(item.duration - track.durationSeconds) : 0);
        candidates.sort((a, b) => score(b) - score(a));
        recordUpstreamResult(context, { resultCount: payload.hits.length, matchedCount: candidates.length,
          result: candidates.length ? "matched" : payload.hits.length ? "no_match" : "no_results" });
        for (const item of candidates.slice(0, 3)) {
          const lyrics = await readLyrics(item, signal);
          if (lyrics?.Type === "Syllable") return lyrics;
          if (lyrics && (!fallback || lyrics.Type === "Line" && fallback.Type === "Static")) fallback = lyrics;
          if (Date.now() < retryAfterUntil) break;
        }
        return fallback;
      }, "lrc.red lyrics", context);
    }
  };
}

export const lrcRedProvider = createLrcRedProvider();
