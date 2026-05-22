import type { StaticSyncedLyrics } from "../types";

export function convertPlainTextToStatic(text: string | undefined | null): StaticSyncedLyrics | undefined {
  if (text === undefined || text === null) {
    return undefined;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ Text: line }));

  if (lines.length === 0) {
    return undefined;
  }

  return {
    Type: "Static",
    Lines: lines
  };
}
