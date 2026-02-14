-- Accessibility audit jobs table
CREATE TABLE IF NOT EXISTS accessibility_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  standard TEXT NOT NULL DEFAULT 'WCAG2AA',
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  violations_count INTEGER,
  passes_count INTEGER,
  incomplete_count INTEGER,
  violations JSONB,
  screenshot_path TEXT,
  annotated_screenshot_path TEXT,
  duration_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_accessibility_jobs_api_key ON accessibility_jobs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_accessibility_jobs_created ON accessibility_jobs(created_at DESC);

-- Daily usage tracking for accessibility audits
CREATE TABLE IF NOT EXISTS accessibility_usage_daily (
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, date)
);
