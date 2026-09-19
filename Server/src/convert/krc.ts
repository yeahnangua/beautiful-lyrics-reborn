// Adapted from lrcmux/internal/providers/kugou/{decode,parse}.go (MIT).
// Copyright © 2026 f1nniboy. See NOTICE.md and LICENSES/lrcmux-MIT.txt.
// Changed 2026-09-19: Web Streams decoding and Beautiful Lyrics timing objects.
import { decodeHtmlEntities } from "./entities";
import type { SyllableMetadata, SyllableSyncedLyrics, SyllableVocalSet } from "../types";

const krcKey = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
const maxKrcBytes = 1024 * 1024;

export async function decodeKrc(content: string | undefined): Promise<string | undefined> {
  if (typeof content !== "string" || content.length === 0 || content.length > maxKrcBytes * 2) {
    return undefined;
  }
  try {
    const raw = atob(content);
    if (!raw.startsWith("krc1") || raw.length <= 4) {
      return undefined;
    }
    const compressed = new Uint8Array(raw.length - 4);
    for (let index = 0; index < compressed.length; index += 1) {
      compressed[index] = raw.charCodeAt(index + 4) ^ krcKey[index % krcKey.length]!;
    }
    const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    let size = 0;
    let text = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          return text + decoder.decode();
        }
        size += value.byteLength;
        if (size > maxKrcBytes) {
          return undefined;
        }
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch {
    return undefined;
  }
}

export function convertKrcToSyllableLyrics(krc: string | undefined): SyllableSyncedLyrics | undefined {
  if (!krc) {
    return undefined;
  }
  const content: SyllableVocalSet[] = [];
  for (const line of krc.split(/\r?\n/)) {
    const match = /^\[(\d+),(\d+)\](.*)$/.exec(line.trim());
    if (match === null) {
      continue;
    }
    const lineStart = Number(match[1]);
    const lineDuration = Number(match[2]);
    if (!Number.isSafeInteger(lineStart) || !Number.isSafeInteger(lineDuration) || lineDuration <= 0) {
      continue;
    }
    const words = [...match[3]!.matchAll(/<(\d+),(\d+),\d+>(.*?)(?=<\d+,\d+,\d+>|$)/g)]
      .map((word) => ({
        text: decodeHtmlEntities(word[3]!),
        start: lineStart + Number(word[1]),
        end: lineStart + Number(word[1]) + Number(word[2])
      }))
      .filter((word) => Number.isSafeInteger(word.start) && Number.isSafeInteger(word.end) && word.end > word.start);
    const syllables: SyllableMetadata[] = [];
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index]!;
      const next = words[index + 1];
      const text = word.text.trim();
      if (!text) {
        continue;
      }
      const end = next !== undefined && next.start > word.start ? Math.min(word.end, next.start) : word.end;
      syllables.push({
        Text: text,
        StartTime: word.start / 1000,
        EndTime: end / 1000,
        IsPartOfWord: next !== undefined && !/\s$/.test(word.text) && !/^\s/.test(next.text)
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
      Lead: {
        StartTime: first.StartTime,
        EndTime: Math.max(...syllables.map((word) => word.EndTime)),
        Syllables: syllables
      }
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
