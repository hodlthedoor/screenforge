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
import { sanitizeUrl, sanitizeSelector, sanitizeWaitFor, sanitizeTemplate, sanitizeCallbackUrl, sanitizeHeaders, sanitizeCookies, SanitizeError } from '../security/sanitize.js';
import { sendError } from '../security/errors.js';
import type { RenderMetadata } from '../renderer/schemas.js';

const FORMAT_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
};

function sendMetadataEnvelope(
  reply: import('fastify').FastifyReply,
  buffer: Buffer,
  contentType: string,
  durationMs: number,
  cacheStatus: 'HIT' | 'MISS',
  metadata: RenderMetadata | null,
) {
  return reply
    .header('Content-Type', 'application/json')
    .header('X-Cache', cacheStatus)
    .send({
      data: buffer.toString('base64'),
      contentType,
      durationMs,
      metadata,
    });
}

function sendBinaryResponse(
  reply: import('fastify').FastifyReply,
  buffer: Buffer,
  contentType: string,
  durationMs: number,
  cacheStatus: 'HIT' | 'MISS',
) {
  return reply
    .header('Content-Type', contentType)
    .header('X-Cache', cacheStatus)
    .header('X-Render-Duration-Ms', String(durationMs))
    .send(buffer);
}

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
          metadata: { type: 'string', enum: ['true', 'false'], description: 'Return JSON envelope with metadata' },
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
          waitFor: { type: 'string', description: 'CSS selector to wait for (legacy - use wait for new features)' },
          wait: {
            type: 'object',
            description: 'Advanced wait strategy after navigation. Use this instead of waitFor for flexible waiting.',
            oneOf: [
              {
                type: 'object',
                properties: { type: { type: 'string', enum: ['networkidle'] } },
                required: ['type'],
                description: 'Wait for network to be idle (no requests for 500ms)',
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['delay'] },
                  value: { type: 'integer', minimum: 0, maximum: 30000, description: 'Delay in milliseconds' },
                },
                required: ['type', 'value'],
                description: 'Wait for a fixed delay',
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['selector'] },
                  value: { type: 'string', description: 'CSS selector' },
                },
                required: ['type', 'value'],
                description: 'Wait for CSS selector to appear',
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['function'] },
                  value: { type: 'string', description: 'JavaScript expression returning truthy when ready' },
                },
                required: ['type', 'value'],
                description: 'Wait for custom JavaScript expression to return truthy',
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['hidden'] },
                  value: { type: 'string', description: 'CSS selector that must disappear' },
                },
                required: ['type', 'value'],
                description: 'Wait for element to disappear (e.g., loading spinner)',
              },
            ],
          },
          darkMode: { type: 'boolean', default: false },
          deviceScaleFactor: { type: 'number', minimum: 0.5, maximum: 4, default: 1 },
          device: { type: 'string', description: 'Device preset ID (e.g., iphone-15-pro, desktop-4k). Overrides viewport, deviceScaleFactor, and userAgent. See GET /v1/devices for available presets.' },
          userAgent: { type: 'string', description: 'Custom user agent string' },
          quality: { type: 'integer', minimum: 0, maximum: 100 },
          callback_url: { type: 'string', description: 'Webhook callback URL (async only)' },
          block_ads: { type: 'boolean', default: false },
          hide_cookies: { type: 'boolean', default: false },
          block_resources: {
            type: 'array',
            items: { type: 'string', enum: ['image', 'stylesheet', 'font', 'script', 'media', 'other'] },
            maxItems: 6,
            default: [],
            description: 'Resource types to block during page load for faster captures and reduced bandwidth'
          },
          custom_css: { type: 'string' },
          custom_js: { type: 'string' },
          headers: {
            type: 'object',
            description: 'Custom HTTP headers to send with the request',
            additionalProperties: { type: 'string' },
          },
          cookies: {
            type: 'array',
            description: 'Custom cookies to set before rendering',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Cookie name' },
                value: { type: 'string', description: 'Cookie value' },
                domain: { type: 'string', description: 'Cookie domain (optional)' },
                path: { type: 'string', description: 'Cookie path (optional)' },
              },
              required: ['name', 'value'],
            },
          },
          geolocation: {
            type: 'object',
            description: 'Geolocation to emulate',
            properties: {
              latitude: { type: 'number', minimum: -90, maximum: 90, description: 'Latitude' },
              longitude: { type: 'number', minimum: -180, maximum: 180, description: 'Longitude' },
              accuracy: { type: 'number', minimum: 0, description: 'Accuracy in meters (optional)' },
            },
            required: ['latitude', 'longitude'],
          },
          timezone: {
            type: 'string',
            description: 'IANA timezone identifier (e.g., "America/New_York", "Europe/London")',
          },
          locale: {
            type: 'string',
            description: 'Locale to emulate (e.g., "en-US", "fr-FR")',
            pattern: '^[a-z]{2}(-[A-Z]{2})?$',
          },
          proxy: {
            type: 'object',
            description: 'HTTP/SOCKS proxy configuration for this request. Overrides global PROXY_SERVER env var.',
            properties: {
              server: { type: 'string', description: 'Proxy server URL (http://, https://, socks4://, or socks5://)' },
              username: { type: 'string', description: 'Proxy authentication username (optional)' },
              password: { type: 'string', description: 'Proxy authentication password (optional)' },
            },
            required: ['server'],
          },
          cache_ttl: {
            type: 'integer',
            minimum: 0,
            maximum: 2592000,
            description: 'Cache duration in seconds (0-2592000). 0 = bypass cache entirely, default = server config (3600s). Max 30 days.',
          },
          cache_key: {
            type: 'string',
            maxLength: 128,
            description: 'Custom cache key suffix for different cache entries with same URL. Useful for caching different JS states.',
          },
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

    // Sanitize custom headers and cookies (use sanitized values)
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

    const query = req.query as { async?: string; metadata?: string };
    if (query.async === 'true') {
      const urlOrHtml = options.url ?? options.html ?? '';
      return enqueueRender(req, reply, 'screenshot', urlOrHtml, options as unknown as Record<string, unknown>);
    }

    const wantsMetadata = query.metadata === 'true';
    const cacheTtl = options.cache_ttl;
    const optionsHash = RenderCache.hashOptions(options as unknown as Record<string, unknown>);

    // If cache_ttl=0, bypass cache entirely (skip read and write)
    if (cacheTtl === 0) {
      app.incrementInflightRenders();
      try {
        const result = await takeScreenshot(pool, options, config.NAVIGATION_TIMEOUT_MS);

        const format = result.contentType.includes('jpeg') ? 'jpeg' : 'png';
        incrementRenderCounter('screenshot', format, 'completed', false);
        observeRenderDuration('screenshot', format, result.durationMs / 1000);

        if (wantsMetadata) {
          return sendMetadataEnvelope(reply, result.buffer, result.contentType, result.durationMs, 'MISS', result.metadata ?? null);
        }
        return sendBinaryResponse(reply, result.buffer, result.contentType, result.durationMs, 'MISS');
      } finally {
        app.decrementInflightRenders();
      }
    }

    // Normal cache flow (cache_ttl is undefined or > 0)
    const cached = await cache.get(optionsHash);
    if (cached) {
      const format = cached.contentType.includes('jpeg') ? 'jpeg' : 'png';
      incrementRenderCounter('screenshot', format, 'completed', true);
      const buffer = await cache.readFile(cached.filePath);

      if (wantsMetadata) {
        return sendMetadataEnvelope(reply, buffer, cached.contentType, 0, 'HIT', cached.metadata ?? null);
      }
      return sendBinaryResponse(reply, buffer, cached.contentType, 0, 'HIT');
    }

    app.incrementInflightRenders();
    try {
      const result = await takeScreenshot(pool, options, config.NAVIGATION_TIMEOUT_MS);
      const ext = FORMAT_EXT[result.contentType] ?? 'bin';
      await cache.set(optionsHash, result.buffer, result.contentType, ext, result.metadata, cacheTtl);

      const format = result.contentType.includes('jpeg') ? 'jpeg' : 'png';
      incrementRenderCounter('screenshot', format, 'completed', false);
      observeRenderDuration('screenshot', format, result.durationMs / 1000);

      if (wantsMetadata) {
        return sendMetadataEnvelope(reply, result.buffer, result.contentType, result.durationMs, 'MISS', result.metadata ?? null);
      }
      return sendBinaryResponse(reply, result.buffer, result.contentType, result.durationMs, 'MISS');
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
          metadata: { type: 'string', enum: ['true', 'false'], description: 'Return JSON envelope with metadata' },
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
          device: { type: 'string', description: 'Device preset ID (e.g., iphone-15-pro, desktop-4k). Sets userAgent and emulation flags. See GET /v1/devices for available presets.' },
          userAgent: { type: 'string', description: 'Custom user agent string' },
          waitFor: { type: 'string', description: 'CSS selector to wait for (legacy - use wait for new features)' },
          wait: {
            type: 'object',
            description: 'Advanced wait strategy after navigation. Use this instead of waitFor for flexible waiting.',
            oneOf: [
              {
                type: 'object',
                properties: { type: { type: 'string', enum: ['networkidle'] } },
                required: ['type'],
                description: 'Wait for network to be idle (no requests for 500ms)',
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['delay'] },
                  value: { type: 'integer', minimum: 0, maximum: 30000, description: 'Delay in milliseconds' },
                },
                required: ['type', 'value'],
                description: 'Wait for a fixed delay',
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['selector'] },
                  value: { type: 'string', description: 'CSS selector' },
                },
                required: ['type', 'value'],
                description: 'Wait for CSS selector to appear',
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['function'] },
                  value: { type: 'string', description: 'JavaScript expression returning truthy when ready' },
                },
                required: ['type', 'value'],
                description: 'Wait for custom JavaScript expression to return truthy',
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['hidden'] },
                  value: { type: 'string', description: 'CSS selector that must disappear' },
                },
                required: ['type', 'value'],
                description: 'Wait for element to disappear (e.g., loading spinner)',
              },
            ],
          },
          callback_url: { type: 'string', description: 'Webhook callback URL (async only)' },
          block_ads: { type: 'boolean', default: false },
          hide_cookies: { type: 'boolean', default: false },
          block_resources: {
            type: 'array',
            items: { type: 'string', enum: ['image', 'stylesheet', 'font', 'script', 'media', 'other'] },
            maxItems: 6,
            default: [],
            description: 'Resource types to block during page load for faster captures and reduced bandwidth'
          },
          custom_css: { type: 'string' },
          custom_js: { type: 'string' },
          headers: {
            type: 'object',
            description: 'Custom HTTP headers to send with the request',
            additionalProperties: { type: 'string' },
          },
          cookies: {
            type: 'array',
            description: 'Custom cookies to set before rendering',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Cookie name' },
                value: { type: 'string', description: 'Cookie value' },
                domain: { type: 'string', description: 'Cookie domain (optional)' },
                path: { type: 'string', description: 'Cookie path (optional)' },
              },
              required: ['name', 'value'],
            },
          },
          geolocation: {
            type: 'object',
            description: 'Geolocation to emulate',
            properties: {
              latitude: { type: 'number', minimum: -90, maximum: 90, description: 'Latitude' },
              longitude: { type: 'number', minimum: -180, maximum: 180, description: 'Longitude' },
              accuracy: { type: 'number', minimum: 0, description: 'Accuracy in meters (optional)' },
            },
            required: ['latitude', 'longitude'],
          },
          timezone: {
            type: 'string',
            description: 'IANA timezone identifier (e.g., "America/New_York", "Europe/London")',
          },
          locale: {
            type: 'string',
            description: 'Locale to emulate (e.g., "en-US", "fr-FR")',
            pattern: '^[a-z]{2}(-[A-Z]{2})?$',
          },
          proxy: {
            type: 'object',
            description: 'HTTP/SOCKS proxy configuration for this request. Overrides global PROXY_SERVER env var.',
            properties: {
              server: { type: 'string', description: 'Proxy server URL (http://, https://, socks4://, or socks5://)' },
              username: { type: 'string', description: 'Proxy authentication username (optional)' },
              password: { type: 'string', description: 'Proxy authentication password (optional)' },
            },
            required: ['server'],
          },
          cache_ttl: {
            type: 'integer',
            minimum: 0,
            maximum: 2592000,
            description: 'Cache duration in seconds (0-2592000). 0 = bypass cache entirely, default = server config (3600s). Max 30 days.',
          },
          cache_key: {
            type: 'string',
            maxLength: 128,
            description: 'Custom cache key suffix for different cache entries with same URL. Useful for caching different JS states.',
          },
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

    // Sanitize custom headers and cookies (use sanitized values)
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

    const query = req.query as { async?: string; metadata?: string };
    if (query.async === 'true') {
      const urlOrHtml = options.url ?? options.html ?? '';
      return enqueueRender(req, reply, 'pdf', urlOrHtml, options as unknown as Record<string, unknown>);
    }

    const wantsMetadata = query.metadata === 'true';
    const cacheTtl = options.cache_ttl;
    const optionsHash = RenderCache.hashOptions(options as unknown as Record<string, unknown>);

    // If cache_ttl=0, bypass cache entirely (skip read and write)
    if (cacheTtl === 0) {
      app.incrementInflightRenders();
      try {
        const result = await renderPdf(pool, options, config.NAVIGATION_TIMEOUT_MS);

        incrementRenderCounter('pdf', 'pdf', 'completed', false);
        observeRenderDuration('pdf', 'pdf', result.durationMs / 1000);

        if (wantsMetadata) {
          return sendMetadataEnvelope(reply, result.buffer, result.contentType, result.durationMs, 'MISS', result.metadata ?? null);
        }
        return sendBinaryResponse(reply, result.buffer, result.contentType, result.durationMs, 'MISS');
      } finally {
        app.decrementInflightRenders();
      }
    }

    // Normal cache flow (cache_ttl is undefined or > 0)
    const cached = await cache.get(optionsHash);
    if (cached) {
      incrementRenderCounter('pdf', 'pdf', 'completed', true);
      const buffer = await cache.readFile(cached.filePath);

      if (wantsMetadata) {
        return sendMetadataEnvelope(reply, buffer, cached.contentType, 0, 'HIT', cached.metadata ?? null);
      }
      return sendBinaryResponse(reply, buffer, cached.contentType, 0, 'HIT');
    }

    app.incrementInflightRenders();
    try {
      const result = await renderPdf(pool, options, config.NAVIGATION_TIMEOUT_MS);
      await cache.set(optionsHash, result.buffer, result.contentType, 'pdf', result.metadata, cacheTtl);

      incrementRenderCounter('pdf', 'pdf', 'completed', false);
      observeRenderDuration('pdf', 'pdf', result.durationMs / 1000);

      if (wantsMetadata) {
        return sendMetadataEnvelope(reply, result.buffer, result.contentType, result.durationMs, 'MISS', result.metadata ?? null);
      }
      return sendBinaryResponse(reply, result.buffer, result.contentType, result.durationMs, 'MISS');
    } finally {
      app.decrementInflightRenders();
    }
  });
}
