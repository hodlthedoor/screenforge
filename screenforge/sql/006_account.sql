-- ScreenForge Account Management schema
-- Run: psql screenforge < sql/006_account.sql

-- Add account management columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_token text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_token_expires timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires timestamptz;

-- Add partial indexes for token lookup (only index non-null tokens)
CREATE INDEX IF NOT EXISTS idx_users_email_token ON users(email_token) WHERE email_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_password_reset_token ON users(password_reset_token) WHERE password_reset_token IS NOT NULL;
