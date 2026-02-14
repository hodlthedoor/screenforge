-- Drop unused thumbnail_url column from render_jobs
-- The thumbnail URL is computed at read-time from thumbnail_path, not stored.
-- Run: psql screenforge < sql/014_drop_thumbnail_url.sql
-- Run for test DB: psql screenforge_test < sql/014_drop_thumbnail_url.sql

ALTER TABLE render_jobs DROP COLUMN IF EXISTS thumbnail_url;
