PRAGMA foreign_keys = ON;
CREATE TABLE lyric_requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  spotify_id TEXT NOT NULL,
  song TEXT NOT NULL,
  artists TEXT NOT NULL,
  provider TEXT NOT NULL,
  outcome TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX requests_time ON lyric_requests(created_at DESC, id DESC);
CREATE INDEX requests_track ON lyric_requests(spotify_id, created_at DESC);
CREATE INDEX requests_provider ON lyric_requests(provider, created_at DESC);
CREATE TABLE provider_attempts (
  request_id TEXT NOT NULL REFERENCES lyric_requests(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (request_id, ordinal)
);
CREATE TABLE lyric_reports (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  spotify_id TEXT NOT NULL,
  song TEXT NOT NULL,
  artists TEXT NOT NULL,
  provider TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  request_id TEXT,
  data TEXT NOT NULL,
  diagnostics TEXT
);
CREATE INDEX reports_time ON lyric_reports(created_at DESC, id DESC);
CREATE INDEX reports_track ON lyric_reports(spotify_id, created_at DESC);
CREATE INDEX reports_status ON lyric_reports(status, created_at DESC);
CREATE TABLE report_snapshots (
  report_id TEXT PRIMARY KEY REFERENCES lyric_reports(id) ON DELETE CASCADE,
  original TEXT NOT NULL,
  displayed TEXT NOT NULL
);
CREATE TABLE report_history (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES lyric_reports(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL
);
CREATE INDEX history_report ON report_history(report_id, created_at, id);
CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  minute INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(key, minute)
);
CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);
