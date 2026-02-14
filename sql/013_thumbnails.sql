-- ScreenForge Thumbnail Storage Migration
-- Run: psql screenforge < sql/013_thumbnails.sql
-- Run for test DB: psql screenforge_test < sql/013_thumbnails.sql

-- Add thumbnail_path column to render_jobs table for storing thumbnail file paths
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS thumbnail_path text;

-- Add thumbnail_url column for S3 backend public URLs
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS thumbnail_url text;
