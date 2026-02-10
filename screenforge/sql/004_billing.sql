-- ScreenForge Billing schema (Stripe integration)
-- Run: psql screenforge < sql/004_billing.sql

-- Add Stripe columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Subscriptions table for tracking billing state
CREATE TABLE IF NOT EXISTS subscriptions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_sub_id       text NOT NULL UNIQUE,
    plan                text NOT NULL CHECK (plan IN ('starter', 'pro', 'business')),
    status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'incomplete', 'trialing')),
    current_period_end  timestamptz NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_sub_id);
