-- ScreenForge Auth, Queue & Security schema
-- Run: psql screenforge < sql/002_auth_queue.sql

-- Drop old tables if they exist (from prototype)
DROP TABLE IF EXISTS usage_logs CASCADE;
DROP TABLE IF EXISTS renders CASCADE;
DROP TABLE IF EXISTS usage_daily CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS render_jobs CASCADE;
DROP TABLE IF EXISTS batch_jobs CASCADE;

-- API keys with SHA-256 hashed keys
CREATE TABLE api_keys (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash    text NOT NULL UNIQUE,
    prefix      text NOT NULL,
    name        text NOT NULL,
    tier        text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'pro', 'business')),
    rate_limit  integer NOT NULL DEFAULT 10,
    monthly_quota integer NOT NULL DEFAULT 1000,
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_prefix ON api_keys(prefix);

-- Daily usage counters
CREATE TABLE usage_daily (
    api_key_id  uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    date        date NOT NULL DEFAULT CURRENT_DATE,
    count       integer NOT NULL DEFAULT 0,
    PRIMARY KEY (api_key_id, date)
);

CREATE INDEX idx_usage_daily_date ON usage_daily(date);

-- Render jobs (for async queue)
CREATE TABLE render_jobs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id  uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    type        text NOT NULL CHECK (type IN ('screenshot', 'pdf', 'og')),
    url         text NOT NULL,
    options     jsonb NOT NULL DEFAULT '{}',
    status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    result_path text,
    content_type text,
    error       text,
    callback_url text,
    batch_id    uuid,
    created_at  timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    duration_ms integer
);

CREATE INDEX idx_render_jobs_api_key_id ON render_jobs(api_key_id);
CREATE INDEX idx_render_jobs_status ON render_jobs(status);
CREATE INDEX idx_render_jobs_batch_id ON render_jobs(batch_id);
CREATE INDEX idx_render_jobs_created_at ON render_jobs(created_at);

-- Batch jobs
CREATE TABLE batch_jobs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id  uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    total       integer NOT NULL,
    completed   integer NOT NULL DEFAULT 0,
    failed      integer NOT NULL DEFAULT 0,
    status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

CREATE INDEX idx_batch_jobs_api_key_id ON batch_jobs(api_key_id);
