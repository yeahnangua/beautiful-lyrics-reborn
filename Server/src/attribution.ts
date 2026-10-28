import type { BeautifulLyrics } from "./types";
import { attributionText } from "../../Universal/Modules/LyricsAttribution";

/** Project credits into the lyric stream at response time; cached provider data stays untouched. */
export function appendAttributionLyric(lyrics: BeautifulLyrics, duration?: number): BeautifulLyrics {
  if (!lyrics.Attribution) return lyrics;
  const Text = attributionText(lyrics.Attribution);
  const IsAttribution = true as const;
  if (lyrics.Type === "Static") {
    return { ...lyrics, Lines: [...lyrics.Lines.filter(line => !line.IsAttribution), { Text, IsAttribution }] };
  }
  const EndTime = duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : lyrics.EndTime;
  const StartTime = Math.max(0, EndTime - 0.1);
  if (lyrics.Type === "Line") {
    return { ...lyrics, EndTime: Math.max(lyrics.EndTime, EndTime), Content: [
      ...lyrics.Content.filter(group => group.Type !== "Vocal" || !group.IsAttribution),
      { Type: "Vocal", Text, IsAttribution, OppositeAligned: false, StartTime, EndTime }
    ] };
  }
  return { ...lyrics, EndTime: Math.max(lyrics.EndTime, EndTime), Content: [
    ...lyrics.Content.filter(group => group.Type !== "Vocal" || !group.IsAttribution),
    { Type: "Vocal", IsAttribution, OppositeAligned: false,
      Lead: { StartTime, EndTime, Syllables: [{ Text, StartTime, EndTime, IsPartOfWord: false }] } }
  ] };
}
