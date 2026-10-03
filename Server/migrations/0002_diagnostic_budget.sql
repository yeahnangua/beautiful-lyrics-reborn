-- New diagnostics store all provider attempts in lyric_requests.data. Keep legacy rows readable.
CREATE TABLE diagnostic_daily_budget (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);
-- Backfill only reports still waiting for diagnostics, without scanning all feedback per sampled log.
CREATE INDEX reports_missing_diagnostics ON lyric_reports(request_id)
  WHERE request_id IS NOT NULL AND diagnostics IS NULL;
