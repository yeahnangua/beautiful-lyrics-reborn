import type { BeautifulLyrics, LyricsSource, SourceBlock } from "./types";

export const sourceProviders = ["qqmusic", "kugou", "netease", "musixmatch", "applemusic", "spotify", "deezer", "youtube", "genius", "lrclib"] as const;
export const lyricsTypes = ["Syllable", "Line", "Static"] as const;
export const validSpotifyId = (value: string): boolean => /^[a-zA-Z0-9]+$/.test(value) && value.length <= 100;

export function providerName(name: string): string {
  const aliases: Record<string, string> = { "qq music": "qqmusic", "apple music": "applemusic", "spotify proxy": "spotify" };
  return aliases[name] ?? name.replace(/ direct$/, "");
}

export function candidateSource(name: string, lyrics: BeautifulLyrics): LyricsSource {
  return lyrics.Source ?? {
    Provider: providerName(name),
    Transport: ["apple music", "kugou", "netease", "deezer", "spotify proxy", "youtube", "genius"].includes(name) ? "lyrically" : "direct"
  };
}

export function isSourceBlocked(blocks: readonly SourceBlock[], provider: string, type: BeautifulLyrics["Type"]): boolean {
  return blocks.some(block => block.provider === provider && block.lyricsType === type);
}

export async function loadSourcePolicy(db: D1Database | undefined, spotifyId: string): Promise<SourceBlock[]> {
  if (!db) return [];
  const rows = await db.prepare("SELECT provider,lyrics_type FROM source_blocks WHERE spotify_id=? AND enabled=1 ORDER BY provider,lyrics_type")
    .bind(spotifyId).all<{ provider: string; lyrics_type: BeautifulLyrics["Type"] }>();
  return rows.results.map(row => ({ provider: row.provider, lyricsType: row.lyrics_type }));
}
