import { getPool } from './index.js';

export interface DateRange {
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
}

export interface AnalyticsMetrics {
  dau: number;
  wau: number;
  mau: number;
  rendersByType: Array<{ type: string; count: number }>;
  successRate: number;
  failureRate: number;
  topApiKeys: Array<{ name: string; count: number }>;
  conversionRate: number;
  churnRate: number;
  dailyTrend: Array<{ date: string; count: number }>;
  tierDistribution: Array<{ tier: string; count: number }>;
  monthlyRevenue: Array<{ month: string; paid_count: number }>;
  funnel: { signups: number; verified: number; first_render: number; paid: number };
}

function buildDateConditions(range: DateRange): {
  conditions: string[];
  conditionsAliased: string[];
  params: unknown[];
} {
  const conditions: string[] = [];
  const conditionsAliased: string[] = [];
  const params: unknown[] = [];

  if (range.from) {
    params.push(range.from);
    conditions.push(`created_at >= $${params.length}::date`);
    conditionsAliased.push(`rj.created_at >= $${params.length}::date`);
  }
  if (range.to) {
    params.push(range.to);
    conditions.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`);
    conditionsAliased.push(`rj.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  return { conditions, conditionsAliased, params };
}

export async function getAnalyticsMetrics(range: DateRange = {}): Promise<AnalyticsMetrics> {
  const pool = getPool();
  const { conditions, conditionsAliased, params } = buildDateConditions(range);
  const whereSimple = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const whereAlias = conditionsAliased.length > 0 ? `WHERE ${conditionsAliased.join(' AND ')}` : '';

  // Run independent queries in parallel
  const [dauResult, byTypeResult, rateResult, topKeysResult, convResult, churnResult, trendResult, tierResult, revenueResult, funnelResult] = await Promise.all([
    // DAU / WAU / MAU
    pool.query<{ dau: number; wau: number; mau: number }>(`
      SELECT
        COUNT(DISTINCT api_key_id) FILTER (WHERE created_at >= CURRENT_DATE)::int AS dau,
        COUNT(DISTINCT api_key_id) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')::int AS wau,
        COUNT(DISTINCT api_key_id) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')::int AS mau
      FROM render_jobs
      ${whereSimple}
    `, params),

    // Renders by type
    pool.query<{ type: string; count: number }>(`
      SELECT type, COUNT(*)::int AS count
      FROM render_jobs
      ${whereSimple}
      GROUP BY type
      ORDER BY count DESC
    `, params),

    // Success / failure rates
    pool.query<{ total: number; success: number; failed: number }>(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS success,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM render_jobs
      ${whereSimple}
    `, params),

    // Top 10 API keys by usage
    pool.query<{ name: string; count: number }>(`
      SELECT ak.name, COUNT(rj.id)::int AS count
      FROM render_jobs rj
      JOIN api_keys ak ON ak.id = rj.api_key_id
      ${whereAlias}
      GROUP BY ak.id, ak.name
      ORDER BY count DESC
      LIMIT 10
    `, params),

    // Free-to-paid conversion rate
    pool.query<{ total_users: number; paid_users: number }>(`
      SELECT
        COUNT(DISTINCT u.id)::int AS total_users,
        COUNT(DISTINCT s.user_id)::int AS paid_users
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
    `),

    // Churn rate
    pool.query<{ churned: number; total_prev: number }>(`
      SELECT
        COUNT(DISTINCT prev.api_key_id) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM render_jobs curr
            WHERE curr.api_key_id = prev.api_key_id
              AND curr.created_at >= NOW() - INTERVAL '30 days'
          )
        )::int AS churned,
        COUNT(DISTINCT prev.api_key_id)::int AS total_prev
      FROM render_jobs prev
      WHERE prev.created_at < NOW() - INTERVAL '30 days'
        AND prev.created_at >= NOW() - INTERVAL '60 days'
    `),

    // Daily trend
    (() => {
      let trendWhere = whereSimple;
      if (!range.from && !range.to) {
        trendWhere = `WHERE created_at >= NOW() - INTERVAL '30 days'`;
      }
      return pool.query<{ date: string; count: number }>(`
        SELECT created_at::date::text AS date, COUNT(*)::int AS count
        FROM render_jobs
        ${trendWhere}
        GROUP BY 1
        ORDER BY 1
      `, params);
    })(),

    // Tier distribution
    pool.query<{ tier: string; count: number }>(`
      SELECT tier, COUNT(*)::int AS count
      FROM api_keys
      WHERE active = true
      GROUP BY tier
      ORDER BY tier
    `),

    // Monthly revenue trend (last 12 months)
    pool.query<{ month: string; paid_count: number }>(`
      SELECT
        date_trunc('month', created_at)::date::text AS month,
        COUNT(DISTINCT user_id)::int AS paid_count
      FROM subscriptions
      WHERE status = 'active'
        AND created_at >= NOW() - INTERVAL '12 months'
      GROUP BY 1
      ORDER BY 1
    `),

    // Conversion funnel
    pool.query<{ signups: number; verified: number; first_render: number; paid: number }>(`
      SELECT
        COUNT(*)::int AS signups,
        COUNT(*) FILTER (WHERE email_verified = true)::int AS verified,
        (SELECT COUNT(DISTINCT u2.id)::int FROM users u2 WHERE EXISTS (
          SELECT 1 FROM user_api_keys uak JOIN render_jobs rj ON rj.api_key_id = uak.api_key_id
          WHERE uak.user_id = u2.id
        )) AS first_render,
        (SELECT COUNT(DISTINCT s.user_id)::int FROM subscriptions s WHERE s.status = 'active') AS paid
      FROM users
    `),
  ]);

  const { dau, wau, mau } = dauResult.rows[0] ?? { dau: 0, wau: 0, mau: 0 };
  const { total, success, failed } = rateResult.rows[0] ?? { total: 0, success: 0, failed: 0 };
  const { total_users, paid_users } = convResult.rows[0] ?? { total_users: 0, paid_users: 0 };
  const { churned, total_prev } = churnResult.rows[0] ?? { churned: 0, total_prev: 0 };

  return {
    dau: dau ?? 0,
    wau: wau ?? 0,
    mau: mau ?? 0,
    rendersByType: byTypeResult.rows,
    successRate: total > 0 ? Number(((success / total) * 100).toFixed(2)) : 0,
    failureRate: total > 0 ? Number(((failed / total) * 100).toFixed(2)) : 0,
    topApiKeys: topKeysResult.rows,
    conversionRate: total_users > 0 ? Number(((paid_users / total_users) * 100).toFixed(2)) : 0,
    churnRate: total_prev > 0 ? Number(((churned / total_prev) * 100).toFixed(2)) : 0,
    dailyTrend: trendResult.rows,
    tierDistribution: tierResult.rows,
    monthlyRevenue: revenueResult.rows,
    funnel: funnelResult.rows[0] ?? { signups: 0, verified: 0, first_render: 0, paid: 0 },
  };
}
