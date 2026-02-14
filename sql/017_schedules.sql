-- Scheduled screenshots: recurring capture jobs with cron-style scheduling
CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  cron_expression VARCHAR(100) NOT NULL,
  render_type VARCHAR(20) NOT NULL CHECK (render_type IN ('screenshot', 'pdf', 'og')),
  render_config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient polling: find enabled schedules that are due
CREATE INDEX IF NOT EXISTS idx_schedules_polling ON schedules (enabled, next_run_at)
  WHERE enabled = true;

-- Index for listing schedules by API key
CREATE INDEX IF NOT EXISTS idx_schedules_api_key ON schedules (api_key_id);

-- Link render jobs back to schedules for history tracking
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES schedules(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_render_jobs_schedule_id ON render_jobs (schedule_id) WHERE schedule_id IS NOT NULL;
