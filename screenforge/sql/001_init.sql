-- ScreenForge initial schema
-- Run: psql screenforge < sql/001_init.sql

CREATE TABLE IF NOT EXISTS api_keys (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash      text NOT NULL UNIQUE,
    name          text NOT NULL,
    tier          text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'pro', 'business')),
    rate_limit    integer NOT NULL DEFAULT 100,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS renders (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id    uuid NOT NULL REFERENCES api_keys(id),
    type          text NOT NULL CHECK (type IN ('screenshot', 'pdf', 'html')),
    url           text NOT NULL,
    options_hash  text NOT NULL,
    status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    file_path     text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    duration_ms   integer
);

CREATE TABLE IF NOT EXISTS usage_daily (
    api_key_id    uuid NOT NULL REFERENCES api_keys(id),
    date          date NOT NULL DEFAULT CURRENT_DATE,
    count         integer NOT NULL DEFAULT 0,
    PRIMARY KEY (api_key_id, date)
);

CREATE INDEX idx_renders_api_key_id ON renders(api_key_id);
CREATE INDEX idx_renders_status ON renders(status);
CREATE INDEX idx_renders_created_at ON renders(created_at);
CREATE INDEX idx_usage_daily_date ON usage_daily(date);
