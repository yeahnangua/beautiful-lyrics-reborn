import { isSourceBlocked } from "./source-policy";
import type { BeautifulLyrics, SourceBlock } from "./types";

const day = 86_400_000;

/**
 * How long a stored result stays authoritative, by lyric quality.
 * Syllable rows come from official karaoke tracks and rarely change; static
 * rows are community-submitted and drift, so they expire fastest.
 */
const ttlByType: Record<BeautifulLyrics["Type"], number> = {
  Syllable: 30 * day,
  Line: 14 * day,
  Static: 3 * day
};

/** Bumped when the stored payload shape changes; old rows then read as misses. */
const schema = 1;

type StoredEntry = { schema: number; lyrics: BeautifulLyrics };
type CacheRow = { provider: string; lyrics_type: BeautifulLyrics["Type"]; data: string };

export function cacheTtlMs(type: BeautifulLyrics["Type"]): number {
  return ttlByType[type];
}

export type LyricsCache = {
  get(trackId: string, blocks: readonly SourceBlock[]): Promise<BeautifulLyrics | undefined>;
  put(trackId: string, lyrics: BeautifulLyrics): Promise<void>;
  invalidate(trackId: string): Promise<void>;
};

const disabled: LyricsCache = {
  get: async () => undefined,
  put: async () => {},
  invalidate: async () => {}
};

/**
 * Two-level-by-intent cache: the table stores one row per track, but the read
 * path re-applies moderation, so a block always beats a stale row.
 */
export function createLyricsCache(db: D1Database | undefined): LyricsCache {
  if (!db) return disabled;

  const invalidate = async (trackId: string): Promise<void> => {
    await db.prepare("DELETE FROM lyrics_cache WHERE spotify_id=?").bind(trackId).run();
  };

  const get = async (trackId: string, blocks: readonly SourceBlock[]): Promise<BeautifulLyrics | undefined> => {
    const row = await db
      .prepare("SELECT provider,lyrics_type,data FROM lyrics_cache WHERE spotify_id=? AND expires_at>?")
      .bind(trackId, Date.now())
      .first<CacheRow>();
    if (!row) return undefined;
    if (isSourceBlocked(blocks, row.provider, row.lyrics_type)) {
      // A moderation block must not be bypassed by a row cached before it existed.
      await invalidate(trackId).catch(() => {});
      return undefined;
    }
    try {
      const entry = JSON.parse(row.data) as StoredEntry;
      if (entry.schema !== schema || entry.lyrics.Type !== row.lyrics_type) throw new Error("Stale cache entry");
      return entry.lyrics;
    } catch {
      await invalidate(trackId).catch(() => {});
      return undefined;
    }
  };

  const put = async (trackId: string, lyrics: BeautifulLyrics): Promise<void> => {
    const source = lyrics.Source;
    // Without a provider the row could not be re-checked against blocks on read.
    if (!source) return;
    const now = Date.now();
    const stored: StoredEntry = { schema, lyrics: strip(lyrics) };
    await db
      .prepare(`INSERT INTO lyrics_cache(spotify_id,provider,transport,lyrics_type,lyrics_hash,stored_at,expires_at,data)
        VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(spotify_id) DO UPDATE SET provider=excluded.provider,transport=excluded.transport,
          lyrics_type=excluded.lyrics_type,lyrics_hash=excluded.lyrics_hash,stored_at=excluded.stored_at,
          expires_at=excluded.expires_at,data=excluded.data`)
      .bind(trackId, source.Provider, source.Transport, lyrics.Type, lyrics.LyricsHash ?? "",
        now, now + ttlByType[lyrics.Type], JSON.stringify(stored))
      .run();
  };

  return { get, put, invalidate };
}

/** Request-scoped fields describe one response and must never be replayed. */
function strip(lyrics: BeautifulLyrics): BeautifulLyrics {
  const { RequestId: _requestId, RetrievedAt: _retrievedAt, LyricsHash: _hash, ...content } = lyrics;
  return content as BeautifulLyrics;
}
