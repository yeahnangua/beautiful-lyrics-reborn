import { contextFetch, recordUpstreamResult, withLyricRequestRetries } from "./request";
import { recordMatch, withSource } from "./matched-title";
import type { AppleMusicProvider, LineSyncedLyrics, LineVocal, SyllableMetadata, SyllableSyncedLyrics, SyllableVocalSet } from "../types";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

// Preserve the timing and word-joining rules of the former Apple Music adapter.
function timedWordsToSyllableLyrics(lines: unknown[]): SyllableSyncedLyrics | undefined {
  const content: SyllableVocalSet[] = [];
  for (const line of lines) {
    if (!isRecord(line) || !Array.isArray(line.text)) continue;
    const hasPartMetadata = line.text.some(word => isRecord(word) && typeof word.part === "boolean");
    const syllables: SyllableMetadata[] = [];
    for (const word of line.text) {
      if (!isRecord(word) || typeof word.text !== "string" || !word.text.length ||
          !isTimestamp(word.timestamp) || !isTimestamp(word.endtime) || word.endtime <= word.timestamp) continue;
      syllables.push({
        Text: word.text,
        StartTime: word.timestamp / 1000,
        EndTime: word.endtime / 1000,
        IsPartOfWord: typeof word.part === "boolean" ? word.part : false
      });
    }
    if (!hasPartMetadata) {
      for (const syllable of syllables.slice(0, -1)) syllable.IsPartOfWord = true;
    }
    const first = syllables[0], last = syllables.at(-1);
    if (!first || !last) continue;
    content.push({
      Type: "Vocal", OppositeAligned: line.oppositeTurn === true,
      Lead: { StartTime: first.StartTime, EndTime: last.EndTime, Syllables: syllables }
    });
  }
  const first = content[0], last = content.at(-1);
  return first && last ? { Type: "Syllable", StartTime: first.Lead.StartTime, EndTime: last.Lead.EndTime, Content: content } : undefined;
}

function timedLinesToLineLyrics(lines: unknown[], durationSeconds?: number): LineSyncedLyrics | undefined {
  const content: LineVocal[] = [];
  for (const [index, line] of lines.entries()) {
    if (!isRecord(line) || !isTimestamp(line.timestamp)) continue;
    const text = (typeof line.text === "string" ? line.text : Array.isArray(line.text)
      ? line.text.map(word => isRecord(word) && typeof word.text === "string" ? word.text : "").join("") : "").trim();
    const next = lines[index + 1];
    const endtime = isTimestamp(line.endtime) ? line.endtime
      : isRecord(next) && isTimestamp(next.timestamp) ? next.timestamp
      : isTimestamp(durationSeconds) ? durationSeconds * 1000 : undefined;
    if (!text || endtime === undefined || endtime <= line.timestamp) continue;
    content.push({
      Type: "Vocal", Text: text, StartTime: line.timestamp / 1000, EndTime: endtime / 1000,
      OppositeAligned: line.oppositeTurn === true
    });
  }
  const first = content[0], last = content.at(-1);
  return first && last ? { Type: "Line", StartTime: first.StartTime, EndTime: last.EndTime, Content: content } : undefined;
}

export function createAppleMusicProvider(fetchImpl: typeof fetch = fetch): AppleMusicProvider {
  return {
    async getLyrics(track, context = {}) {
      // iTunes lookup stays on the client. This adapter only calls the Apple Music lyrics endpoint.
      const id = track.appleMusicId;
      if (!id || !/^\d+$/.test(id)) {
        if (context.trace) context.trace.reason = "apple_music_id_unavailable";
        return undefined;
      }
      const source = {
        Provider: "applemusic", Transport: "lyrically", TrackId: id,
        MatchedTitle: track.appleMusicTitle ?? track.name
      } as const;
      recordMatch(context, source);
      const url = new URL("https://lyrics.paxsenix.org/apple-music/lyrics");
      url.searchParams.set("id", id);
      url.searchParams.set("v", "2");
      const request = contextFetch(fetchImpl, context);
      return withLyricRequestRetries(async signal => {
        const response = await request(url.toString(), { headers: { Accept: "application/json" }, signal });
        const payload: unknown = await response.json().catch(() => undefined);
        const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
        recordUpstreamResult(context, { operation: "lyrics", codes: { code: typeof error?.code === "number" ? error.code : undefined } });
        if (!response.ok) {
          recordUpstreamResult(context, { result: "http_error" });
          return undefined;
        }
        if (!isRecord(payload)) {
          recordUpstreamResult(context, { result: "invalid_payload" });
          return undefined;
        }
        if (payload.error || payload.isError) {
          recordUpstreamResult(context, { result: "api_error" });
          return undefined;
        }
        if (!Array.isArray(payload.lyrics)) {
          recordUpstreamResult(context, { result: payload.lyrics === null || payload.syncType === null ? "no_lyrics" : "invalid_payload" });
          return undefined;
        }
        const lyrics = payload.syncType === "Syllable" || payload.syncType === "Word"
          ? timedWordsToSyllableLyrics(payload.lyrics) : timedLinesToLineLyrics(payload.lyrics, track.durationSeconds);
        recordUpstreamResult(context, { result: lyrics ? "found" : "no_lyrics", resultCount: lyrics?.Content.length ?? 0 });
        return withSource(lyrics, source);
      }, "Apple Music lyrics", context);
    }
  };
}

export const appleMusicProvider = createAppleMusicProvider();
