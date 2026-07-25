const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, decimal, hex, name) => {
    if (name !== undefined) {
      return namedEntities[name.toLowerCase()] ?? match;
    }
    try {
      return String.fromCodePoint(Number.parseInt(decimal ?? hex, decimal === undefined ? 16 : 10));
    } catch {
      return match;
    }
  });
}

// Upstream lyric sources (YouTube caption XML, Genius HTML, TTML, ...) leak escaped
// entities into text; decoding every string in the payload is safe because the only
// other string fields are enum-like Type values that never contain "&".
export function decodeEntitiesDeep<T>(value: T): T {
  if (typeof value === "string") {
    return decodeHtmlEntities(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(decodeEntitiesDeep) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, decodeEntitiesDeep(entry)])
    ) as T;
  }
  return value;
}
