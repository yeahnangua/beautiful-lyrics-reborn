CREATE INDEX IF NOT EXISTS rate_limits_minute ON rate_limits(minute);
CREATE INDEX IF NOT EXISTS admin_sessions_expires ON admin_sessions(expires);
CREATE INDEX IF NOT EXISTS source_blocks_active ON source_blocks(spotify_id,provider,lyrics_type) WHERE enabled=1;
