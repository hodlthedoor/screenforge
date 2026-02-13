import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/middleware.js';
import { getUsageStats } from '../db/api-keys.js';
import { getConfig } from '../config/index.js';
import { createError } from '../security/errors.js';

export async function usageRoutes(app: FastifyInstance) {
  app.get('/v1/usage', {
    schema: {
      tags: ['usage'],
      summary: 'Get usage stats',
      description: 'Get usage statistics for the authenticated API key.',
      security: [{ apiKey: [] }],
    },
    preHandler: [authMiddleware],
  }, async (req, reply) => {
    const config = getConfig();

    if (!config.REQUIRE_AUTH || !req.apiKey) {
      const err = createError('AUTH_REQUIRED', 'Auth must be enabled to view usage');
      return reply.status(err.statusCode).send(err);
    }

    const stats = await getUsageStats(req.apiKey.id);
    return reply.send({
      apiKeyId: req.apiKey.id,
      tier: req.apiKey.tier,
      usage: {
        today: stats.today,
        thisMonth: stats.thisMonth,
        monthlyQuota: req.apiKey.monthlyQuota,
        remaining: Math.max(0, req.apiKey.monthlyQuota - stats.thisMonth),
      },
      rateLimit: {
        requestsPerMinute: req.apiKey.rateLimit,
      },
    });
  });
}
