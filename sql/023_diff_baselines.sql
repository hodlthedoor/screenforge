-- Visual diff baselines: named screenshots stored for regression checks
CREATE TABLE diff_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  storage_path TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(api_key_id, name)
);

CREATE INDEX idx_diff_baselines_api_key ON diff_baselines(api_key_id);
