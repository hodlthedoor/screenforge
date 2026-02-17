import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminAuthMiddleware } from '../auth/middleware.js';
import { createApiKey, listApiKeys } from '../db/api-keys.js';
import { createError } from '../security/errors.js';
import { getPool } from '../db/index.js';

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

  app.get('/v1/admin/ab-stats', {
    schema: {
      tags: ['admin'],
      summary: 'A/B test conversion stats',
      description: 'Returns view and signup counts per variant with conversion rates.',
      security: [{ apiKey: [] }],
    },
    preHandler: [adminAuthMiddleware],
  }, async (_req, reply) => {
    const pool = getPool();
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
      GROUP BY variant
      ORDER BY variant
    `);

    const variants = result.rows.map((row) => ({
      variant: row.variant,
      views: row.views,
      signups: row.signups,
      conversion_rate: row.views > 0 ? Number(((row.signups / row.views) * 100).toFixed(2)) : 0,
    }));

    return reply.send({ variants });
  });
}
