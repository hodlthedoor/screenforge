import type { FastifyInstance } from 'fastify';
import { gifOptionsSchema, isPrivateUrl } from '../renderer/schemas.js';
import { captureGif } from '../renderer/gif.js';
import type { BrowserPool } from '../renderer/browser-pool.js';
import { RenderCache } from '../cache/index.js';
import { getConfig } from '../config/index.js';
import { authMiddleware } from '../auth/middleware.js';
import { incrementUsage, getUsageStats } from '../db/api-keys.js';
import type { SlidingWindowRateLimiter } from '../auth/rate-limiter.js';
import { incrementRenderCounter, observeRenderDuration } from '../metrics/index.js';
import { getQueue, type RenderJobData } from '../queue/render-queue.js';
import { getPool } from '../db/index.js';
import { sanitizeUrl, sanitizeWaitFor, sanitizeCallbackUrl, sanitizeHeaders, sanitizeCookies, sanitizeSelectorList, SanitizeError } from '../security/sanitize.js';
import { sendError } from '../security/errors.js';

export async function gifRoutes(
  app: FastifyInstance,
  pool: BrowserPool,
  cache: RenderCache,
  rateLimiter?: SlidingWindowRateLimiter,
) {
  const config = getConfig();

  app.post('/v1/gif', {
    schema: {
      tags: ['render'],
      summary: 'Record an animated GIF',
      description: 'Capture a short animated GIF of a web page by recording sequential frames. Returns binary GIF data.',
      security: [{ apiKey: [] }],
      querystring: {
        type: 'object',
        properties: {
          async: { type: 'string', enum: ['true', 'false'], description: 'Queue as async job' },
        },
      },
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', description: 'URL to record' },
          width: { type: 'integer', minimum: 1, maximum: 1280, default: 1280, description: 'GIF width in pixels (max 1280)' },
          height: { type: 'integer', minimum: 1, maximum: 720, default: 720, description: 'GIF height in pixels (max 720)' },
          duration: { type: 'number', minimum: 0.1, maximum: 10, default: 3, description: 'Recording duration in seconds (max 10)' },
          fps: { type: 'integer', minimum: 1, maximum: 30, default: 10, description: 'Frames per second (max 30)' },
          darkMode: { type: 'boolean', default: false },
          deviceScaleFactor: { type: 'number', minimum: 0.5, maximum: 4, default: 1 },
          delay: { type: 'integer', minimum: 0, maximum: 30000, default: 0, description: 'Milliseconds to wait before recording starts' },
          actions: {
            type: 'array',
            maxItems: 10,
            description: 'Interaction actions to execute before/during recording',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['click', 'scroll', 'type', 'hover', 'wait'] },
                selector: { type: 'string' },
                value: { type: 'string' },
                x: { type: 'number' },
                y: { type: 'number' },
              },
              required: ['type'],
            },
          },
          callback_url: { type: 'string', description: 'Webhook callback URL (async only)' },
          block_ads: { type: 'boolean', default: false },
          hide_cookies: { type: 'boolean', default: false },
          block_resources: {
            type: 'array',
            items: { type: 'string', enum: ['image', 'stylesheet', 'font', 'script', 'media', 'other'] },
            maxItems: 6,
            default: [],
          },
          hide_selectors: { type: 'array', items: { type: 'string' }, maxItems: 20 },
          remove_selectors: { type: 'array', items: { type: 'string' }, maxItems: 20 },
          custom_css: { type: 'string' },
          custom_js: { type: 'string' },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          cookies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                value: { type: 'string' },
                domain: { type: 'string' },
                path: { type: 'string' },
              },
              required: ['name', 'value'],
            },
          },
          geolocation: {
            type: 'object',
            properties: {
              latitude: { type: 'number', minimum: -90, maximum: 90 },
              longitude: { type: 'number', minimum: -180, maximum: 180 },
              accuracy: { type: 'number', minimum: 0 },
            },
            required: ['latitude', 'longitude'],
          },
          timezone: { type: 'string' },
          locale: { type: 'string', pattern: '^[a-z]{2}(-[A-Z]{2})?$' },
          proxy: {
            type: 'object',
            properties: {
              server: { type: 'string' },
              username: { type: 'string' },
              password: { type: 'string' },
            },
            required: ['server'],
          },
          waitFor: { type: 'string' },
          wait: { type: 'object' },
        },
      },
    },
    preHandler: [authMiddleware],
  }, async (req, reply) => {
    const parsed = gifOptionsSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(reply, req, 'VALIDATION_ERROR', { details: parsed.error.issues });
      return;
    }

    const options = parsed.data;

    // Sanitize inputs
    try {
      options.headers = sanitizeHeaders(options.headers);
      options.cookies = sanitizeCookies(options.cookies);
    } catch (e) {
      if (e instanceof SanitizeError) {
        sendError(reply, req, 'VALIDATION_ERROR', { message: e.message });
        return;
      }
      throw e;
    }

    try {
      sanitizeWaitFor(options.waitFor);
      sanitizeSelectorList(options.hide_selectors, 'hide_selectors');
      sanitizeSelectorList(options.remove_selectors, 'remove_selectors');
      sanitizeSelectorList(options.blur_selectors, 'blur_selectors');
    } catch (e) {
      if (e instanceof SanitizeError) {
        sendError(reply, req, 'VALIDATION_ERROR', { message: e.message });
        return;
      }
      throw e;
    }

    // SSRF protection
    try {
      sanitizeUrl(options.url);
    } catch (e) {
      if (e instanceof SanitizeError) {
        sendError(reply, req, 'VALIDATION_ERROR', { message: e.message });
        return;
      }
      throw e;
    }

    if (!config.ALLOW_PRIVATE_URLS && isPrivateUrl(options.url)) {
      sendError(reply, req, 'SSRF_BLOCKED');
      return;
    }

    // Rate limiting
    if (config.REQUIRE_AUTH && req.apiKey && rateLimiter) {
      const result = await rateLimiter.check(req.apiKey.id, req.apiKey.rateLimit);
      reply.header('X-RateLimit-Limit', String(result.limit));
      reply.header('X-RateLimit-Remaining', String(result.remaining));
      reply.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

      if (!result.allowed) {
        sendError(reply, req, 'RATE_LIMITED', {
          details: { retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000) },
        });
        return;
      }

      const usage = await getUsageStats(req.apiKey.id);
      if (usage.thisMonth >= req.apiKey.monthlyQuota) {
        sendError(reply, req, 'QUOTA_EXCEEDED');
        return;
      }

      await incrementUsage(req.apiKey.id);
    }

    // Async mode
    const query = req.query as { async?: string };
    if (query.async === 'true') {
      const body = req.body as Record<string, unknown>;
      const callbackUrl = typeof body.callback_url === 'string' ? body.callback_url : undefined;

      try {
        sanitizeCallbackUrl(callbackUrl);
      } catch (e) {
        if (e instanceof SanitizeError) {
          sendError(reply, req, 'VALIDATION_ERROR', { message: e.message });
          return;
        }
        throw e;
      }

      const apiKeyId = req.apiKey?.id ?? null;
      const dbPool = getPool();
      const jobResult = await dbPool.query(
        `INSERT INTO render_jobs (api_key_id, type, url, options, callback_url) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [apiKeyId, 'gif', options.url, JSON.stringify(options), callbackUrl ?? null],
      );
      const jobId = jobResult.rows[0].id;

      const q = getQueue(config.REDIS_URL);
      const jobData: RenderJobData = {
        jobId, apiKeyId, type: 'gif', url: options.url,
        options: options as unknown as Record<string, unknown>,
        callbackUrl,
      };
      await q.add(`render-${jobId}`, jobData);

      return reply.status(202).send({
        id: jobId,
        status: 'pending',
        pollUrl: `${config.BASE_URL}/v1/render/${jobId}`,
      });
    }

    // Sync mode — capture GIF directly
    app.incrementInflightRenders();
    try {
      const result = await captureGif(pool, options, config.NAVIGATION_TIMEOUT_MS);

      incrementRenderCounter('gif', 'gif', 'completed', false);
      observeRenderDuration('gif', 'gif', result.durationMs / 1000);

      return reply
        .header('Content-Type', 'image/gif')
        .header('Content-Length', String(result.buffer.length))
        .header('X-Render-Duration-Ms', String(result.durationMs))
        .send(result.buffer);
    } finally {
      app.decrementInflightRenders();
    }
  });
}
