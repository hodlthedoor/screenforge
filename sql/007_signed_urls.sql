-- ScreenForge Signed URLs schema
-- Run: psql screenforge < sql/007_signed_urls.sql

-- Enable pgcrypto extension for gen_random_bytes
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add signing_secret column for signed URL generation
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS signing_secret text;

-- Backfill existing keys with a random signing secret
UPDATE api_keys SET signing_secret = encode(gen_random_bytes(32), 'hex') WHERE signing_secret IS NULL;

-- Make signing_secret NOT NULL after backfill
ALTER TABLE api_keys ALTER COLUMN signing_secret SET NOT NULL;
