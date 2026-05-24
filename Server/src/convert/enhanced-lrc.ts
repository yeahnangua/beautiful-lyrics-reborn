import { parseLrcTimestamp } from "./lrc";
import type { SyllableMetadata, SyllableSyncedLyrics, SyllableVocalSet } from "../types";

type EnhancedLrcWord = {
  text: string;
  startTime: number;
  endTime: number;
};

type EnhancedLrcLine = {
  lineTime: number;
  words: EnhancedLrcWord[];
};

const lineTimestampPattern = /^\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/;
const wordTimestampPattern = /<(\d{1,2}:\d{2}(?:\.\d{1,3})?)>/g;

function normalizeWordText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseEnhancedLine(rawLine: string): Omit<EnhancedLrcLine, "words"> & { timedParts: Array<{ time: number; text: string }> } | undefined {
  const lineMatch = lineTimestampPattern.exec(rawLine.trim());
  if (lineMatch === null) {
    return undefined;
  }

  const lineTimeValue = lineMatch?.[1];
  if (lineTimeValue === undefined) {
    return undefined;
  }

  const lineTime = parseLrcTimestamp(lineTimeValue);
  if (lineTime === undefined) {
    return undefined;
  }

  const body = rawLine.slice(lineMatch[0].length);
  const matches = [...body.matchAll(wordTimestampPattern)];
  if (matches.length === 0) {
    return undefined;
  }

  const timedParts = matches
    .map((match, index) => {
      const timestamp = match[1] === undefined ? undefined : parseLrcTimestamp(match[1]);
      const nextMatch = matches[index + 1];
      const textStart = match.index === undefined ? 0 : match.index + match[0].length;
      const textEnd = nextMatch?.index ?? body.length;
      return timestamp === undefined ? undefined : { time: timestamp, text: normalizeWordText(body.slice(textStart, textEnd)) };
    })
    .filter((part): part is { time: number; text: string } => part !== undefined);

  return { lineTime, timedParts };
}

export function convertEnhancedLrcToSyllableLyrics(
  enhancedLrc: string | undefined | null,
  durationSeconds?: number
): SyllableSyncedLyrics | undefined {
  if (enhancedLrc === undefined || enhancedLrc === null || enhancedLrc.trim().length === 0) {
    return undefined;
  }

  const parsedLines = enhancedLrc
    .split(/\r?\n/)
    .map(parseEnhancedLine)
    .filter((line): line is Omit<EnhancedLrcLine, "words"> & { timedParts: Array<{ time: number; text: string }> } => line !== undefined)
    .sort((left, right) => left.lineTime - right.lineTime);

  const lines: EnhancedLrcLine[] = parsedLines.map((line, lineIndex) => {
    const nextLine = parsedLines[lineIndex + 1];
    const fallbackEndTime = durationSeconds ?? line.lineTime + 5;
    const lineEndTime = Math.max(line.lineTime, nextLine?.lineTime ?? fallbackEndTime);
    const words = line.timedParts
      .map((part, partIndex) => {
        const nextPart = line.timedParts[partIndex + 1];
        return {
          text: part.text,
          startTime: part.time,
          endTime: Math.max(part.time, nextPart?.time ?? lineEndTime)
        };
      })
      .filter((word) => word.text.length > 0 && word.endTime > word.startTime);

    return { lineTime: line.lineTime, words };
  });

  const content: SyllableVocalSet[] = [];
  for (const line of lines) {
    if (line.words.length === 0) {
      continue;
    }

    const syllables: SyllableMetadata[] = line.words.map((word) => ({
      Text: word.text,
      StartTime: word.startTime,
      EndTime: word.endTime,
      IsPartOfWord: false
    }));

    const first = syllables[0];
    const last = syllables[syllables.length - 1];
    if (first === undefined || last === undefined) {
      continue;
    }

    content.push({
      Type: "Vocal",
      OppositeAligned: false,
      Lead: {
        StartTime: first.StartTime,
        EndTime: last.EndTime,
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
