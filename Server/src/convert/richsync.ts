// Adapted from Spicetify lyrics-plus/ProviderMusixmatch.js (LGPL-2.1).
// Changed 2026-09-19: validate timings and convert directly to Beautiful Lyrics.
// See NOTICE.md and LICENSES/Spicetify-LGPL-2.1.txt.
import type { SyllableMetadata, SyllableSyncedLyrics, SyllableVocalSet } from "../types";

type RichsyncWord = { c: string; o: number };
const timingTolerance = 0.001;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function convertRichsyncToSyllableLyrics(body: string | undefined): SyllableSyncedLyrics | undefined {
  if (!body) {
    return undefined;
  }
  let lines: unknown;
  try {
    lines = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!Array.isArray(lines)) {
    return undefined;
  }

  const content: SyllableVocalSet[] = [];
  for (const line of lines) {
    if (!isObject(line) || !isTime(line.ts) || !isTime(line.te) || line.te <= line.ts || !Array.isArray(line.l)) {
      continue;
    }
    const start = line.ts;
    const end = line.te;
    const words = line.l.filter((word): word is RichsyncWord =>
      isObject(word) && typeof word.c === "string" && isTime(word.o) && start + word.o <= end + timingTolerance
    );
    const syllables: SyllableMetadata[] = [];
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index]!;
      const next = words[index + 1];
      const startTime = start + word.o;
      const rawEndTime = next === undefined ? end : Math.min(end, start + next.o);
      const text = word.c.trim();
      if (!text || rawEndTime < startTime - timingTolerance) {
        continue;
      }
      // Upstream sometimes rounds the last word's start to the line's end.
      // Keep its text and timing with a minimal positive interval.
      const endTime = rawEndTime <= startTime ? startTime + timingTolerance : rawEndTime;
      syllables.push({
        Text: text,
        StartTime: startTime,
        EndTime: endTime,
        IsPartOfWord: next !== undefined && !/\s$/.test(word.c) && !/^\s/.test(next.c)
      });
    }
    const first = syllables[0];
    const last = syllables[syllables.length - 1];
    if (first === undefined || last === undefined) {
      continue;
    }
    last.IsPartOfWord = false;
    content.push({
      Type: "Vocal",
      OppositeAligned: false,
      Lead: { StartTime: first.StartTime, EndTime: last.EndTime, Syllables: syllables }
    });
  }
  if (content.length === 0) {
    return undefined;
  }
  content.sort((a, b) => a.Lead.StartTime - b.Lead.StartTime);
  return {
    Type: "Syllable",
    StartTime: content[0]!.Lead.StartTime,
    EndTime: Math.max(...content.map((line) => line.Lead.EndTime)),
    Content: content
  };
}
