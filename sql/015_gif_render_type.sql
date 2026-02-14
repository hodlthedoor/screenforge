-- Add 'gif' to the render_jobs type CHECK constraint
-- Run: psql screenforge < sql/015_gif_render_type.sql

ALTER TABLE render_jobs DROP CONSTRAINT IF EXISTS render_jobs_type_check;
ALTER TABLE render_jobs ADD CONSTRAINT render_jobs_type_check CHECK (type IN ('screenshot', 'pdf', 'og', 'gif'));
