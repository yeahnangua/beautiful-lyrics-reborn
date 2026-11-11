import { hashLyrics, sha256 } from "./diagnostics";
import { lyricsCacheVersion } from "./cache-version";
export { lyricsCacheVersion } from "./cache-version";
import { isSourceBlocked, lyricsTypes, validSpotifyId } from "./source-policy";
import type { BeautifulLyrics, SourceBlock, SpotifyClientContext, TrackMetadata } from "./types";

const day = 86_400_000;
const ttlByType: Record<BeautifulLyrics["Type"], number> = { Syllable: 30 * day, Line: 14 * day, Static: 3 * day };
// Keep the existing 15s + 10s provider phases intact. Transport and envelope
// processing share a small allowance; a recovery still uses this same deadline.
export const originBudgetMs = 27_000;
export const originPathPrefix = "/lyrics-body/v" + lyricsCacheVersion + "/";
const contextHeader = "X-Lyrics-Origin-Context";
const tokenHeader = "X-Lyrics-Upstream-Token";
const digestPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export type CacheIdentity = { trackId: string; metadataHash: string; policyHash: string };
export type OriginContext = {
  metadata?: TrackMetadata;
  clientContext?: SpotifyClientContext;
  sourceBlocks: SourceBlock[];
  deadline: number;
  triggerRequestId: string;
};
export type OriginInput = CacheIdentity & OriginContext & { accessToken: string };
export type OriginEnvelope = CacheIdentity & {
  schema: typeof lyricsCacheVersion;
  outcome: "success" | "none" | "failed";
  originRunId: string;
  generatedAt: number;
  expiresAt?: number;
  lyrics?: BeautifulLyrics;
  lyricsHash?: string;
};
export type OriginBinding = {
  fetch(request: Request, init?: { cache?: "no-store" }): Promise<Response>;
  purgeTrack(trackId: string): Promise<unknown>;
};
export class LyricsCacheError extends Error {
  constructor() { super("Invalid lyrics cache response"); }
}

export function cacheTtlMs(type: BeautifulLyrics["Type"]): number { return ttlByType[type]; }
export function trackCachePrefix(trackId: string): string {
  if (!validSpotifyId(trackId)) throw new LyricsCacheError();
  return originPathPrefix + trackId + "/";
}
export function cachePath(identity: CacheIdentity): string {
  return trackCachePrefix(identity.trackId) + identity.metadataHash + "/" + identity.policyHash;
}

function normalizeMetadata(trackId: string, metadata?: TrackMetadata): TrackMetadata | undefined {
  if (!metadata) return undefined;
  if (metadata.id !== trackId || typeof metadata.name !== "string" || !Array.isArray(metadata.artists)
    || !metadata.artists.every(artist => typeof artist === "string")) throw new LyricsCacheError();
  const name = metadata.name.trim(), artists = metadata.artists.map(artist => artist.trim()).filter(Boolean);
  if (!name || !artists.length) return undefined;
  const result: TrackMetadata = { id: trackId, name, artists };
  for (const key of ["album", "isrc"] as const) {
    if (typeof metadata[key] === "string" && metadata[key].trim()) result[key] = metadata[key].trim();
  }
  if (Number.isFinite(metadata.durationSeconds) && metadata.durationSeconds! > 0) {
    const duration = Math.round(metadata.durationSeconds!);
    if (duration > 0) result.durationSeconds = duration;
  }
  if (typeof metadata.appleMusicId === "string" && /^\d+$/.test(metadata.appleMusicId.trim())) {
    result.appleMusicId = metadata.appleMusicId.trim();
    if (typeof metadata.appleMusicTitle === "string" && metadata.appleMusicTitle.trim()) result.appleMusicTitle = metadata.appleMusicTitle.trim();
  }
  return result;
}
function normalizeBlocks(blocks: readonly SourceBlock[]): SourceBlock[] {
  const values = new Map<string, SourceBlock>();
  for (const block of blocks) {
    if (!block || typeof block.provider !== "string" || !/^[a-z0-9._-]{1,50}$/.test(block.provider)
      || !lyricsTypes.includes(block.lyricsType)) throw new LyricsCacheError();
    values.set(block.provider + ":" + block.lyricsType, { provider: block.provider, lyricsType: block.lyricsType });
  }
  return [...values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, block]) => block);
}

export async function cacheIdentity(trackId: string, metadata: TrackMetadata | undefined, blocks: readonly SourceBlock[]) {
  if (!validSpotifyId(trackId)) throw new LyricsCacheError();
  const track = normalizeMetadata(trackId, metadata);
  const sourceBlocks = normalizeBlocks(blocks);
  const canonical = track ? [track.name, track.artists, track.album ?? null, track.durationSeconds ?? null,
    track.isrc ?? null, track.appleMusicId ?? null, track.appleMusicTitle ?? null] : null;
  const [metadataHash, policyHash] = await Promise.all([sha256(JSON.stringify(canonical)), sha256(JSON.stringify(sourceBlocks))]);
  return { identity: { trackId, metadataHash, policyHash }, metadata: track, sourceBlocks };
}

function encodeContext(value: OriginContext): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > 48_000) throw new LyricsCacheError();
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
}
function decodeContext(value: string | null): OriginContext {
  if (!value || value.length > 64_000) throw new LyricsCacheError();
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(atob(value), char => char.charCodeAt(0))));
  } catch { throw new LyricsCacheError(); }
}

export function createOriginRequest(identity: CacheIdentity, context: OriginContext, accessToken: string): Request {
  // Start from an allowlist. Eyeball cache directives, cookies, session headers,
  // conditional/override headers and its abort signal must not reach this request.
  return new Request("https://lyrics-origin.internal" + cachePath(identity), {
    method: "GET",
    headers: { Accept: "application/json", [contextHeader]: encodeContext(context), [tokenHeader]: accessToken }
  });
}

export async function readOriginRequest(request: Request): Promise<OriginInput> {
  const url = new URL(request.url);
  const match = new RegExp("^" + originPathPrefix + "([a-zA-Z0-9]{1,100})/([a-f0-9]{64})/([a-f0-9]{64})$").exec(url.pathname);
  if (request.method !== "GET" || !match || url.search) throw new LyricsCacheError();
  const context = decodeContext(request.headers.get(contextHeader));
  const accessToken = request.headers.get(tokenHeader);
  if (!context || !Array.isArray(context.sourceBlocks) || !Number.isFinite(context.deadline)
    || !uuidPattern.test(context.triggerRequestId) || !accessToken || accessToken.length > 8192 || /\s/.test(accessToken)) {
    throw new LyricsCacheError();
  }
  if (context.clientContext && (typeof context.clientContext !== "object"
    || (context.clientContext.appPlatform !== undefined && typeof context.clientContext.appPlatform !== "string")
    || (context.clientContext.appVersion !== undefined && typeof context.clientContext.appVersion !== "string"))) throw new LyricsCacheError();
  const normalized = await cacheIdentity(match[1]!, context.metadata, context.sourceBlocks);
  if (normalized.identity.metadataHash !== match[2] || normalized.identity.policyHash !== match[3]) throw new LyricsCacheError();
  return { ...normalized.identity, sourceBlocks: normalized.sourceBlocks, deadline: context.deadline,
    triggerRequestId: context.triggerRequestId, accessToken,
    ...(normalized.metadata ? { metadata: normalized.metadata } : {}),
    ...(context.clientContext ? { clientContext: context.clientContext } : {}) };
}

export function stripRequestFields(lyrics: BeautifulLyrics): BeautifulLyrics {
  const { RequestId: _id, RetrievedAt: _time, LyricsHash: _hash, ...content } = lyrics;
  return structuredClone(content) as BeautifulLyrics;
}

export function isCacheableLyrics(value: unknown): value is BeautifulLyrics {
  if (!value || typeof value !== "object") return false;
  const lyrics = value as BeautifulLyrics;
  if (!lyricsTypes.includes(lyrics.Type)) return false;
  const rows = lyrics.Type === "Static" ? lyrics.Lines : lyrics.Content;
  if (!Array.isArray(rows) || !rows.length || !rows.every(row => row && typeof row === "object")) return false;
  const source = lyrics.Source;
  if (source?.Provider === "spicylyrics" && (lyrics.Attribution?.provider !== "spicylyrics"
    || typeof lyrics.Attribution.source !== "string" || !lyrics.Attribution.source.trim())) return false;
  if (source?.Provider === "lrc.red" && (lyrics.Attribution?.provider !== "lrc.red" || lyrics.Attribution.source !== "lrc.red")) return false;
  return !!source && typeof source.Provider === "string" && /^[a-z0-9._-]{1,50}$/.test(source.Provider)
    && (source.Transport === "direct" || source.Transport === "lyrically")
    && !("RequestId" in lyrics) && !("RetrievedAt" in lyrics) && !("LyricsHash" in lyrics);
}

export async function readOriginResponse(response: Response, identity: CacheIdentity,
  blocks: readonly SourceBlock[], now = Date.now()): Promise<OriginEnvelope> {
  let entry: OriginEnvelope;
  try { entry = await response.json() as OriginEnvelope; } catch { throw new LyricsCacheError(); }
  if (!entry || entry.schema !== lyricsCacheVersion || entry.trackId !== identity.trackId
    || entry.metadataHash !== identity.metadataHash || entry.policyHash !== identity.policyHash
    || !uuidPattern.test(entry.originRunId) || !Number.isFinite(entry.generatedAt)) throw new LyricsCacheError();
  if (entry.outcome === "none" || entry.outcome === "failed") {
    if (entry.lyrics !== undefined || entry.expiresAt !== undefined || response.headers.get("CF-Cache-Status") === "HIT"
      || response.status !== (entry.outcome === "none" ? 200 : 502)) throw new LyricsCacheError();
    return entry;
  }
  if (entry.outcome !== "success" || response.status !== 200 || !isCacheableLyrics(entry.lyrics)
    || !Number.isFinite(entry.expiresAt) || entry.expiresAt! <= now
    || entry.expiresAt! - entry.generatedAt !== cacheTtlMs(entry.lyrics.Type)
    || !digestPattern.test(entry.lyricsHash ?? "")
    || isSourceBlocked(blocks, entry.lyrics.Source!.Provider, entry.lyrics.Type)
    || await hashLyrics(entry.lyrics) !== entry.lyricsHash) throw new LyricsCacheError();
  return entry;
}

export function cacheStatus(response: Response): "hit" | "miss" | "bypass" | "unknown" {
  switch (response.headers.get("CF-Cache-Status")?.toUpperCase()) {
    case "HIT": return "hit";
    case "MISS": case "EXPIRED": return "miss";
    case "BYPASS": case "DYNAMIC": return "bypass";
    default: return "unknown";
  }
}
