import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { validateSignedUrl } from '../auth/signed-urls.js';
import { getApiKeyWithSigningSecret, incrementUsage, getUsageStats } from '../db/api-keys.js';
import { screenshotOptionsSchema, pdfOptionsSchema, isPrivateUrl } from '../renderer/schemas.js';
import { getQueue, tierToPriority, type RenderJobData } from '../queue/render-queue.js';
import { getPool } from '../db/index.js';
import { getConfig } from '../config/index.js';
import { sendError } from '../security/errors.js';
import { sanitizeUrl, sanitizeSelector, sanitizeWaitFor, sanitizeSelectorList, SanitizeError } from '../security/sanitize.js';
import type { SlidingWindowRateLimiter } from '../auth/rate-limiter.js';

export async function signedRoutes(
  app: FastifyInstance,
  rateLimiter?: SlidingWindowRateLimiter,
) {
  const config = getConfig();

  async function handleSignedRequest(
    req: FastifyRequest,
    reply: FastifyReply,
    type: 'screenshot' | 'pdf',
  ) {
    const queryParams = req.query as Record<string, string>;

    // Extract API key ID
    const apiKeyId = queryParams.api_key_id;
    if (!apiKeyId) {
      sendError(reply, req, 'AUTH_REQUIRED', { message: 'Missing api_key_id in signed URL' });
      return;
    }

    // Get API key with signing secret
    const apiKey = await getApiKeyWithSigningSecret(apiKeyId);
    if (!apiKey) {
      sendError(reply, req, 'INVALID_API_KEY');
      return;
    }

    // Validate signature
    const validation = await validateSignedUrl(queryParams, apiKey.signingSecret);
    if (!validation.valid) {
      if (validation.error === 'EXPIRED') {
        sendError(reply, req, 'SIGNATURE_EXPIRED', { message: 'Signed URL has expired' });
        return;
      }
      sendError(reply, req, 'INVALID_SIGNATURE', { message: 'Signature validation failed' });
      return;
    }

    // Check if API key is active
    if (!apiKey.active) {
      sendError(reply, req, 'API_KEY_DISABLED');
      return;
    }

    // Check rate limit
    if (config.REQUIRE_AUTH && rateLimiter) {
      const result = await rateLimiter.check(apiKey.id, apiKey.rateLimit);
      reply.header('X-RateLimit-Limit', String(result.limit));
      reply.header('X-RateLimit-Remaining', String(result.remaining));
      reply.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

      if (!result.allowed) {
        sendError(reply, req, 'RATE_LIMITED', {
          details: {
            retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
          },
        });
        return;
      }
    }

    // Check quota (always check for signed URLs since they're authenticated)
    const usage = await getUsageStats(apiKey.id);
    if (usage.thisMonth >= apiKey.monthlyQuota) {
      sendError(reply, req, 'QUOTA_EXCEEDED');
      return;
    }

    // Increment usage (always increment for signed URLs)
    await incrementUsage(apiKey.id);

    // Build options from query params (excluding signature metadata)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { signature, expires, api_key_id, ...optionsParams } = queryParams;

    // Reconstruct nested objects (e.g., viewport.width → viewport: { width: ... })
    const options: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(optionsParams)) {
      if (key.includes('.')) {
        const [parent, child] = key.split('.');
        if (!options[parent]) {
          options[parent] = {};
        }
        (options[parent] as Record<string, unknown>)[child] = value;
      } else {
        options[key] = value;
      }
    }

    // Convert cache_ttl from query string (string) to number for validation
    if (options.cache_ttl !== undefined) {
      const cacheTtl = Number(options.cache_ttl);
      options.cache_ttl = Number.isNaN(cacheTtl) ? options.cache_ttl : cacheTtl;
    }

    // Validate options based on type
    const schema = type === 'screenshot' ? screenshotOptionsSchema : pdfOptionsSchema;
    const parsed = schema.safeParse(options);
    if (!parsed.success) {
      sendError(reply, req, 'VALIDATION_ERROR', { details: parsed.error.issues });
      return;
    }

    const validatedOptions = parsed.data;

    // Sanitize and check SSRF
    if ('url' in validatedOptions && validatedOptions.url) {
      try {
        sanitizeUrl(validatedOptions.url);
        if ('selector' in validatedOptions) {
          sanitizeSelector(validatedOptions.selector);
        }
        if ('waitFor' in validatedOptions) {
          sanitizeWaitFor(validatedOptions.waitFor);
        }
        if ('hide_selectors' in validatedOptions) {
          sanitizeSelectorList(validatedOptions.hide_selectors, 'hide_selectors');
        }
        if ('remove_selectors' in validatedOptions) {
          sanitizeSelectorList(validatedOptions.remove_selectors, 'remove_selectors');
        }
        if ('blur_selectors' in validatedOptions) {
          sanitizeSelectorList(validatedOptions.blur_selectors, 'blur_selectors');
        }
      } catch (e) {
        if (e instanceof SanitizeError) {
          sendError(reply, req, 'VALIDATION_ERROR', { message: e.message });
          return;
        }
        throw e;
      }

      if (!config.ALLOW_PRIVATE_URLS && isPrivateUrl(validatedOptions.url)) {
        sendError(reply, req, 'SSRF_BLOCKED');
        return;
      }
    }

    // Enqueue render job
    const priority = config.QUEUE_PRIORITY_ENABLED ? tierToPriority(apiKey.tier) : undefined;

    const jobResult = await getPool().query(
      `INSERT INTO render_jobs (api_key_id, type, url, options, callback_url, priority) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        apiKey.id,
        type,
        validatedOptions.url ?? validatedOptions.html ?? '',
        JSON.stringify(validatedOptions),
        null,
        priority ?? 40,
      ],
    );
    const jobId = jobResult.rows[0].id;

    const q = getQueue(config.REDIS_URL);
    const jobData: RenderJobData = {
      jobId,
      apiKeyId: apiKey.id,
      type,
      options: validatedOptions as unknown as Record<string, unknown>,
      ...(validatedOptions.url ? { url: validatedOptions.url } : {}),
    };
    await q.add(`render-${jobId}`, jobData, { priority });

    return reply.status(202).send({
      id: jobId,
      status: 'pending',
      pollUrl: `${config.BASE_URL}/v1/render/${jobId}`,
    });
  }

  app.get('/v1/signed/screenshot', {
    schema: {
      tags: ['signed'],
      summary: 'Signed screenshot URL',
      description: 'Render a screenshot via a pre-signed URL.',
      querystring: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to screenshot' },
          api_key_id: { type: 'string', description: 'API key ID' },
          signature: { type: 'string', description: 'HMAC signature' },
          expires: { type: 'string', description: 'Expiration timestamp' },
        },
        required: ['url', 'api_key_id', 'signature', 'expires'],
      },
    },
  }, async (req, reply) => {
    return handleSignedRequest(req, reply, 'screenshot');
  });

  app.get('/v1/signed/pdf', {
    schema: {
      tags: ['signed'],
      summary: 'Signed PDF URL',
      description: 'Render a PDF via a pre-signed URL.',
      querystring: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to render as PDF' },
          api_key_id: { type: 'string', description: 'API key ID' },
          signature: { type: 'string', description: 'HMAC signature' },
          expires: { type: 'string', description: 'Expiration timestamp' },
        },
        required: ['url', 'api_key_id', 'signature', 'expires'],
      },
    },
  }, async (req, reply) => {
    return handleSignedRequest(req, reply, 'pdf');
  });
}
