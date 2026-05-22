import type { SyllableMetadata, SyllableSyncedLyrics, SyllableVocalSet } from "../types";

type KaraokeWord = {
  text: string;
  startMs: number;
  durationMs: number;
};

type KaraokeLine = {
  words: KaraokeWord[];
};

const yrcLinePattern = /^\[(\d+),(\d+)\](.*)$/;
const yrcWordPattern = /\((\d+),(\d+)(?:,\d+)?\)([^(]+)/g;
const qrcLyricContentPattern = /\bLyricContent\s*=\s*"([^"]*)"/i;
const qrcLinePattern = /^\[\s*(\d+)\s*,\s*(\d+)\s*\](.*)$/;
const qrcWordTimingPattern = /\(\s*(\d+)\s*,\s*(\d+)\s*\)/;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function millisecondsToSeconds(value: number): number {
  return value / 1000;
}

function convertKaraokeLines(lines: KaraokeLine[]): SyllableSyncedLyrics | undefined {
  const content: SyllableVocalSet[] = [];

  for (const line of lines) {
    const timedWords = line.words.filter((word) => word.text.length > 0 && word.durationMs > 0);
    if (timedWords.length === 0) {
      continue;
    }

    const syllables: SyllableMetadata[] = timedWords.map((word, index) => ({
      Text: word.text,
      StartTime: millisecondsToSeconds(word.startMs),
      EndTime: millisecondsToSeconds(word.startMs + word.durationMs),
      IsPartOfWord: index < timedWords.length - 1
    }));

    const firstSyllable = syllables[0];
    const lastSyllable = syllables[syllables.length - 1];
    if (firstSyllable === undefined || lastSyllable === undefined) {
      continue;
    }

    content.push({
      Type: "Vocal",
      OppositeAligned: false,
      Lead: {
        StartTime: firstSyllable.StartTime,
        EndTime: lastSyllable.EndTime,
        Syllables: syllables
      }
    });
  }

  const first = content[0];
  const last = content[content.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }

  return {
    Type: "Syllable",
    StartTime: first.Lead.StartTime,
    EndTime: last.Lead.EndTime,
    Content: content
  };
}

function parseYrcLine(line: string): KaraokeLine | undefined {
  const lineMatch = yrcLinePattern.exec(line.trim());
  if (lineMatch === null || lineMatch[3] === undefined) {
    return undefined;
  }

  const words: KaraokeWord[] = [];
  for (const wordMatch of lineMatch[3].matchAll(yrcWordPattern)) {
    const startMs = Number(wordMatch[1]);
    const durationMs = Number(wordMatch[2]);
    const text = wordMatch[3] ?? "";
    if (Number.isFinite(startMs) && Number.isFinite(durationMs) && text.length > 0) {
      words.push({ text, startMs, durationMs });
    }
  }

  return words.length === 0 ? undefined : { words };
}

function parseQrcLine(line: string): KaraokeLine | undefined {
  const lineMatch = qrcLinePattern.exec(line.trim());
  if (lineMatch === null || lineMatch[3] === undefined) {
    return undefined;
  }

  let remainder = lineMatch[3];
  const words: KaraokeWord[] = [];
  while (remainder.length > 0) {
    const timingMatch = qrcWordTimingPattern.exec(remainder);
    if (timingMatch === null || timingMatch.index === undefined) {
      break;
    }

    const text = decodeXmlEntities(remainder.slice(0, timingMatch.index));
    const startMs = Number(timingMatch[1]);
    const durationMs = Number(timingMatch[2]);
    if (Number.isFinite(startMs) && Number.isFinite(durationMs) && text.length > 0) {
      words.push({ text, startMs, durationMs });
    }

    remainder = remainder.slice(timingMatch.index + timingMatch[0].length);
  }

  return words.length === 0 ? undefined : { words };
}

export function convertYrcToSyllableLyrics(yrc: string | undefined | null): SyllableSyncedLyrics | undefined {
  if (yrc === undefined || yrc === null || yrc.trim().length === 0) {
    return undefined;
  }

  const lines = yrc
    .split(/\r?\n/)
    .map(parseYrcLine)
    .filter((line): line is KaraokeLine => line !== undefined);

  return convertKaraokeLines(lines);
}

export function convertQrcXmlToSyllableLyrics(qrcXml: string | undefined | null): SyllableSyncedLyrics | undefined {
  if (qrcXml === undefined || qrcXml === null || qrcXml.trim().length === 0) {
    return undefined;
  }

  const lyricContent = decodeXmlEntities(qrcLyricContentPattern.exec(qrcXml)?.[1] ?? "");
  if (lyricContent.length === 0) {
    return undefined;
  }

  const lines = lyricContent
    .split(/\r?\n/)
    .map(parseQrcLine)
    .filter((line): line is KaraokeLine => line !== undefined);

  return convertKaraokeLines(lines);
}
