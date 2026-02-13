-- 009_email.sql: Add email_verified_at timestamp column
-- The email_verified boolean column already exists from 006_account.sql.
-- This adds a proper timestamp for when verification occurred.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- Backfill: set email_verified_at for already-verified users
UPDATE users SET email_verified_at = created_at WHERE email_verified = true AND email_verified_at IS NULL;
