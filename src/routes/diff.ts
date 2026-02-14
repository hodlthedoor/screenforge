import type { FastifyInstance } from 'fastify';
import { diffOptionsSchema, screenshotOptionsSchema, isPrivateUrl } from '../renderer/schemas.js';
import type { ScreenshotOptions } from '../renderer/schemas.js';
import { compareImages } from '../renderer/diff.js';
import { takeScreenshot } from '../renderer/screenshot.js';
import type { BrowserPool } from '../renderer/browser-pool.js';
import { getConfig } from '../config/index.js';
import { authMiddleware } from '../auth/middleware.js';
import { incrementUsage, getUsageStats } from '../db/api-keys.js';
import type { SlidingWindowRateLimiter } from '../auth/rate-limiter.js';
import { getPool } from '../db/index.js';
import { getStorageBackend } from '../storage/index.js';
import { sanitizeUrl, SanitizeError } from '../security/sanitize.js';
import { sendError } from '../security/errors.js';

export async function diffRoutes(
  app: FastifyInstance,
  pool: BrowserPool,
  rateLimiter?: SlidingWindowRateLimiter,
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
          output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'], default: 'png' },
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
}
