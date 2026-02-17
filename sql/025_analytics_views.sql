-- Analytics materialized views for admin dashboard
-- Run: psql screenforge < sql/025_analytics_views.sql

-- Daily render stats by type
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_render_stats AS
SELECT
  created_at::date AS date,
  type AS render_type,
  COUNT(*)::int AS count,
  COUNT(*) FILTER (WHERE status = 'completed')::int AS success_count,
  COUNT(*) FILTER (WHERE status = 'failed')::int AS failure_count,
  COALESCE(AVG(duration_ms) FILTER (WHERE status = 'completed'), 0)::int AS avg_duration_ms
FROM render_jobs
GROUP BY created_at::date, type;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_render_stats_date_type
  ON daily_render_stats (date, render_type);

-- Monthly user stats (signups, active users, churned, revenue)
CREATE MATERIALIZED VIEW IF NOT EXISTS monthly_user_stats AS
SELECT
  date_trunc('month', gs.month)::date AS month,
  COALESCE(signups.count, 0)::int AS new_signups,
  COALESCE(active.count, 0)::int AS active_users,
  COALESCE(churned.count, 0)::int AS churned_users,
  COALESCE(renders.total, 0)::int AS total_renders,
  COALESCE(revenue.amount, 0)::numeric(12, 2) AS revenue
FROM generate_series(
  date_trunc('month', NOW() - INTERVAL '12 months'),
  date_trunc('month', NOW()),
  INTERVAL '1 month'
) AS gs(month)
LEFT JOIN (
  SELECT date_trunc('month', created_at) AS month, COUNT(*)::int AS count
  FROM users
  GROUP BY 1
) signups ON signups.month = gs.month
LEFT JOIN (
  SELECT date_trunc('month', created_at) AS month, COUNT(DISTINCT api_key_id)::int AS count
  FROM render_jobs
  GROUP BY 1
) active ON active.month = gs.month
LEFT JOIN (
  -- Users who rendered in the previous month but not this month (churned)
  SELECT
    date_trunc('month', prev.created_at) + INTERVAL '1 month' AS month,
    COUNT(DISTINCT prev.api_key_id)::int AS count
  FROM render_jobs prev
  WHERE NOT EXISTS (
    SELECT 1 FROM render_jobs curr
    WHERE curr.api_key_id = prev.api_key_id
      AND date_trunc('month', curr.created_at) = date_trunc('month', prev.created_at) + INTERVAL '1 month'
  )
  GROUP BY 1
) churned ON churned.month = gs.month
LEFT JOIN (
  SELECT date_trunc('month', created_at) AS month, COUNT(*)::int AS total
  FROM render_jobs
  GROUP BY 1
) renders ON renders.month = gs.month
LEFT JOIN (
  -- Revenue from subscriptions (sum of Stripe amounts if tracked; otherwise 0)
  SELECT date_trunc('month', created_at) AS month, 0::numeric AS amount
  FROM subscriptions
  WHERE false  -- placeholder until payment amounts are tracked
  GROUP BY 1
) revenue ON revenue.month = gs.month;

CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_user_stats_month
  ON monthly_user_stats (month);
