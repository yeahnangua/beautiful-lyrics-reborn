import type { SyllableMetadata, SyllableSyncedLyrics, SyllableVocalSet } from "../types";

const pElementPattern = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
const spanElementPattern = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
const attributePattern = /\b([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
const tagPattern = /<[^>]+>/g;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function readAttributes(value: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of value.matchAll(attributePattern)) {
    const name = match[1];
    const attributeValue = match[2];
    if (name !== undefined && attributeValue !== undefined) {
      attributes.set(name, decodeXmlEntities(attributeValue));
    }
  }
  return attributes;
}

function stripTags(value: string): string {
  return decodeXmlEntities(value.replace(tagPattern, "")).trim();
}

export function parseTtmlTime(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  const clockMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/.exec(value);
  if (clockMatch !== null) {
    const first = Number(clockMatch[1]);
    const second = Number(clockMatch[2]);
    const third = clockMatch[3] === undefined ? undefined : Number(clockMatch[3]);
    const milliseconds = Number((clockMatch[4] ?? "0").padEnd(3, "0"));

    if (third === undefined) {
      return first * 60 + second + milliseconds / 1000;
    }

    return first * 3600 + second * 60 + third + milliseconds / 1000;
  }

  const secondsMatch = /^(\d+(?:\.\d+)?)s$/.exec(value);
  if (secondsMatch?.[1] !== undefined) {
    return Number(secondsMatch[1]);
  }

  const bareSecondsMatch = /^(\d+(?:\.\d+)?)$/.exec(value);
  if (bareSecondsMatch?.[1] !== undefined) {
    return Number(bareSecondsMatch[1]);
  }

  const millisecondsMatch = /^(\d+(?:\.\d+)?)ms$/.exec(value);
  if (millisecondsMatch?.[1] !== undefined) {
    return Number(millisecondsMatch[1]) / 1000;
  }

  return undefined;
}

function parseSpanLyrics(pElement: string): SyllableMetadata[] {
  const timedTexts: Array<Omit<SyllableMetadata, "IsPartOfWord">> = [];
  const spanMatches = [...pElement.matchAll(spanElementPattern)];

  for (const match of spanMatches) {
    const rawAttributes = match[1];
    const rawText = match[2];
    if (rawAttributes === undefined || rawText === undefined) {
      continue;
    }

    const text = stripTags(rawText);
    const attributes = readAttributes(rawAttributes);
    const role = attributes.get("ttm:role");
    if (role === "x-bg" || role === "x-translation" || role === "x-roman") {
      continue;
    }

    const startTime = parseTtmlTime(attributes.get("begin"));
    const endTime = parseTtmlTime(attributes.get("end"));

    if (text.length === 0 || startTime === undefined || endTime === undefined || endTime <= startTime) {
      continue;
    }

    timedTexts.push({
      Text: text,
      StartTime: startTime,
      EndTime: endTime
    });
  }

  return timedTexts.map((syllable, index) => ({
    ...syllable,
    IsPartOfWord: index < timedTexts.length - 1
  }));
}

export function convertTtmlToSyllableLyrics(ttml: string | undefined | null): SyllableSyncedLyrics | undefined {
  if (ttml === undefined || ttml === null || ttml.trim().length === 0) {
    return undefined;
  }

  const content: SyllableVocalSet[] = [];
  for (const pMatch of ttml.matchAll(pElementPattern)) {
    const pElement = pMatch[0];
    const syllables = parseSpanLyrics(pElement);

    if (syllables.length === 0) {
      continue;
    }

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
