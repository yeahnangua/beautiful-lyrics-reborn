import type { LineSyncedLyrics, LineVocal } from "../types";

type LrcLine = {
  time: number;
  text: string;
};

const timestampPattern = /\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/g;

export function parseLrcTimestamp(timestamp: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(timestamp);
  if (match === null) {
    return undefined;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3] ?? "0";
  const milliseconds = Number(fraction.padEnd(3, "0"));

  return minutes * 60 + seconds + milliseconds / 1000;
}

export function convertLrcToLineLyrics(
  lrc: string | undefined | null,
  durationSeconds?: number
): LineSyncedLyrics | undefined {
  if (lrc === undefined || lrc === null) {
    return undefined;
  }

  const parsedLines: LrcLine[] = [];
  for (const rawLine of lrc.split(/\r?\n/)) {
    const timestamps = [...rawLine.matchAll(timestampPattern)];
    if (timestamps.length === 0) {
      continue;
    }

    const text = rawLine.replace(timestampPattern, "").trim();
    if (text.length === 0) {
      continue;
    }

    for (const timestamp of timestamps) {
      const timestampValue = timestamp[1];
      if (timestampValue === undefined) {
        continue;
      }

      const time = parseLrcTimestamp(timestampValue);
      if (time !== undefined) {
        parsedLines.push({ time, text });
      }
    }
  }

  parsedLines.sort((left, right) => left.time - right.time);

  if (parsedLines.length === 0) {
    return undefined;
  }

  const content: LineVocal[] = parsedLines.map((line, index) => {
    const nextLine = parsedLines[index + 1];
    const fallbackEndTime = durationSeconds ?? line.time + 5;
    const endTime = Math.max(line.time, nextLine?.time ?? fallbackEndTime);

    return {
      Type: "Vocal",
      Text: line.text,
      StartTime: line.time,
      EndTime: endTime,
      OppositeAligned: false
    };
  });

  const first = content[0];
  const last = content[content.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }

  return {
    Type: "Line",
    StartTime: first.StartTime,
    EndTime: last.EndTime,
    Content: content
  };
}
