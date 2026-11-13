import type { LyricsAttribution } from "../Types/Lyrics.ts";

/** Contributor URLs are external data; never turn script/data URLs into links. */
export function contributorUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function attributionParts(attribution: LyricsAttribution): { text: string; href?: string | undefined }[] {
  if (attribution.provider === "lrc.red") {
    return [{ text: "Lyrics via " }, { text: "lrc.red", href: "https://lrc.red" }];
  }
  if (attribution.provider === "betterlyrics") {
    return [{ text: "Lyrics via " }, { text: "Better Lyrics", href: "https://betterlyrics.org" }];
  }
  if (attribution.provider === "unison") {
    return [
      { text: "Lyrics from " },
      { text: "Unison", href: `https://unison.betterlyrics.org/song/${encodeURIComponent(attribution.songId)}` },
      { text: " · submitted by " },
      { text: attribution.submitter.username, href: contributorUrl(attribution.submitter.url) },
    ];
  }
  const parts: { text: string; href?: string | undefined }[] = [{ text: `Lyrics via ${attribution.provider}` }];
  if (attribution.source === "spicy_lyrics") {
    for (const [contributor, separator] of [[attribution.uploader, " · "], [attribution.maker, " / "]] as const) {
      if (!contributor) continue;
      parts.push({ text: separator }, { text: `🔗 ${contributor.username}`, href: contributorUrl(contributor.url) });
    }
  }
  return parts;
}

export function attributionText(attribution: LyricsAttribution): string {
  return attributionParts(attribution).map(part => part.text).join("");
}
