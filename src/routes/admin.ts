import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminAuthMiddleware } from '../auth/middleware.js';
import { createApiKey, listApiKeys } from '../db/api-keys.js';
import { createError } from '../security/errors.js';

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
}
