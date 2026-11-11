-- Diagnostic records only. Lyrics are cached by Workers Cache, not in D1.
CREATE TABLE lyric_origin_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  spotify_id TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX origin_runs_time ON lyric_origin_runs(created_at, id);
-- No foreign key: a report retains its snapshot after origin diagnostics expire.
ALTER TABLE lyric_reports ADD COLUMN origin_run_id TEXT;
CREATE INDEX reports_origin_run ON lyric_reports(origin_run_id)
  WHERE origin_run_id IS NOT NULL;
