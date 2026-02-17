-- A/B test event tracking table
-- Run: psql screenforge < sql/024_ab_test_events.sql

CREATE TABLE IF NOT EXISTS ab_test_events (
  id BIGSERIAL PRIMARY KEY,
  variant VARCHAR(10) NOT NULL,
  event_type VARCHAR(50) NOT NULL, -- 'view' or 'signup'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ab_test_events_variant_type
  ON ab_test_events (variant, event_type);

CREATE INDEX IF NOT EXISTS idx_ab_test_events_created_at
  ON ab_test_events (created_at);
