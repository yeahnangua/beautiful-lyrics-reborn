CREATE TABLE source_blocks (
  id TEXT PRIMARY KEY,
  spotify_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  lyrics_type TEXT NOT NULL CHECK(lyrics_type IN ('Syllable','Line','Static')),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  reason TEXT NOT NULL,
  report_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(spotify_id, provider, lyrics_type)
);
CREATE INDEX source_blocks_time ON source_blocks(created_at DESC,id DESC);
CREATE TABLE source_block_history (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL REFERENCES source_blocks(id),
  created_at TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  reason TEXT NOT NULL,
  report_id TEXT
);
CREATE INDEX source_block_history_block ON source_block_history(block_id,created_at,id);
