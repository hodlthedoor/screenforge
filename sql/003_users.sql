-- ScreenForge User Auth schema
-- Run: psql screenforge < sql/003_users.sql

CREATE TABLE IF NOT EXISTS users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           text NOT NULL UNIQUE,
    password_hash   text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Link users to API keys they create from dashboard
CREATE TABLE IF NOT EXISTS user_api_keys (
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_id  uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, api_key_id)
);
