import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import sharp from 'sharp';
import { diffOptionsSchema, screenshotOptionsSchema, isPrivateUrl } from '../renderer/schemas.js';
import type { ScreenshotOptions } from '../renderer/schemas.js';
import { compareImages } from '../renderer/diff.js';
import { takeScreenshot } from '../renderer/screenshot.js';
import type { BrowserPool } from '../renderer/browser-pool.js';
import { getConfig } from '../config/index.js';
import { authMiddleware } from '../auth/middleware.js';
import { incrementUsage, getUsageStats, getWebhookConfig } from '../db/api-keys.js';
import type { SlidingWindowRateLimiter } from '../auth/rate-limiter.js';
import type { TokenBucketRateLimiter } from '../auth/token-bucket.js';
import { checkRateLimit } from '../auth/rate-limit-check.js';
import { getPool } from '../db/index.js';
import { getStorageBackend } from '../storage/index.js';
import { sanitizeUrl, SanitizeError } from '../security/sanitize.js';
import { sendError } from '../security/errors.js';
import { createBaseline, getBaseline, deleteBaseline, listBaselines, BaselineLimitError } from '../db/baselines.js';
import { enqueueWebhook } from '../webhooks/delivery.js';

export async function diffRoutes(
  app: FastifyInstance,
  pool: BrowserPool,
  rateLimiter?: SlidingWindowRateLimiter | TokenBucketRateLimiter,
) {
  const config = getConfig();

  app.post('/v1/diff', {
    schema: {
      tags: ['render'],
      summary: 'Visual diff — compare two screenshots',
      description: 'Compare two images pixel-by-pixel and return a diff image with mismatch stats. Supports URL pairs, job ID pairs, or uploaded images.',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        properties: {
          url_a: { type: 'string', description: 'First URL to screenshot' },
          url_b: { type: 'string', description: 'Second URL to screenshot' },
          job_id_a: { type: 'string', format: 'uuid', description: 'First completed job ID' },
          job_id_b: { type: 'string', format: 'uuid', description: 'Second completed job ID' },
          screenshot_options: {
            type: 'object',
            properties: {
              width: { type: 'integer', minimum: 1, maximum: 7680, default: 1920 },
              height: { type: 'integer', minimum: 1, maximum: 4320, default: 1080 },
              fullPage: { type: 'boolean', default: false },
              darkMode: { type: 'boolean', default: false },
              deviceScaleFactor: { type: 'number', minimum: 0.5, maximum: 4, default: 1 },
              delay: { type: 'integer', minimum: 0, maximum: 30000, default: 0 },
              waitFor: { type: 'string', description: 'CSS selector to wait for before capturing' },
              wait: { type: 'object', description: 'Advanced wait strategy (e.g. {"type":"delay","value":1000})' },
            },
          },
          threshold: { type: 'number', minimum: 0, maximum: 1, default: 0.1, description: 'Pixel sensitivity (0=exact, 1=lenient)' },
          include_diff_image: { type: 'boolean', default: true },
          anti_aliasing_detection: { type: 'boolean', default: false },
          output_format: { type: 'string', enum: ['png', 'jpeg', 'webp', 'avif'], default: 'png' },
        },
      },
    },
    preHandler: [authMiddleware],
  }, async (req, reply) => {
    const parsed = diffOptionsSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(reply, req, 'VALIDATION_ERROR', { details: parsed.error.issues });
      return;
    }

    const options = parsed.data;

    // Rate limiting
    if (config.REQUIRE_AUTH && req.apiKey && rateLimiter) {
      const result = await checkRateLimit(rateLimiter, req.apiKey.id, req.apiKey.tier, req.apiKey.rateLimit);
      reply.header('X-RateLimit-Limit', String(result.limit));
      reply.header('X-RateLimit-Remaining', String(result.remaining));
      reply.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

      if (!result.allowed) {
        const retryAfterSeconds = Math.ceil((result.resetAt - Date.now()) / 1000);
        reply.header('Retry-After', String(Math.max(0, retryAfterSeconds)));
        sendError(reply, req, 'RATE_LIMITED', {
          details: { retryAfter: Math.max(0, retryAfterSeconds) },
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

    let imageA: Buffer;
    let imageB: Buffer;

    if (options.url_a && options.url_b) {
      // URLs mode — render both pages as screenshots, then compare
      try {
        sanitizeUrl(options.url_a);
        sanitizeUrl(options.url_b);
      } catch (e) {
        if (e instanceof SanitizeError) {
          sendError(reply, req, 'VALIDATION_ERROR', { message: e.message });
          return;
        }
        throw e;
      }

      if (!config.ALLOW_PRIVATE_URLS) {
        if (isPrivateUrl(options.url_a) || isPrivateUrl(options.url_b)) {
          sendError(reply, req, 'SSRF_BLOCKED');
          return;
        }
      }

      const ssOpts = options.screenshot_options;

      // Build full screenshot options via schema parse to get all defaults
      // Convert convenience `delay` field to a wait strategy if no explicit wait/waitFor
      const resolvedWait = ssOpts?.wait
        ?? (ssOpts?.delay ? { type: 'delay' as const, value: ssOpts.delay } : undefined);

      const buildScreenshotOpts = (url: string): ScreenshotOptions => {
        const parsed = screenshotOptionsSchema.safeParse({
          url,
          viewport: ssOpts ? { width: ssOpts.width, height: ssOpts.height } : undefined,
          fullPage: ssOpts?.fullPage,
          darkMode: ssOpts?.darkMode,
          deviceScaleFactor: ssOpts?.deviceScaleFactor,
          waitFor: ssOpts?.waitFor,
          wait: resolvedWait,
          format: 'png',
        });
        if (!parsed.success) {
          // Shouldn't happen — inputs are pre-validated
          throw new Error(`Screenshot options validation failed: ${parsed.error.message}`);
        }
        return parsed.data;
      };

      app.incrementInflightRenders();
      try {
        const [resultA, resultB] = await Promise.all([
          takeScreenshot(pool, buildScreenshotOpts(options.url_a), config.NAVIGATION_TIMEOUT_MS),
          takeScreenshot(pool, buildScreenshotOpts(options.url_b), config.NAVIGATION_TIMEOUT_MS),
        ]);
        imageA = resultA.buffer;
        imageB = resultB.buffer;
      } finally {
        app.decrementInflightRenders();
      }
    } else if (options.job_id_a && options.job_id_b) {
      // Jobs mode — fetch previously rendered images from storage
      const dbPool = getPool();
      const [jobA, jobB] = await Promise.all([
        dbPool.query(
          `SELECT result_path, content_type FROM render_jobs WHERE id = $1 AND status = 'completed'`,
          [options.job_id_a],
        ),
        dbPool.query(
          `SELECT result_path, content_type FROM render_jobs WHERE id = $1 AND status = 'completed'`,
          [options.job_id_b],
        ),
      ]);

      if (jobA.rows.length === 0 || !jobA.rows[0].result_path) {
        sendError(reply, req, 'JOB_NOT_FOUND', { message: `Job ${options.job_id_a} not found or not completed` });
        return;
      }
      if (jobB.rows.length === 0 || !jobB.rows[0].result_path) {
        sendError(reply, req, 'JOB_NOT_FOUND', { message: `Job ${options.job_id_b} not found or not completed` });
        return;
      }

      const storage = getStorageBackend();
      [imageA, imageB] = await Promise.all([
        storage.download(jobA.rows[0].result_path),
        storage.download(jobB.rows[0].result_path),
      ]);
    } else {
      // Should not reach here — schema refine catches it
      sendError(reply, req, 'VALIDATION_ERROR', { message: 'Invalid input mode' });
      return;
    }

    const start = performance.now();
    const diffResult = await compareImages(imageA, imageB, {
      threshold: options.threshold,
      include_diff_image: options.include_diff_image,
      anti_aliasing_detection: options.anti_aliasing_detection,
      output_format: options.output_format,
    });
    const durationMs = Math.round(performance.now() - start);

    const inputMode = options.url_a ? 'url' : 'job_id';
    req.log.info({
      input_mode: inputMode,
      mismatch_percentage: diffResult.mismatch_percentage,
      diff_pixels: diffResult.diff_pixels,
      total_pixels: diffResult.total_pixels,
      diff_duration_ms: durationMs,
    }, 'diff completed');

    const response: Record<string, unknown> = {
      match: diffResult.mismatch_percentage === 0,
      mismatch_percentage: diffResult.mismatch_percentage,
      total_pixels: diffResult.total_pixels,
      diff_pixels: diffResult.diff_pixels,
      duration_ms: durationMs,
    };

    if (diffResult.diff_image_buffer) {
      response.diff_image = diffResult.diff_image_buffer.toString('base64');
      response.diff_image_content_type = `image/${options.output_format}`;
    }

    return reply.send(response);
  });

  // --- Baseline CRUD ---

  const baselineCreateSchema = z.object({
    name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, 'Name must be alphanumeric with hyphens/underscores'),
    url: z.string().url().optional(),
    image_base64: z.string().optional(),
  }).refine((d) => (d.url && !d.image_base64) || (!d.url && d.image_base64), {
    message: 'Provide exactly one of url or image_base64',
  });

  app.post('/v1/diff/baseline', {
    schema: {
      tags: ['diff'],
      summary: 'Create or update a named baseline',
      description: 'Store a named screenshot baseline for future regression checks. Accepts a URL (to screenshot) or a base64-encoded image. Max 50 baselines per API key.',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9_-]+$' },
          url: { type: 'string', format: 'uri' },
          image_base64: { type: 'string' },
        },
      },
    },
    preHandler: [authMiddleware],
  }, async (req, reply) => {
    const parsed = baselineCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(reply, req, 'VALIDATION_ERROR', { details: parsed.error.issues });
      return;
    }

    const { name, url, image_base64 } = parsed.data;
    const apiKeyId = req.apiKey!.id;
    let imageBuffer: Buffer;

    if (url) {
      try { sanitizeUrl(url); } catch (e) {
        if (e instanceof SanitizeError) { sendError(reply, req, 'VALIDATION_ERROR', { message: e.message }); return; }
        throw e;
      }
      if (!config.ALLOW_PRIVATE_URLS && isPrivateUrl(url)) {
        sendError(reply, req, 'SSRF_BLOCKED');
        return;
      }

      const ssOpts = screenshotOptionsSchema.safeParse({ url, format: 'png' });
      if (!ssOpts.success) {
        sendError(reply, req, 'VALIDATION_ERROR', { details: ssOpts.error.issues });
        return;
      }

      app.incrementInflightRenders();
      try {
        const result = await takeScreenshot(pool, ssOpts.data, config.NAVIGATION_TIMEOUT_MS);
        imageBuffer = result.buffer;
      } finally {
        app.decrementInflightRenders();
      }
    } else {
      imageBuffer = Buffer.from(image_base64!, 'base64');
    }

    // Get image dimensions and validate it's a real image
    let meta: sharp.Metadata;
    try {
      meta = await sharp(imageBuffer).metadata();
    } catch {
      sendError(reply, req, 'VALIDATION_ERROR', { message: 'Invalid image: unable to decode the provided image data' });
      return;
    }
    const width = meta.width ?? null;
    const height = meta.height ?? null;

    // Ensure PNG format for storage
    let pngBuffer: Buffer;
    try {
      pngBuffer = meta.format === 'png' ? imageBuffer : await sharp(imageBuffer).png().toBuffer();
    } catch {
      sendError(reply, req, 'VALIDATION_ERROR', { message: 'Invalid image: unable to process the provided image data' });
      return;
    }

    const storagePath = `baselines/${apiKeyId}/${name}.png`;
    const storage = getStorageBackend();
    await storage.upload(storagePath, pngBuffer, 'image/png');

    try {
      const baseline = await createBaseline(apiKeyId, name, storagePath, width, height);
      return reply.status(201).send({
        id: baseline.id,
        name: baseline.name,
        width: baseline.width,
        height: baseline.height,
        created_at: baseline.createdAt.toISOString(),
      });
    } catch (e) {
      if (e instanceof BaselineLimitError) {
        sendError(reply, req, 'BASELINE_LIMIT');
        return;
      }
      throw e;
    }
  });

  app.get('/v1/diff/baseline/:name', {
    schema: {
      tags: ['diff'],
      summary: 'Get baseline metadata and image URL',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
    preHandler: [authMiddleware],
  }, async (req, reply) => {
    const { name } = req.params as { name: string };
    const baseline = await getBaseline(req.apiKey!.id, name);
    if (!baseline) {
      sendError(reply, req, 'BASELINE_NOT_FOUND');
      return;
    }

    const storage = getStorageBackend();
    const downloadUrl = storage.getUrl(baseline.storagePath);

    return reply.send({
      id: baseline.id,
      name: baseline.name,
      width: baseline.width,
      height: baseline.height,
      storage_path: baseline.storagePath,
      download_url: downloadUrl,
      created_at: baseline.createdAt.toISOString(),
    });
  });

  app.delete('/v1/diff/baseline/:name', {
    schema: {
      tags: ['diff'],
      summary: 'Delete a baseline',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
    preHandler: [authMiddleware],
  }, async (req, reply) => {
    const { name } = req.params as { name: string };
    const apiKeyId = req.apiKey!.id;

    const baseline = await getBaseline(apiKeyId, name);
    if (!baseline) {
      sendError(reply, req, 'BASELINE_NOT_FOUND');
      return;
    }

    // Delete from storage and DB
    const storage = getStorageBackend();
    try { await storage.delete(baseline.storagePath); } catch { /* storage cleanup is best-effort */ }
    await deleteBaseline(apiKeyId, name);

    return reply.status(204).send();
  });

  app.get('/v1/diff/baselines', {
    schema: {
      tags: ['diff'],
      summary: 'List all baselines',
      security: [{ apiKey: [] }],
    },
    preHandler: [authMiddleware],
  }, async (req, reply) => {
    const baselines = await listBaselines(req.apiKey!.id);
    return reply.send({
      baselines: baselines.map((b) => ({
        id: b.id,
        name: b.name,
        width: b.width,
        height: b.height,
        created_at: b.createdAt.toISOString(),
      })),
      total: baselines.length,
    });
  });

  // --- Diff Check (regression check against stored baseline) ---

  const diffCheckSchema = z.object({
    baseline_name: z.string().min(1).max(100),
    url: z.string().url(),
    threshold: z.number().min(0).max(1).default(0.1),
    include_diff_image: z.boolean().default(true),
    anti_aliasing_detection: z.boolean().default(false),
    output_format: z.enum(['png', 'jpeg', 'webp', 'avif']).default('png'),
  });

  app.post('/v1/diff/check', {
    schema: {
      tags: ['diff'],
      summary: 'Regression check against a stored baseline',
      description: 'Takes a fresh screenshot of the URL, compares it against the named baseline, and returns diff results. Counts as 2 renders toward quota.',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['baseline_name', 'url'],
        properties: {
          baseline_name: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          threshold: { type: 'number', minimum: 0, maximum: 1, default: 0.1 },
          include_diff_image: { type: 'boolean', default: true },
          anti_aliasing_detection: { type: 'boolean', default: false },
          output_format: { type: 'string', enum: ['png', 'jpeg', 'webp', 'avif'], default: 'png' },
        },
      },
    },
    preHandler: [authMiddleware],
  }, async (req, reply) => {
    const parsed = diffCheckSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(reply, req, 'VALIDATION_ERROR', { details: parsed.error.issues });
      return;
    }

    const { baseline_name, url, threshold, include_diff_image, anti_aliasing_detection, output_format } = parsed.data;
    const apiKeyId = req.apiKey!.id;

    // Rate limiting — counts as 2 renders
    if (config.REQUIRE_AUTH && req.apiKey && rateLimiter) {
      const result = await checkRateLimit(rateLimiter, req.apiKey.id, req.apiKey.tier, req.apiKey.rateLimit);
      reply.header('X-RateLimit-Limit', String(result.limit));
      reply.header('X-RateLimit-Remaining', String(result.remaining));
      reply.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

      if (!result.allowed) {
        const retryAfterSeconds = Math.ceil((result.resetAt - Date.now()) / 1000);
        reply.header('Retry-After', String(Math.max(0, retryAfterSeconds)));
        sendError(reply, req, 'RATE_LIMITED', { details: { retryAfter: Math.max(0, retryAfterSeconds) } });
        return;
      }

      const usage = await getUsageStats(req.apiKey.id);
      if (usage.thisMonth + 2 > req.apiKey.monthlyQuota) {
        sendError(reply, req, 'QUOTA_EXCEEDED');
        return;
      }

      // Increment usage by 2 (screenshot + baseline comparison)
      await incrementUsage(req.apiKey.id, 2);
    }

    // Fetch baseline
    const baseline = await getBaseline(apiKeyId, baseline_name);
    if (!baseline) {
      sendError(reply, req, 'BASELINE_NOT_FOUND');
      return;
    }

    // Validate URL
    try { sanitizeUrl(url); } catch (e) {
      if (e instanceof SanitizeError) { sendError(reply, req, 'VALIDATION_ERROR', { message: e.message }); return; }
      throw e;
    }
    if (!config.ALLOW_PRIVATE_URLS && isPrivateUrl(url)) {
      sendError(reply, req, 'SSRF_BLOCKED');
      return;
    }

    // Take fresh screenshot
    const ssOpts = screenshotOptionsSchema.safeParse({ url, format: 'png' });
    if (!ssOpts.success) {
      sendError(reply, req, 'VALIDATION_ERROR', { details: ssOpts.error.issues });
      return;
    }

    let freshBuffer: Buffer;
    app.incrementInflightRenders();
    try {
      const result = await takeScreenshot(pool, ssOpts.data, config.NAVIGATION_TIMEOUT_MS);
      freshBuffer = result.buffer;
    } finally {
      app.decrementInflightRenders();
    }

    // Download baseline image
    const storage = getStorageBackend();
    const baselineImage = await storage.download(baseline.storagePath);

    // Compare
    const start = performance.now();
    const diffResult = await compareImages(baselineImage, freshBuffer, {
      threshold,
      include_diff_image,
      anti_aliasing_detection,
      output_format,
    });
    const durationMs = Math.round(performance.now() - start);

    req.log.info({
      baseline_name,
      mismatch_percentage: diffResult.mismatch_percentage,
      diff_pixels: diffResult.diff_pixels,
      total_pixels: diffResult.total_pixels,
    }, 'diff check completed');

    const response: Record<string, unknown> = {
      match: diffResult.mismatch_percentage === 0,
      baseline_name,
      mismatch_percentage: diffResult.mismatch_percentage,
      total_pixels: diffResult.total_pixels,
      diff_pixels: diffResult.diff_pixels,
      duration_ms: durationMs,
    };

    if (diffResult.diff_image_buffer) {
      response.diff_image = diffResult.diff_image_buffer.toString('base64');
      response.diff_image_content_type = `image/${output_format}`;
    }

    // Webhook: fire if mismatch exceeds threshold and webhook is configured
    if (diffResult.mismatch_percentage > threshold) {
      try {
        const webhookConfig = await getWebhookConfig(apiKeyId);
        if (webhookConfig.url && webhookConfig.secret) {
          // Create a dummy render job for webhook delivery tracking
          const dbPool = getPool();
          const jobResult = await dbPool.query(
            `INSERT INTO render_jobs (api_key_id, type, url, options, status)
             VALUES ($1, 'diff', $2, '{}', 'completed') RETURNING id`,
            [apiKeyId, url],
          );
          await enqueueWebhook(apiKeyId, jobResult.rows[0].id, webhookConfig.url, {
            type: 'diff_regression',
            baseline_name,
            url,
            mismatch_percentage: diffResult.mismatch_percentage,
            diff_pixels: diffResult.diff_pixels,
            total_pixels: diffResult.total_pixels,
            threshold,
            timestamp: new Date().toISOString(),
          }, webhookConfig.secret);
        }
      } catch (e) {
        req.log.warn({ err: e }, 'Failed to fire diff regression webhook');
      }
    }

    return reply.send(response);
  });
}
