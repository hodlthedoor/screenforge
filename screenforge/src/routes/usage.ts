import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/middleware.js';
import { getUsageStats } from '../db/api-keys.js';
import { getConfig } from '../config/index.js';

export async function usageRoutes(app: FastifyInstance) {
  app.get('/v1/usage', { preHandler: [authMiddleware] }, async (req, reply) => {
    const config = getConfig();

    if (!config.REQUIRE_AUTH || !req.apiKey) {
      return reply.status(400).send({
        error: 'Auth must be enabled to view usage',
        code: 'AUTH_REQUIRED',
        statusCode: 400,
      });
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
