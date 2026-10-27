-- Server-side lyrics cache. One row per Spotify track.
-- provider and lyrics_type are duplicated out of data so moderation blocks can
-- be re-applied on every cache read without parsing the payload.
CREATE TABLE lyrics_cache (
  spotify_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  transport TEXT NOT NULL,
  lyrics_type TEXT NOT NULL CHECK(lyrics_type IN ('Syllable','Line','Static')),
  lyrics_hash TEXT NOT NULL,
  stored_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX lyrics_cache_expiry ON lyrics_cache(expires_at);
