import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminAuthMiddleware } from '../auth/middleware.js';
import { createApiKey, listApiKeys } from '../db/api-keys.js';
import { createError } from '../security/errors.js';
import { getPool } from '../db/index.js';
import { getAnalyticsMetrics } from '../db/analytics.js';

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

    const metrics = await getAnalyticsMetrics(parsed.data);

    return reply.send({
      dau: metrics.dau,
      wau: metrics.wau,
      mau: metrics.mau,
      rendersByType: metrics.rendersByType,
      successRate: metrics.successRate,
      failureRate: metrics.failureRate,
      topApiKeys: metrics.topApiKeys,
      conversionRate: metrics.conversionRate,
      monthlyRevenue: metrics.monthlyRevenue,
      churnRate: metrics.churnRate,
      dailyTrend: metrics.dailyTrend,
      tierDistribution: metrics.tierDistribution,
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
