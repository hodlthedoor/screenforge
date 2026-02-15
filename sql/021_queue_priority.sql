-- Add priority column to render_jobs for tier-based queue priority
-- BullMQ uses lower number = higher priority
-- business=10, pro=20, starter=30, free=40

ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 40;

CREATE INDEX IF NOT EXISTS idx_render_jobs_priority ON render_jobs(priority);
