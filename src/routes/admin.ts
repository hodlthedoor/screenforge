import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminAuthMiddleware } from '../auth/middleware.js';
import { createApiKey, listApiKeys } from '../db/api-keys.js';
import { createError } from '../security/errors.js';
import { getPool } from '../db/index.js';

const analyticsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  tier: z.enum(['free', 'starter', 'pro', 'business']).default('free'),
});

export async function adminRoutes(app: FastifyInstance) {
  app.post('/v1/keys', {
    schema: {
      tags: ['admin'],
      summary: 'Create API key',
      description: 'Create a new API key with the specified name and tier.',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          tier: { type: 'string', enum: ['free', 'starter', 'pro', 'business'], default: 'free' },
        },
      },
    },
    preHandler: [adminAuthMiddleware],
  }, async (req, reply) => {
    const parsed = createKeySchema.safeParse(req.body);
    if (!parsed.success) {
      const err = createError('VALIDATION_ERROR', undefined, { details: parsed.error.issues });
      return reply.status(err.statusCode).send(err);
    }

    const result = await createApiKey(parsed.data.name, parsed.data.tier);
    return reply.status(201).send({
      id: result.key.id,
      key: result.rawKey,
      name: result.key.name,
      tier: result.key.tier,
      rateLimit: result.key.rateLimit,
      monthlyQuota: result.key.monthlyQuota,
    });
  });

  app.get('/v1/keys', {
    schema: {
      tags: ['admin'],
      summary: 'List API keys',
      description: 'List all API keys.',
      security: [{ apiKey: [] }],
    },
    preHandler: [adminAuthMiddleware],
  }, async (_req, reply) => {
    const keys = await listApiKeys();
    return reply.send({ keys });
  });

  app.get<{ Querystring: { from?: string; to?: string } }>('/v1/admin/analytics', {
    schema: {
      tags: ['admin'],
      summary: 'Business analytics dashboard data',
      description: 'Returns business metrics: DAU/WAU/MAU, renders by type, success/failure rates, top API keys, conversion rate, monthly revenue trend, churn rate.',
      security: [{ apiKey: [] }],
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Start date (YYYY-MM-DD, inclusive)' },
          to: { type: 'string', description: 'End date (YYYY-MM-DD, inclusive)' },
        },
      },
    },
    preHandler: [adminAuthMiddleware],
  }, async (req, reply) => {
    const parsed = analyticsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const err = createError('VALIDATION_ERROR', undefined, { details: parsed.error.issues });
      return reply.status(err.statusCode).send(err);
    }

    const pool = getPool();
    const { from, to } = parsed.data;

    // Build date conditions for render_jobs (using table alias rj for JOIN compatibility)
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (from) {
      params.push(from);
      conditions.push(`rj.created_at >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      conditions.push(`rj.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    // WHERE clauses: one using alias (for JOIN queries), one without (for single-table queries)
    const whereAlias = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const whereSimple = conditions.length > 0
      ? `WHERE ${conditions.map((c) => c.replace(/rj\./g, '')).join(' AND ')}`
      : '';

    // DAU / WAU / MAU
    const dauResult = await pool.query<{ dau: number; wau: number; mau: number }>(`
      SELECT
        COUNT(DISTINCT api_key_id) FILTER (WHERE created_at >= CURRENT_DATE)::int AS dau,
        COUNT(DISTINCT api_key_id) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')::int AS wau,
        COUNT(DISTINCT api_key_id) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')::int AS mau
      FROM render_jobs
      ${whereSimple}
    `, params);
    const { dau, wau, mau } = dauResult.rows[0] ?? { dau: 0, wau: 0, mau: 0 };

    // Renders by type
    const byTypeResult = await pool.query<{ type: string; count: number }>(`
      SELECT type, COUNT(*)::int AS count
      FROM render_jobs
      ${whereSimple}
      GROUP BY type
      ORDER BY count DESC
    `, params);

    // Success / failure rates
    const rateResult = await pool.query<{ total: number; success: number; failed: number }>(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS success,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM render_jobs
      ${whereSimple}
    `, params);
    const { total, success, failed } = rateResult.rows[0] ?? { total: 0, success: 0, failed: 0 };
    const successRate = total > 0 ? Number(((success / total) * 100).toFixed(2)) : 0;
    const failureRate = total > 0 ? Number(((failed / total) * 100).toFixed(2)) : 0;

    // Top 10 API keys by usage
    const topKeysResult = await pool.query<{ name: string; count: number }>(`
      SELECT ak.name, COUNT(rj.id)::int AS count
      FROM render_jobs rj
      JOIN api_keys ak ON ak.id = rj.api_key_id
      ${whereAlias}
      GROUP BY ak.id, ak.name
      ORDER BY count DESC
      LIMIT 10
    `, params);

    // Free-to-paid conversion rate
    const convResult = await pool.query<{ total_users: number; paid_users: number }>(`
      SELECT
        COUNT(DISTINCT u.id)::int AS total_users,
        COUNT(DISTINCT s.user_id)::int AS paid_users
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
    `);
    const { total_users, paid_users } = convResult.rows[0] ?? { total_users: 0, paid_users: 0 };
    const conversionRate = total_users > 0 ? Number(((paid_users / total_users) * 100).toFixed(2)) : 0;

    // Monthly revenue trend (last 12 months)
    const revenueResult = await pool.query<{ month: string; paid_count: number }>(`
      SELECT
        date_trunc('month', created_at)::date::text AS month,
        COUNT(DISTINCT user_id)::int AS paid_count
      FROM subscriptions
      WHERE status = 'active'
        AND created_at >= NOW() - INTERVAL '12 months'
      GROUP BY 1
      ORDER BY 1
    `);

    // Churn rate: users who had renders 30+ days ago but none in the last 30 days
    const churnResult = await pool.query<{ churned: number; total_prev: number }>(`
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
    `);
    const { churned, total_prev } = churnResult.rows[0] ?? { churned: 0, total_prev: 0 };
    const churnRate = total_prev > 0 ? Number(((churned / total_prev) * 100).toFixed(2)) : 0;

    // Daily trend (last 30 days or within date range)
    let trendWhere = whereSimple;
    if (!from && !to) {
      trendWhere = `WHERE created_at >= NOW() - INTERVAL '30 days'`;
    }
    const trendResult = await pool.query<{ date: string; count: number }>(`
      SELECT created_at::date::text AS date, COUNT(*)::int AS count
      FROM render_jobs
      ${trendWhere}
      GROUP BY 1
      ORDER BY 1
    `, params);

    // Tier distribution from api_keys
    const tierResult = await pool.query<{ tier: string; count: number }>(`
      SELECT tier, COUNT(*)::int AS count
      FROM api_keys
      WHERE active = true
      GROUP BY tier
      ORDER BY tier
    `);

    return reply.send({
      dau: dau ?? 0,
      wau: wau ?? 0,
      mau: mau ?? 0,
      rendersByType: byTypeResult.rows,
      successRate,
      failureRate,
      topApiKeys: topKeysResult.rows,
      conversionRate,
      monthlyRevenue: revenueResult.rows,
      churnRate,
      dailyTrend: trendResult.rows,
      tierDistribution: tierResult.rows,
    });
  });

  app.get<{ Querystring: { since?: string; until?: string } }>('/v1/admin/ab-stats', {
    schema: {
      tags: ['admin'],
      summary: 'A/B test conversion stats',
      description: 'Returns view and signup counts per variant with conversion rates. Optional since/until ISO date filters.',
      security: [{ apiKey: [] }],
      querystring: {
        type: 'object',
        properties: {
          since: { type: 'string', description: 'ISO date lower bound (inclusive)' },
          until: { type: 'string', description: 'ISO date upper bound (exclusive)' },
        },
      },
    },
    preHandler: [adminAuthMiddleware],
  }, async (req, reply) => {
    const pool = getPool();
    const conditions: string[] = [];
    const params: string[] = [];

    if (req.query.since) {
      params.push(req.query.since);
      conditions.push(`created_at >= $${params.length}::timestamptz`);
    }
    if (req.query.until) {
      params.push(req.query.until);
      conditions.push(`created_at < $${params.length}::timestamptz`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query<{
      variant: string;
      views: number;
      signups: number;
    }>(`
      SELECT
        variant,
        COUNT(*) FILTER (WHERE event_type = 'view')::int AS views,
        COUNT(*) FILTER (WHERE event_type = 'signup')::int AS signups
      FROM ab_test_events
      ${whereClause}
      GROUP BY variant
      ORDER BY variant
    `, params);

    const variants = result.rows.map((row) => ({
      variant: row.variant,
      views: row.views,
      signups: row.signups,
      conversion_rate: row.views > 0 ? Number(((row.signups / row.views) * 100).toFixed(2)) : 0,
    }));

    return reply.send({ variants });
  });
}
