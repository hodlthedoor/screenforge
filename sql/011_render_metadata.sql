-- ScreenForge Render Metadata Schema
-- Run: psql screenforge < sql/011_render_metadata.sql
-- Run: psql screenforge_test < sql/011_render_metadata.sql

-- Add metadata columns to render_jobs table
ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS metadata_title text,
  ADD COLUMN IF NOT EXISTS metadata_final_url text,
  ADD COLUMN IF NOT EXISTS metadata_status_code integer,
  ADD COLUMN IF NOT EXISTS metadata_width integer,
  ADD COLUMN IF NOT EXISTS metadata_height integer;

-- Create index on final URL for analytics
CREATE INDEX IF NOT EXISTS idx_render_jobs_metadata_final_url
  ON render_jobs (metadata_final_url);
