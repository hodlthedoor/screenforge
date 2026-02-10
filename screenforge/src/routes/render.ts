import type { FastifyInstance } from 'fastify';
import { screenshotOptionsSchema, pdfOptionsSchema, isPrivateUrl } from '../renderer/schemas.js';
import { takeScreenshot } from '../renderer/screenshot.js';
import { renderPdf } from '../renderer/pdf.js';
import type { BrowserPool } from '../renderer/browser-pool.js';
import { RenderCache } from '../cache/index.js';
import { getConfig } from '../config/index.js';
import { authMiddleware } from '../auth/middleware.js';
import { incrementUsage, getUsageStats } from '../db/api-keys.js';
import type { SlidingWindowRateLimiter } from '../auth/rate-limiter.js';
import { getQueue, type RenderJobData } from '../queue/render-queue.js';
import { getPool } from '../db/index.js';
import { sanitizeUrl, sanitizeSelector, sanitizeWaitFor, sanitizeTemplate, sanitizeCallbackUrl, SanitizeError } from '../security/sanitize.js';
import { createError } from '../security/errors.js';

const FORMAT_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
};

export async function renderRoutes(
  app: FastifyInstance,
  pool: BrowserPool,
  cache: RenderCache,
  rateLimiter?: SlidingWindowRateLimiter,
) {
  const config = getConfig();

  async function checkRateAndQuota(req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): Promise<boolean> {
    if (!config.REQUIRE_AUTH || !req.apiKey || !rateLimiter) return false;

    const result = await rateLimiter.check(req.apiKey.id, req.apiKey.rateLimit);
    reply.header('X-RateLimit-Limit', String(result.limit));
    reply.header('X-RateLimit-Remaining', String(result.remaining));
    reply.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      const err = createError('RATE_LIMITED', undefined, {
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
      reply.status(err.statusCode).send(err);
      return true;
    }

    const usage = await getUsageStats(req.apiKey.id);
    if (usage.thisMonth >= req.apiKey.monthlyQuota) {
      const err = createError('QUOTA_EXCEEDED');
      reply.status(err.statusCode).send(err);
      return true;
    }

    await incrementUsage(req.apiKey.id);
    return false;
  }

  async function enqueueRender(
    req: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
    type: 'screenshot' | 'pdf',
    url: string,
    options: Record<string, unknown>,
  ) {
    const apiKeyId = req.apiKey?.id ?? null;
    const body = req.body as Record<string, unknown>;
    const callbackUrl = typeof body.callback_url === 'string' ? body.callback_url : undefined;

    try {
      sanitizeCallbackUrl(callbackUrl);
    } catch (e) {
      if (e instanceof SanitizeError) {
        const err = createError('VALIDATION_ERROR', e.message);
        return reply.status(err.statusCode).send(err);
      }
    }

    const jobResult = await getPool().query(
      `INSERT INTO render_jobs (api_key_id, type, url, options, callback_url) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [apiKeyId, type, url, JSON.stringify(options), callbackUrl ?? null],
    );
    const jobId = jobResult.rows[0].id;

    const q = getQueue(config.REDIS_URL);
    const jobData: RenderJobData = { jobId, apiKeyId, type, url, options, callbackUrl };
    await q.add(`render-${jobId}`, jobData);

    return reply.status(202).send({
      id: jobId,
      status: 'pending',
      pollUrl: `${config.BASE_URL}/v1/render/${jobId}`,
    });
  }

  app.post('/v1/screenshot', { preHandler: [authMiddleware] }, async (req, reply) => {
    const parsed = screenshotOptionsSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = createError('VALIDATION_ERROR', undefined, { details: parsed.error.issues });
      return reply.status(err.statusCode).send(err);
    }

    const options = parsed.data;

    try {
      sanitizeUrl(options.url);
      sanitizeSelector(options.selector);
      sanitizeWaitFor(options.waitFor);
    } catch (e) {
      if (e instanceof SanitizeError) {
        const err = createError('VALIDATION_ERROR', e.message);
        return reply.status(err.statusCode).send(err);
      }
      throw e;
    }

    if (!config.ALLOW_PRIVATE_URLS && isPrivateUrl(options.url)) {
      const err = createError('SSRF_BLOCKED');
      return reply.status(err.statusCode).send(err);
    }

    const blocked = await checkRateAndQuota(req, reply);
    if (blocked) return;

    const query = req.query as { async?: string };
    if (query.async === 'true') {
      return enqueueRender(req, reply, 'screenshot', options.url, options as unknown as Record<string, unknown>);
    }

    const optionsHash = RenderCache.hashOptions(options as unknown as Record<string, unknown>);

    const cached = await cache.get(optionsHash);
    if (cached) {
      const buffer = await cache.readFile(cached.filePath);
      return reply
        .header('Content-Type', cached.contentType)
        .header('X-Cache', 'HIT')
        .header('X-Render-Duration-Ms', '0')
        .send(buffer);
    }

    const result = await takeScreenshot(pool, options, config.NAVIGATION_TIMEOUT_MS);
    const ext = FORMAT_EXT[result.contentType] ?? 'bin';
    await cache.set(optionsHash, result.buffer, result.contentType, ext);

    return reply
      .header('Content-Type', result.contentType)
      .header('X-Cache', 'MISS')
      .header('X-Render-Duration-Ms', String(result.durationMs))
      .send(result.buffer);
  });

  app.post('/v1/pdf', { preHandler: [authMiddleware] }, async (req, reply) => {
    const parsed = pdfOptionsSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = createError('VALIDATION_ERROR', undefined, { details: parsed.error.issues });
      return reply.status(err.statusCode).send(err);
    }

    const options = parsed.data;

    try {
      sanitizeUrl(options.url);
      sanitizeTemplate(options.headerTemplate);
      sanitizeTemplate(options.footerTemplate);
    } catch (e) {
      if (e instanceof SanitizeError) {
        const err = createError('VALIDATION_ERROR', e.message);
        return reply.status(err.statusCode).send(err);
      }
      throw e;
    }

    if (!config.ALLOW_PRIVATE_URLS && isPrivateUrl(options.url)) {
      const err = createError('SSRF_BLOCKED');
      return reply.status(err.statusCode).send(err);
    }

    const blocked = await checkRateAndQuota(req, reply);
    if (blocked) return;

    const query = req.query as { async?: string };
    if (query.async === 'true') {
      return enqueueRender(req, reply, 'pdf', options.url, options as unknown as Record<string, unknown>);
    }

    const optionsHash = RenderCache.hashOptions(options as unknown as Record<string, unknown>);

    const cached = await cache.get(optionsHash);
    if (cached) {
      const buffer = await cache.readFile(cached.filePath);
      return reply
        .header('Content-Type', cached.contentType)
        .header('X-Cache', 'HIT')
        .header('X-Render-Duration-Ms', '0')
        .send(buffer);
    }

    const result = await renderPdf(pool, options, config.NAVIGATION_TIMEOUT_MS);
    await cache.set(optionsHash, result.buffer, result.contentType, 'pdf');

    return reply
      .header('Content-Type', result.contentType)
      .header('X-Cache', 'MISS')
      .header('X-Render-Duration-Ms', String(result.durationMs))
      .send(result.buffer);
  });
}
