import OpenCC from "opencc-js";
import { convertLrcRedTtml } from "../convert/lrcred-ttml";
import { convertLrcToLineLyrics, parseLrcTimestamp } from "../convert/lrc";
import { convertEnhancedLrcToSyllableLyrics } from "../convert/enhanced-lrc";
import { recordMatch, withSource } from "./matched-title";
import { contextFetch, recordUpstreamResult } from "./request";
import { browserLyricsHeaders } from "./browser-headers";
import type { BeautifulLyrics, RequestContext, TrackMetadata } from "../types";

export type UnisonProvider = {
  getLyrics(track: TrackMetadata, context?: RequestContext): Promise<BeautifulLyrics | undefined>;
};

const baseUrl = "https://unison.betterlyrics.org";
const simplify = OpenCC.Converter({ from: "tw", to: "cn" });
const normalized = (value: string) => simplify(value).normalize("NFKD").toLowerCase().replace(/[\p{M}\p{P}\p{Z}\s]/gu, "");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const validDuration = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const normalizedIsrc = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const result = value.replace(/-/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(result) ? result : undefined;
};

function matchesMetadata(data: Record<string, unknown>, track: TrackMetadata): boolean {
  if (typeof data.song !== "string" || typeof data.artist !== "string") return false;
  if (track.name.trim() && normalized(data.song) !== normalized(track.name)) return false;
  const artists = [data.artist, ...data.artist.split(/[、,，;；&/＋+]|(?:\s+(?:feat|ft|with)\.?\s+)/i)].map(normalized).filter(Boolean);
  if (track.artists.some(artist => artist.trim()) && !track.artists.some(artist => artists.includes(normalized(artist)))) return false;
  if (validDuration(track.durationSeconds) && data.duration !== undefined &&
      (!validDuration(data.duration) || Math.abs(data.duration - track.durationSeconds) > 2)) return false;
  if (data.matchedBy === "isrc") {
    const expected = normalizedIsrc(track.isrc), actual = normalizedIsrc(data.isrc);
    if (!actual || expected && expected !== actual) return false;
  }
  if (data.matchedBy === "song_artist" && track.album?.trim() && typeof data.album === "string" &&
      normalized(track.album) !== normalized(data.album)) return false;
  return true;
}

function attribution(data: Record<string, unknown>) {
  const submitter = data.submitter;
  if (typeof data.videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(data.videoId) || !isRecord(submitter) ||
      typeof submitter.keyId !== "string" || !/^[a-fA-F0-9]{64}$/.test(submitter.keyId) ||
      typeof submitter.displayName !== "string" || !submitter.displayName.trim() || submitter.displayName.length > 256) return undefined;
  return {
    provider: "unison" as const, source: "unison" as const, songId: data.videoId,
    submitter: { id: submitter.keyId, username: submitter.displayName.trim(), url: `${baseUrl}/curator/${submitter.keyId}` }
  };
}

// The existing enhanced-LRC parser supplies timings. Recover the spaces that it
// trims so two timed fragments of one word do not acquire an invented space.
function enhancedLyrics(text: string, durationSeconds?: number): BeautifulLyrics | undefined {
  const clean = text.split(/\r?\n/).map(line => line.trim()).join("\n");
  const result = convertEnhancedLrcToSyllableLyrics(clean, durationSeconds);
  if (!result) return undefined;
  const rawParts = new Map<number, string[]>();
  const rows = clean.split("\n").map(line => ({ line, start: parseLrcTimestamp(/^\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/.exec(line)?.[1] ?? "") }))
    .filter(row => row.start !== undefined).sort((a, b) => a.start! - b.start!);
  for (const { line } of rows) {
    const matches = [...line.matchAll(/<(\d{1,2}:\d{2}(?:\.\d{1,3})?)>/g)];
    for (const [index, match] of matches.entries()) {
      const time = parseLrcTimestamp(match[1]!);
      const raw = line.slice(match.index! + match[0].length, matches[index + 1]?.index ?? line.length);
      const next = matches[index + 1];
      if (time === undefined || !raw.trim() || next && (parseLrcTimestamp(next[1]!) ?? time) <= time) continue;
      const parts = rawParts.get(time) ?? [];
      parts.push(raw); rawParts.set(time, parts);
    }
  }
  for (const group of result.Content) {
    if (group.Type !== "Vocal") continue;
    const words = group.Lead.Syllables;
    const parts = words.map(word => rawParts.get(word.StartTime)?.shift() ?? word.Text);
    words.forEach((word, index) => {
      word.IsPartOfWord = index < words.length - 1 && !/\s$/u.test(parts[index]!) && !/^\s/u.test(parts[index + 1]!);
    });
  }
  return result;
}

function convert(data: Record<string, unknown>, durationSeconds?: number): BeautifulLyrics | undefined {
  if (typeof data.lyrics !== "string" || !data.lyrics.trim() || data.lyrics.length > 1_000_000) return undefined;
  if (data.format === "ttml") return convertLrcRedTtml(data.lyrics);
  if (data.format === "lrc") {
    const rich = enhancedLyrics(data.lyrics, durationSeconds);
    return rich ?? convertLrcToLineLyrics(data.lyrics.replace(/<\d{1,2}:\d{2}(?:\.\d{1,3})?>/g, ""), durationSeconds);
  }
  if (data.format === "plain") {
    const Lines = data.lyrics.split(/\r?\n/).map(Text => ({ Text: Text.trim() })).filter(line => line.Text);
    return Lines.length ? { Type: "Static", Lines } : undefined;
  }
  return undefined;
}

function retryAfter(response: Response): number {
  const raw = response.headers.get("Retry-After");
  const seconds = raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : undefined;
  const until = seconds === undefined ? raw ? Date.parse(raw) : NaN : Date.now() + seconds * 1000;
  return Number.isFinite(until) ? Math.max(Date.now() + 1000, until) : Date.now() + 30_000;
}

type Cached = { etag: string; lyrics: BeautifulLyrics; expiresAt: number; bytes: number; linked: boolean };

export function createUnisonProvider(fetchImpl: typeof fetch = fetch): UnisonProvider {
  // Keep validators beyond the shared cache's ten-minute lifetime. A snapshot is
  // reused only after a conditional GET, and expires after an hour regardless.
  const cache = new Map<string, Cached>();
  const queryBackoff = new Map<string, number>();
  let cacheBytes = 0, retryAfterUntil = 0;
  const recordBackoff = (response: Response, key: string) => {
    if (response.status === 429) retryAfterUntil = Math.max(retryAfterUntil, retryAfter(response));
    else if (response.status === 503) {
      // LOOKUP_PENDING is about this track, unlike the per-IP read rate limit.
      const until = Math.max(queryBackoff.get(key) ?? 0, retryAfter(response));
      queryBackoff.delete(key);
      while (queryBackoff.size >= 64) queryBackoff.delete(queryBackoff.keys().next().value!);
      queryBackoff.set(key, until);
    }
  };
  const remove = (key: string) => {
    const entry = cache.get(key);
    if (entry) cacheBytes -= entry.bytes;
    cache.delete(key);
  };
  const remember = (key: string, etag: string | null, lyrics: BeautifulLyrics, linked: boolean) => {
    remove(key);
    if (!etag || etag.length > 256 || /[\r\n]/.test(etag)) return;
    const bytes = new TextEncoder().encode(JSON.stringify(lyrics)).length;
    if (bytes > 2_000_000) return;
    while (cache.size >= 32 || cacheBytes + bytes > 2_000_000) remove(cache.keys().next().value!);
    cache.set(key, { etag, lyrics: structuredClone(lyrics), expiresAt: Date.now() + 3_600_000, bytes, linked });
    cacheBytes += bytes;
  };

  return {
    async getLyrics(track, context = {}) {
      context.signal?.throwIfAborted();
      if (Date.now() < retryAfterUntil) {
        if (context.trace) context.trace.reason = "upstream_backoff";
        return undefined;
      }
      const url = new URL(baseUrl + "/lyrics");
      const isrc = normalizedIsrc(track.isrc);
      if (isrc) url.searchParams.set("isrc", isrc);
      if (/^[A-Za-z0-9]{22}$/.test(track.id)) url.searchParams.set("spotify", track.id);
      if (track.appleMusicId && /^\d+$/.test(track.appleMusicId)) url.searchParams.set("apple_music", track.appleMusicId);
      if (track.name.trim() && track.artists[0]?.trim()) {
        url.searchParams.set("song", track.name.trim()); url.searchParams.set("artist", track.artists[0].trim());
        if (track.album?.trim()) url.searchParams.set("album", track.album.trim());
        if (validDuration(track.durationSeconds)) url.searchParams.set("duration", String(track.durationSeconds));
      }
      if (!url.search) return undefined;
      for (const [key, entry] of cache) if (entry.expiresAt <= Date.now()) remove(key);
      for (const [key, until] of queryBackoff) if (until <= Date.now()) queryBackoff.delete(key);
      const key = url.href;
      if (Date.now() < (queryBackoff.get(key) ?? 0)) {
        if (context.trace) context.trace.reason = "upstream_backoff";
        return undefined;
      }
      const cached = cache.get(key);
      const request = contextFetch(fetchImpl, context, { preserveUserAgent: true });
      const response = await request(url, { headers: { ...browserLyricsHeaders, ...(cached ? { "If-None-Match": cached.etag } : {}) } });
      recordUpstreamResult(context, { operation: "lyrics" });
      recordBackoff(response, key);
      const verifyLinkedVideo = async (videoId: string, lyricId: string) => {
        if (!track.name.trim() || !track.artists.some(artist => artist.trim()) || !validDuration(track.durationSeconds)) return false;
        // /lyrics does not return duration. The search response does; check the
        // exact selected submission rather than assuming its linked video fits.
        const searchUrl = new URL(baseUrl + "/lyrics/search"); searchUrl.searchParams.set("q", videoId);
        const search = await request(searchUrl, { headers: browserLyricsHeaders });
        recordUpstreamResult(context, { operation: "search" });
        recordBackoff(search, key);
        if (!search.ok) { recordUpstreamResult(context, { result: "http_error" }); return false; }
        const payload: unknown = await search.json().catch(() => undefined);
        if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.data)) {
          recordUpstreamResult(context, { result: "invalid_payload" }); return false;
        }
        const hit = payload.data.find(item => isRecord(item) && String(item.id) === lyricId && item.videoId === videoId);
        const accepted = isRecord(hit) && matchesMetadata(hit, track) && validDuration(hit.duration) &&
          Math.abs(hit.duration - track.durationSeconds!) <= 2;
        recordUpstreamResult(context, { result: accepted ? "matched" : "no_match", matchedCount: accepted ? 1 : 0 });
        return accepted;
      };
      if (response.status === 304) {
        if (!cached) { recordUpstreamResult(context, { result: "invalid_payload" }); return undefined; }
        const event = context.trace?.upstream.at(-1);
        if (event?.status === 304) event.outcome = "success";
        recordUpstreamResult(context, { result: "found" });
        if (cached.linked && !await verifyLinkedVideo(cached.lyrics.Attribution?.provider === "unison" ? cached.lyrics.Attribution.songId : "", cached.lyrics.Source?.LyricsId ?? "")) {
          remove(key); return undefined;
        }
        const lyrics = structuredClone(cached.lyrics);
        recordUpstreamResult(context, { result: "found" });
        if (lyrics.Source) recordMatch(context, lyrics.Source);
        return lyrics;
      }
      if (!response.ok) {
        if (response.status === 404) remove(key);
        recordUpstreamResult(context, { result: response.status === 404 ? "no_lyrics" : "http_error" });
        return undefined;
      }
      const payload: unknown = await response.json().catch(() => undefined);
      if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
        remove(key); recordUpstreamResult(context, { result: "invalid_payload" }); return undefined;
      }
      const data = payload.data;
      if (data.hidden === true || data.variant !== undefined && data.variant !== "primary" ||
          !["isrc", "song_artist", "linked_video"].includes(String(data.matchedBy)) || !matchesMetadata(data, track)) {
        remove(key); recordUpstreamResult(context, { result: "no_match" }); return undefined;
      }
      const credit = attribution(data);
      if (!credit) { remove(key); recordUpstreamResult(context, { result: "missing_attribution" }); return undefined; }
      if (!Number.isSafeInteger(data.id) || Number(data.id) <= 0) {
        remove(key); recordUpstreamResult(context, { result: "invalid_payload" }); return undefined;
      }
      const source = { Provider: "unison", Transport: "direct", TrackId: credit.songId,
        LyricsId: String(data.id), MatchedTitle: data.song as string } as const;
      recordUpstreamResult(context, { result: "matched" });
      if (data.matchedBy === "linked_video" && !await verifyLinkedVideo(credit.songId, source.LyricsId)) {
        remove(key); return undefined;
      }
      const body = convert(data, track.durationSeconds);
      if (!body) { remove(key); recordUpstreamResult(context, { result: "invalid_payload" }); return undefined; }
      const lyrics = withSource({ ...body, Attribution: credit }, source);
      recordUpstreamResult(context, { result: "found", resultCount: lyrics.Type === "Static" ? lyrics.Lines.length : lyrics.Content.length });
      recordMatch(context, source);
      remember(key, response.headers.get("ETag"), lyrics, data.matchedBy === "linked_video");
      return lyrics;
    }
  };
}

export const unisonProvider = createUnisonProvider();
