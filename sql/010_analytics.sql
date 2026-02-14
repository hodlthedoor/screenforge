-- Analytics indexes for efficient aggregation queries
-- Run: psql screenforge < sql/010_analytics.sql

-- Composite index for per-key analytics (covers daily trend and type breakdown queries)
CREATE INDEX IF NOT EXISTS idx_render_jobs_api_key_created
  ON render_jobs (api_key_id, created_at DESC);

-- Index for URL aggregation per key
CREATE INDEX IF NOT EXISTS idx_render_jobs_api_key_url
  ON render_jobs (api_key_id, url);
