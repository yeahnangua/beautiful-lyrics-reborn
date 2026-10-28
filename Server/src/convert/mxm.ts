// MXM subtitle format referenced from Spicetify lyrics-plus (LGPL-2.1).
// See NOTICE.md and LICENSES/Spicetify-LGPL-2.1.txt.
import type { LineSyncedLyrics, LineVocal } from "../types";

/** Musixmatch's mxm subtitle format uses absolute seconds in time.total. */
export function convertMxmToLineLyrics(body: string | undefined, durationSeconds?: number): LineSyncedLyrics | undefined {
  if (!body) return undefined;
  try {
    const rows: unknown = JSON.parse(body);
    if (!Array.isArray(rows)) return undefined;
    const lines: { text: string; time: number }[] = [];
    for (const row of rows) {
      if (typeof row?.text !== "string" || !row.text.trim() ||
          typeof row.time?.total !== "number" || !Number.isFinite(row.time.total) || row.time.total < 0) continue;
      lines.push({ text: row.text.trim(), time: row.time.total });
    }
    lines.sort((a, b) => a.time - b.time);
    const content: LineVocal[] = lines.map((line, index) => ({
      Type: "Vocal", Text: line.text, StartTime: line.time,
      EndTime: lines.slice(index + 1).find(next => next.time > line.time)?.time ??
        (durationSeconds !== undefined && Number.isFinite(durationSeconds) && durationSeconds > line.time
          ? durationSeconds : line.time + 5),
      OppositeAligned: false
    }));
    if (!content.length) return undefined;
    return { Type: "Line", StartTime: content[0]!.StartTime, EndTime: content.at(-1)!.EndTime, Content: content };
  } catch {
    return undefined;
  }
}
