-- Add retry tracking columns to render_jobs
-- Run: psql screenforge < sql/022_retry_policy.sql
-- Run for test DB: psql screenforge_test < sql/022_retry_policy.sql

ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_category text,
  ADD COLUMN IF NOT EXISTS retry_history jsonb NOT NULL DEFAULT '[]';
