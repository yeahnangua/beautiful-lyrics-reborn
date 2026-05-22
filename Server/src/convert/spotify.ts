import type { BeautifulLyrics, LineSyncedLyrics, LineVocal } from "../types";
import { convertPlainTextToStatic } from "./plain";

type SpotifyLyricsLine = {
  startTimeMs?: string;
  endTimeMs?: string;
  words?: string;
};

type SpotifyLyricsPayload = {
  lyrics?: {
    syncType?: "SYLLABLE_SYNCED" | "LINE_SYNCED" | "UNSYNCED" | string;
    lines?: SpotifyLyricsLine[];
  };
};

function millisecondsToSeconds(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  const milliseconds = Number(value);
  if (Number.isFinite(milliseconds) === false) {
    return undefined;
  }

  return milliseconds / 1000;
}

function firstEndTimeAfter(startTime: number, ...candidates: (number | undefined)[]): number {
  return candidates.find((candidate) => candidate !== undefined && candidate > startTime) ?? startTime + 5;
}

export function convertSpotifyLyricsPayload(payload: SpotifyLyricsPayload): BeautifulLyrics | undefined {
  const lyrics = payload.lyrics;
  const lines = lyrics?.lines ?? [];
  const textLines = lines
    .map((line) => (line.words ?? "").trim())
    .filter((line) => line.length > 0);

  if (textLines.length === 0) {
    return undefined;
  }

  if (lyrics?.syncType === "LINE_SYNCED" || lyrics?.syncType === "SYLLABLE_SYNCED") {
    const content: LineVocal[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === undefined) {
        continue;
      }

      const text = (line.words ?? "").trim();
      const startTime = millisecondsToSeconds(line.startTimeMs);

      if (text.length === 0 || startTime === undefined) {
        continue;
      }

      const explicitEndTime = millisecondsToSeconds(line.endTimeMs);
      const nextStartTime = millisecondsToSeconds(lines[index + 1]?.startTimeMs);
      const endTime = firstEndTimeAfter(startTime, explicitEndTime, nextStartTime);

      content.push({
        Type: "Vocal",
        Text: text,
        StartTime: startTime,
        EndTime: endTime,
        OppositeAligned: false
      });
    }

    if (content.length > 0) {
      const first = content[0];
      const last = content[content.length - 1];
      if (first !== undefined && last !== undefined) {
        return {
          Type: "Line",
          StartTime: first.StartTime,
          EndTime: last.EndTime,
          Content: content
        } satisfies LineSyncedLyrics;
      }
    }
  }

  return convertPlainTextToStatic(textLines.join("\n"));
}
