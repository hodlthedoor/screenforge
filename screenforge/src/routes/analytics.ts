import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/middleware.js';
import { getPool } from '../db/index.js';
import { getUsageStats } from '../db/api-keys.js';
import { getConfig } from '../config/index.js';
import { createError } from '../security/errors.js';

interface AnalyticsData {
  daily: Array<{ date: string; count: number; avgDurationMs: number }>;
  typeBreakdown: Array<{ type: string; count: number }>;
  topUrls: Array<{ url: string; count: number; avgDurationMs: number }>;
  summary: {
    totalRendersThisMonth: number;
    avgDurationMs: number;
    quotaUsagePercent: number;
  };
}

async function getAnalyticsForApiKey(apiKeyId: string, monthlyQuota: number): Promise<AnalyticsData> {
  const pool = getPool();

  // Daily renders (last 30 days) with avg duration
  const dailyResult = await pool.query(
    `SELECT date_trunc('day', created_at)::date AS date,
            COUNT(*)::int AS count,
            COALESCE(AVG(duration_ms)::int, 0) AS avg_duration_ms
     FROM render_jobs
     WHERE api_key_id = $1
       AND created_at >= CURRENT_DATE - INTERVAL '30 days'
     GROUP BY 1
     ORDER BY 1`,
    [apiKeyId],
  );

  // Type breakdown (this month)
  const typeResult = await pool.query(
    `SELECT type, COUNT(*)::int AS count
     FROM render_jobs
     WHERE api_key_id = $1
       AND created_at >= date_trunc('month', CURRENT_DATE)
     GROUP BY type
     ORDER BY count DESC`,
    [apiKeyId],
  );

  // Top 10 URLs
  const topUrlsResult = await pool.query(
    `SELECT url, COUNT(*)::int AS count,
            COALESCE(AVG(duration_ms)::int, 0) AS avg_duration_ms
     FROM render_jobs
     WHERE api_key_id = $1
       AND created_at >= date_trunc('month', CURRENT_DATE)
     GROUP BY url
     ORDER BY count DESC
     LIMIT 10`,
    [apiKeyId],
  );

  // Summary
  const summaryResult = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COALESCE(AVG(duration_ms)::int, 0) AS avg_duration_ms
     FROM render_jobs
     WHERE api_key_id = $1
       AND created_at >= date_trunc('month', CURRENT_DATE)`,
    [apiKeyId],
  );

  const total = summaryResult.rows[0]?.total ?? 0;
  const avgDuration = summaryResult.rows[0]?.avg_duration_ms ?? 0;

  return {
    daily: dailyResult.rows.map((r: { date: string; count: number; avg_duration_ms: number }) => ({
      date: r.date,
      count: r.count,
      avgDurationMs: r.avg_duration_ms,
    })),
    typeBreakdown: typeResult.rows.map((r: { type: string; count: number }) => ({
      type: r.type,
      count: r.count,
    })),
    topUrls: topUrlsResult.rows.map((r: { url: string; count: number; avg_duration_ms: number }) => ({
      url: r.url,
      count: r.count,
      avgDurationMs: r.avg_duration_ms,
    })),
    summary: {
      totalRendersThisMonth: total,
      avgDurationMs: avgDuration,
      quotaUsagePercent: monthlyQuota > 0 ? Math.round((total / monthlyQuota) * 10000) / 100 : 0,
    },
  };
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  // API endpoint (API key auth)
  app.get('/v1/analytics', {
    preHandler: [authMiddleware],
  }, async (req, reply) => {
    const config = getConfig();

    if (!config.REQUIRE_AUTH || !req.apiKey) {
      const err = createError('AUTH_REQUIRED', 'Auth must be enabled to view analytics');
      return reply.status(err.statusCode).send(err);
    }

    const data = await getAnalyticsForApiKey(req.apiKey.id, req.apiKey.monthlyQuota);
    return reply.send(data);
  });
}
