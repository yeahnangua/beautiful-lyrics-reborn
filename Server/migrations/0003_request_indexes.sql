-- Keep ID lookups and time pagination/retention indexed. Rare admin filters use the time index.
-- Every request still stores its full diagnostics; this migration changes no diagnostic data.
DROP INDEX IF EXISTS requests_track;
DROP INDEX IF EXISTS requests_provider;
