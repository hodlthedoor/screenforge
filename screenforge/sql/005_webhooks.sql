-- ScreenForge Webhooks schema
-- Run: psql screenforge < sql/005_webhooks.sql

-- Add webhook configuration to API keys
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS webhook_url text;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS webhook_secret text;

CREATE INDEX IF NOT EXISTS idx_api_keys_webhook_url ON api_keys(webhook_url) WHERE webhook_url IS NOT NULL;

-- Webhook delivery tracking table
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id      uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    job_id          uuid REFERENCES render_jobs(id) ON DELETE SET NULL,
    url             text NOT NULL,
    payload         jsonb NOT NULL,
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'delivered', 'failed')),
    attempts        integer NOT NULL DEFAULT 0,
    last_status_code integer,
    last_error      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    delivered_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_api_key_id ON webhook_deliveries(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_job_id ON webhook_deliveries(job_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
