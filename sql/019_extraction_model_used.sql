-- Store the full model ID used for extraction (e.g. 'claude-sonnet-4-5-20250929')
ALTER TABLE extraction_jobs ADD COLUMN IF NOT EXISTS model_used TEXT;
