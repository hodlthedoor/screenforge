-- Extraction jobs: LLM-powered structured data extraction from screenshots
CREATE TABLE IF NOT EXISTS extraction_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('url', 'job_id')),
  source_url TEXT,
  source_job_id UUID REFERENCES render_jobs(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  response_schema JSONB,
  model TEXT NOT NULL DEFAULT 'sonnet',
  screenshot_path TEXT,
  extracted_data JSONB,
  tokens_used INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error TEXT,
  duration_ms INTEGER,
  byok BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_extraction_jobs_api_key ON extraction_jobs (api_key_id);
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_status ON extraction_jobs (status);

-- Daily extraction usage counter (separate from render usage)
CREATE TABLE IF NOT EXISTS extraction_usage_daily (
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, date)
);
