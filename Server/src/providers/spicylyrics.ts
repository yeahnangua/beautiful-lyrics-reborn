import { contextFetch } from "./request";
import { withSource } from "./matched-title";
import type {
  BeautifulLyrics,
  Contributor,
  LineSyncedLyrics,
  LineVocal,
  SpicyAttribution,
  SpicyLyricsProvider,
  StaticSyncedLyrics,
  SyllableMetadata,
  SyllableSyncedLyrics,
  SyllableVocal,
  SyllableVocalSet,
  TrackMetadata
} from "../types";

// The Spicy Lyrics key is a Worker secret; it never travels with the client request.
let apiKey: string | undefined;
export function setSpicyLyricsApiKey(key: string | undefined): void {
  apiKey = key;
}

const lyricsUrl = "https://api.spicylyrics.org/v1/lyrics/";

type SpicyEnvelope = { Body?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function defined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function sanitizeSyllableMetadata(raw: unknown): SyllableMetadata | undefined {
  if (!isRecord(raw)) return undefined;
  const text = typeof raw.Text === "string" ? raw.Text : "";
  if (text.length === 0) return undefined;
  const start = finiteSeconds(raw.StartTime);
  const end = finiteSeconds(raw.EndTime);
  if (start === undefined || end === undefined || end < start) return undefined;
  return { Text: text, StartTime: start, EndTime: end, IsPartOfWord: raw.IsPartOfWord === true };
}

function sanitizeVocalGroup(raw: unknown): SyllableVocal | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.Syllables)) return undefined;
  const syllables = raw.Syllables.map(sanitizeSyllableMetadata).filter(defined);
  if (syllables.length === 0) return undefined;
  const first = syllables[0]!;
  const last = syllables[syllables.length - 1]!;
  return {
    StartTime: finiteSeconds(raw.StartTime) ?? first.StartTime,
    EndTime: finiteSeconds(raw.EndTime) ?? last.EndTime,
    Syllables: syllables
  };
}

function sanitizeSyllableLyrics(body: Record<string, unknown>): SyllableSyncedLyrics | undefined {
  if (!Array.isArray(body.Content)) return undefined;
  const content: SyllableVocalSet[] = [];
  for (const rawLine of body.Content) {
    if (!isRecord(rawLine) || rawLine.Type !== "Vocal" || !isRecord(rawLine.Lead)) continue;
    const lead = sanitizeVocalGroup(rawLine.Lead);
    if (lead === undefined) continue;
    const set: SyllableVocalSet = { Type: "Vocal", OppositeAligned: rawLine.OppositeAligned === true, Lead: lead };
    if (Array.isArray(rawLine.Background)) {
      const background = rawLine.Background.map(sanitizeVocalGroup).filter(defined);
      if (background.length > 0) set.Background = background;
    }
    content.push(set);
  }
  const first = content[0];
  const last = content[content.length - 1];
  if (first === undefined || last === undefined) return undefined;
  return { Type: "Syllable", StartTime: first.Lead.StartTime, EndTime: last.Lead.EndTime, Content: content };
}

function sanitizeLineLyrics(body: Record<string, unknown>): LineSyncedLyrics | undefined {
  if (!Array.isArray(body.Content)) return undefined;
  const content: LineVocal[] = [];
  for (const rawLine of body.Content) {
    if (!isRecord(rawLine) || rawLine.Type !== "Vocal") continue;
    const text = typeof rawLine.Text === "string" ? rawLine.Text : "";
    if (text.trim().length === 0) continue;
    const start = finiteSeconds(rawLine.StartTime);
    const end = finiteSeconds(rawLine.EndTime);
    if (start === undefined || end === undefined || end < start) continue;
    content.push({ Type: "Vocal", Text: text, StartTime: start, EndTime: end, OppositeAligned: rawLine.OppositeAligned === true });
  }
  const first = content[0];
  const last = content[content.length - 1];
  if (first === undefined || last === undefined) return undefined;
  return { Type: "Line", StartTime: first.StartTime, EndTime: last.EndTime, Content: content };
}

function sanitizeStaticLyrics(body: Record<string, unknown>): StaticSyncedLyrics | undefined {
  if (!Array.isArray(body.Lines)) return undefined;
  const lines: { Text: string }[] = [];
  for (const rawLine of body.Lines) {
    if (isRecord(rawLine) && typeof rawLine.Text === "string" && rawLine.Text.length > 0) {
      lines.push({ Text: rawLine.Text });
    }
  }
  if (lines.length === 0) return undefined;
  return { Type: "Static", Lines: lines };
}

function contributorFrom(raw: unknown): Contributor | undefined {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.username !== "string" || typeof raw.url !== "string") return undefined;
  return { id: raw.id, username: raw.username, url: raw.url };
}

function buildAttribution(envelope: SpicyEnvelope): SpicyAttribution | undefined {
  if (!isRecord(envelope.Body)) return undefined;
  const source = typeof envelope.Body.source === "string" ? envelope.Body.source : "unknown";
  if (source === "spicy_lyrics" && isRecord(envelope.Body.UploadAttribution)) {
    const rawAttr = envelope.Body.UploadAttribution as Record<string, unknown>;
    const uploader = contributorFrom(rawAttr.Uploader);
    if (uploader === undefined) return undefined;
    const maker = contributorFrom(rawAttr.Maker);
    return maker === undefined
      ? { provider: "spicylyrics", source, uploader }
      : { provider: "spicylyrics", source, uploader, maker };
  }
  // apple_music or spotify: we still surface the provider attribution but without community links.
  return { provider: "spicylyrics", source };
}

// Spicy's Body is already shaped like BeautifulLyrics, but it also carries upstream-only
// fields (id, source, UploadAttribution, transliterations). Rebuild the object so the public
// response only contains what the client expects, and so upstream schema drift cannot leak.
function sanitizeSpicyBody(raw: unknown, attribution: SpicyAttribution | undefined): BeautifulLyrics | undefined {
  if (!isRecord(raw)) return undefined;
  const base: Record<string, unknown> = {};
  switch (raw.Type) {
    case "Syllable": {
      const lyrics = sanitizeSyllableLyrics(raw);
      if (lyrics === undefined) return undefined;
      if (attribution !== undefined) lyrics.Attribution = attribution;
      return lyrics;
    }
    case "Line": {
      const lyrics = sanitizeLineLyrics(raw);
      if (lyrics === undefined) return undefined;
      if (attribution !== undefined) lyrics.Attribution = attribution;
      return lyrics;
    }
    case "Static": {
      const lyrics = sanitizeStaticLyrics(raw);
      if (lyrics === undefined) return undefined;
      if (attribution !== undefined) lyrics.Attribution = attribution;
      return lyrics;
    }
    default: return undefined;
  }
}

function createSpicyLyricsProviderImplementation(fetchImpl: typeof fetch): SpicyLyricsProvider {
  return {
    async getLyrics(track: TrackMetadata): Promise<BeautifulLyrics | undefined> {
      if (track.id.length === 0) return undefined;
      const key = apiKey;
      if (key === undefined || key.length === 0) return undefined;
      const response = await fetchImpl(lyricsUrl + encodeURIComponent(track.id), {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${key}`,
          "User-Agent": "beautiful-lyrics-server/1.0"
        }
      });
      if (!response.ok) return undefined;
      let envelope: SpicyEnvelope;
      try {
        envelope = (await response.json()) as SpicyEnvelope;
      } catch {
        return undefined;
      }
      const attribution = buildAttribution(envelope);
      const lyrics = sanitizeSpicyBody(envelope.Body, attribution);
      if (lyrics === undefined) return undefined;
      return withSource(lyrics, { Provider: "spicylyrics", Transport: "direct", TrackId: track.id });
    }
  };
}

export const spicyLyricsProvider = createSpicyLyricsProvider();

export function createSpicyLyricsProvider(fetchImpl: typeof fetch = fetch): SpicyLyricsProvider {
  return {
    getLyrics: (track, context) => createSpicyLyricsProviderImplementation(contextFetch(fetchImpl, context)).getLyrics(track, context)
  };
}
