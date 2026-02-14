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
import { incrementRenderCounter, observeRenderDuration } from '../metrics/index.js';
import { getQueue, type RenderJobData } from '../queue/render-queue.js';
import { getPool } from '../db/index.js';
import { sanitizeUrl, sanitizeSelector, sanitizeWaitFor, sanitizeTemplate, sanitizeCallbackUrl, SanitizeError } from '../security/sanitize.js';
import { sendError } from '../security/errors.js';

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
      sendError(reply, req, 'RATE_LIMITED', {
        details: {
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
        },
      });
      return true;
    }

    const usage = await getUsageStats(req.apiKey.id);
    if (usage.thisMonth >= req.apiKey.monthlyQuota) {
      sendError(reply, req, 'QUOTA_EXCEEDED');
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
        sendError(reply, req, 'VALIDATION_ERROR', { message: e.message });
        return;
      }
      throw e;
    }

    const jobResult = await getPool().query(
      `INSERT INTO render_jobs (api_key_id, type, url, options, callback_url) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [apiKeyId, type, url, JSON.stringify(options), callbackUrl ?? null],
    );
    const jobId = jobResult.rows[0].id;

    const q = getQueue(config.REDIS_URL);
    const jobData: RenderJobData = {
      jobId, apiKeyId, type, options, callbackUrl,
      ...(options.html ? {} : { url }),
    };
    await q.add(`render-${jobId}`, jobData);

    return reply.status(202).send({
      id: jobId,
      status: 'pending',
      pollUrl: `${config.BASE_URL}/v1/render/${jobId}`,
    });
  }

  app.post('/v1/screenshot', {
    schema: {
      tags: ['render'],
      summary: 'Take a screenshot',
      description: 'Capture a screenshot of a URL or HTML content. Returns binary image data (PNG or JPEG).',
      security: [{ apiKey: [] }],
      querystring: {
        type: 'object',
        properties: {
          async: { type: 'string', enum: ['true', 'false'], description: 'Queue as async job' },
        },
      },
      body: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to screenshot' },
          html: { type: 'string', description: 'HTML content to render' },
          format: { type: 'string', enum: ['png', 'jpeg'], default: 'png' },
          viewport: {
            type: 'object',
            properties: {
              width: { type: 'integer', minimum: 1, maximum: 7680, default: 1920 },
              height: { type: 'integer', minimum: 1, maximum: 4320, default: 1080 },
            },
          },
          fullPage: { type: 'boolean', default: false },
          selector: { type: 'string', description: 'CSS selector to capture' },
          clip: {
            type: 'object',
            description: 'Capture specific rectangular region (mutually exclusive with selector)',
            properties: {
              x: { type: 'number', minimum: 0, description: 'X coordinate' },
              y: { type: 'number', minimum: 0, description: 'Y coordinate' },
              width: { type: 'number', minimum: 1, description: 'Width in pixels' },
              height: { type: 'number', minimum: 1, description: 'Height in pixels' },
            },
            required: ['x', 'y', 'width', 'height'],
          },
          waitFor: { type: 'string', description: 'CSS selector to wait for' },
          darkMode: { type: 'boolean', default: false },
          deviceScaleFactor: { type: 'number', minimum: 0.5, maximum: 4, default: 1 },
          quality: { type: 'integer', minimum: 0, maximum: 100 },
          callback_url: { type: 'string', description: 'Webhook callback URL (async only)' },
          block_ads: { type: 'boolean', default: false },
          hide_cookies: { type: 'boolean', default: false },
          custom_css: { type: 'string' },
          custom_js: { type: 'string' },
        },
      },
    },
    preHandler: [authMiddleware],
  }, async (req, reply) => {
    const parsed = screenshotOptionsSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(reply, req, 'VALIDATION_ERROR', { details: parsed.error.issues });
      return;
    }

    const options = parsed.data;

    // Only validate URL and check SSRF if rendering from URL (not HTML)
    if ('url' in options && options.url) {
      try {
        sanitizeUrl(options.url);
        sanitizeSelector(options.selector);
        sanitizeWaitFor(options.waitFor);
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
    } else {
      // Still sanitize selector and waitFor for HTML renders
      try {
        sanitizeSelector(options.selector);
        sanitizeWaitFor(options.waitFor);
      } catch (e) {
        if (e instanceof SanitizeError) {
          sendError(reply, req, 'VALIDATION_ERROR', { message: e.message });
          return;
        }
        throw e;
      }
    }

    const blocked = await checkRateAndQuota(req, reply);
    if (blocked) return;

    const query = req.query as { async?: string };
    if (query.async === 'true') {
      const urlOrHtml = options.url ?? options.html ?? '';
      return enqueueRender(req, reply, 'screenshot', urlOrHtml, options as unknown as Record<string, unknown>);
    }

    const optionsHash = RenderCache.hashOptions(options as unknown as Record<string, unknown>);

    const cached = await cache.get(optionsHash);
    if (cached) {
      const format = cached.contentType.includes('jpeg') ? 'jpeg' : 'png';
      incrementRenderCounter('screenshot', format, 'completed', true);
      const buffer = await cache.readFile(cached.filePath);
      return reply
        .header('Content-Type', cached.contentType)
        .header('X-Cache', 'HIT')
        .header('X-Render-Duration-Ms', '0')
        .send(buffer);
    }

    app.incrementInflightRenders();
    try {
      const result = await takeScreenshot(pool, options, config.NAVIGATION_TIMEOUT_MS);
      const ext = FORMAT_EXT[result.contentType] ?? 'bin';
      await cache.set(optionsHash, result.buffer, result.contentType, ext);

      const format = result.contentType.includes('jpeg') ? 'jpeg' : 'png';
      incrementRenderCounter('screenshot', format, 'completed', false);
      observeRenderDuration('screenshot', format, result.durationMs / 1000);

      return reply
        .header('Content-Type', result.contentType)
        .header('X-Cache', 'MISS')
        .header('X-Render-Duration-Ms', String(result.durationMs))
        .send(result.buffer);
    } finally {
      app.decrementInflightRenders();
    }
  });

  app.post('/v1/pdf', {
    schema: {
      tags: ['render'],
      summary: 'Generate a PDF',
      description: 'Render a URL or HTML content to PDF. Returns binary PDF data.',
      security: [{ apiKey: [] }],
      querystring: {
        type: 'object',
        properties: {
          async: { type: 'string', enum: ['true', 'false'], description: 'Queue as async job' },
        },
      },
      body: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to render' },
          html: { type: 'string', description: 'HTML content to render' },
          format: { type: 'string', enum: ['a4', 'letter', 'legal'], default: 'a4' },
          landscape: { type: 'boolean', default: false },
          margins: {
            type: 'object',
            properties: {
              top: { type: 'string', default: '0' },
              right: { type: 'string', default: '0' },
              bottom: { type: 'string', default: '0' },
              left: { type: 'string', default: '0' },
            },
          },
          printBackground: { type: 'boolean', default: true },
          headerTemplate: { type: 'string' },
          footerTemplate: { type: 'string' },
          scale: { type: 'number', minimum: 0.1, maximum: 2, default: 1 },
          callback_url: { type: 'string', description: 'Webhook callback URL (async only)' },
          block_ads: { type: 'boolean', default: false },
          hide_cookies: { type: 'boolean', default: false },
          custom_css: { type: 'string' },
          custom_js: { type: 'string' },
        },
      },
    },
    preHandler: [authMiddleware],
  }, async (req, reply) => {
    const parsed = pdfOptionsSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(reply, req, 'VALIDATION_ERROR', { details: parsed.error.issues });
      return;
    }

    const options = parsed.data;

    // Only validate URL and check SSRF if rendering from URL (not HTML)
    if ('url' in options && options.url) {
      try {
        sanitizeUrl(options.url);
        sanitizeTemplate(options.headerTemplate);
        sanitizeTemplate(options.footerTemplate);
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
    } else {
      // Still sanitize templates for HTML renders
      try {
        sanitizeTemplate(options.headerTemplate);
        sanitizeTemplate(options.footerTemplate);
      } catch (e) {
        if (e instanceof SanitizeError) {
          sendError(reply, req, 'VALIDATION_ERROR', { message: e.message });
          return;
        }
        throw e;
      }
    }

    const blocked = await checkRateAndQuota(req, reply);
    if (blocked) return;

    const query = req.query as { async?: string };
    if (query.async === 'true') {
      const urlOrHtml = options.url ?? options.html ?? '';
      return enqueueRender(req, reply, 'pdf', urlOrHtml, options as unknown as Record<string, unknown>);
    }

    const optionsHash = RenderCache.hashOptions(options as unknown as Record<string, unknown>);

    const cached = await cache.get(optionsHash);
    if (cached) {
      incrementRenderCounter('pdf', 'pdf', 'completed', true);
      const buffer = await cache.readFile(cached.filePath);
      return reply
        .header('Content-Type', cached.contentType)
        .header('X-Cache', 'HIT')
        .header('X-Render-Duration-Ms', '0')
        .send(buffer);
    }

    app.incrementInflightRenders();
    try {
      const result = await renderPdf(pool, options, config.NAVIGATION_TIMEOUT_MS);
      await cache.set(optionsHash, result.buffer, result.contentType, 'pdf');

      incrementRenderCounter('pdf', 'pdf', 'completed', false);
      observeRenderDuration('pdf', 'pdf', result.durationMs / 1000);

      return reply
        .header('Content-Type', result.contentType)
        .header('X-Cache', 'MISS')
        .header('X-Render-Duration-Ms', String(result.durationMs))
        .send(result.buffer);
    } finally {
      app.decrementInflightRenders();
    }
  });
}
