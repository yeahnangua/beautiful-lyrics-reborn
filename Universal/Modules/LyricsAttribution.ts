import type { SpicyAttribution } from "../Types/Lyrics.ts";

/** Contributor URLs are external data; never turn script/data URLs into links. */
export function contributorUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function attributionParts(attribution: SpicyAttribution): { text: string; href?: string | undefined }[] {
  const parts: { text: string; href?: string | undefined }[] = [{ text: `Lyrics via ${attribution.provider}` }];
  if (attribution.source === "spicy_lyrics") {
    for (const [contributor, separator] of [[attribution.uploader, " · "], [attribution.maker, " / "]] as const) {
      if (!contributor) continue;
      parts.push({ text: separator }, { text: `🔗 ${contributor.username}`, href: contributorUrl(contributor.url) });
    }
  }
  return parts;
}

export function attributionText(attribution: SpicyAttribution): string {
  return attributionParts(attribution).map(part => part.text).join("");
}
