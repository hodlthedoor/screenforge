-- ScreenForge Enhanced Metadata Schema
-- Run: psql screenforge < sql/012_enhanced_metadata.sql
-- Run: psql screenforge_test < sql/012_enhanced_metadata.sql

-- Add enhanced metadata JSON column to render_jobs table
-- This stores the full metadata object including OG tags, Twitter Cards, etc.
ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS metadata_enhanced jsonb;

-- Create index on OG image for analytics/debugging
CREATE INDEX IF NOT EXISTS idx_render_jobs_metadata_og_image
  ON render_jobs ((metadata_enhanced->'og'->>'image'));
