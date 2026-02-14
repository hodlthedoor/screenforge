import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../auth/middleware.js';
import { getPool } from '../db/index.js';
import { incrementUsage } from '../db/api-keys.js';
import { getConfig } from '../config/index.js';
import { PLANS } from '../billing/plans.js';
import { sendError } from '../security/errors.js';
import { extractFromImage, AnthropicApiError } from '../api/anthropic.js';
import type { ModelChoice } from '../api/anthropic.js';
import { getStorageBackend } from '../storage/index.js';

const extractRequestSchema = z
  .object({
    url: z.string().url().optional(),
    job_id: z.string().uuid().optional(),
    prompt: z.string().min(1).max(4000),
    schema: z.record(z.string(), z.unknown()).optional(),
    model: z.enum(['sonnet', 'haiku']).default('sonnet'),
    screenshot_options: z
      .object({
        viewport_width: z.number().int().min(1).max(7680).optional(),
        viewport_height: z.number().int().min(1).max(4320).optional(),
        format: z.enum(['png', 'jpeg', 'webp']).optional(),
        full_page: z.boolean().optional(),
        delay_ms: z.number().int().min(0).max(30000).optional(),
      })
      .optional(),
  })
  .refine((data) => data.url || data.job_id, {
    message: 'Either url or job_id must be provided',
  })
  .refine((data) => !(data.url && data.job_id), {
    message: 'Provide either url or job_id, not both',
  });

export async function extractRoutes(app: FastifyInstance) {
  // POST /v1/extract — extract structured data from a screenshot
  app.post(
    '/v1/extract',
    {
      schema: {
        tags: ['extract'],
        summary: 'Extract structured data from a screenshot',
        description:
          'Captures a screenshot (or uses an existing render job) and extracts structured data via LLM vision. Supports BYOK via x-llm-api-key header.',
        security: [{ apiKey: [] }],
        body: {
          type: 'object',
          required: ['prompt'],
          properties: {
            url: { type: 'string', format: 'uri', description: 'URL to capture and extract from' },
            job_id: { type: 'string', format: 'uuid', description: 'Existing render job ID to extract from' },
            prompt: { type: 'string', minLength: 1, maxLength: 4000, description: 'What to extract (e.g. "extract all product names and prices")' },
            schema: { type: 'object', additionalProperties: true, description: 'JSON Schema to constrain the output shape' },
            model: { type: 'string', enum: ['sonnet', 'haiku'], default: 'sonnet', description: 'LLM model: sonnet (best quality) or haiku (faster/cheaper)' },
            screenshot_options: {
              type: 'object',
              properties: {
                viewport_width: { type: 'integer', minimum: 1, maximum: 7680 },
                viewport_height: { type: 'integer', minimum: 1, maximum: 4320 },
                format: { type: 'string', enum: ['png', 'jpeg', 'webp'] },
                full_page: { type: 'boolean' },
                delay_ms: { type: 'integer', minimum: 0, maximum: 30000 },
              },
              description: 'Screenshot capture options (only used when url is provided)',
            },
          },
        },
      },
      preHandler: [authMiddleware],
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = extractRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(reply, req, 'VALIDATION_ERROR', {
          details: parsed.error.issues,
        });
      }

      const { url, job_id, prompt, schema, model, screenshot_options } = parsed.data;
      const apiKeyId = req.apiKey!.id;
      const tier = req.apiKey!.tier;
      const config = getConfig();

      // Check daily extraction limit
      const plan = PLANS[tier];
      if (plan) {
        const pool = getPool();
        const usageResult = await pool.query(
          'SELECT COALESCE(count, 0)::int as count FROM extraction_usage_daily WHERE api_key_id = $1 AND date = CURRENT_DATE',
          [apiKeyId],
        );
        const currentUsage = usageResult.rows[0]?.count ?? 0;
        if (currentUsage >= plan.maxExtractionsDaily) {
          return sendError(reply, req, 'EXTRACTION_LIMIT_EXCEEDED', {
            details: {
              limit: plan.maxExtractionsDaily,
              used: currentUsage,
              tier: plan.name,
            },
          });
        }
      }

      // Determine the LLM API key (BYOK or server)
      const byokKey = req.headers['x-llm-api-key'] as string | undefined;
      const llmApiKey = byokKey || config.ANTHROPIC_API_KEY;
      if (!llmApiKey) {
        return sendError(reply, req, 'EXTRACTION_NO_API_KEY');
      }

      const pool = getPool();
      const start = performance.now();

      // Pre-validate job_id existence before creating extraction record (FK constraint)
      let sourceJob: { id: string; result_path: string; content_type: string; status: string } | undefined;
      if (job_id) {
        const jobResult = await pool.query(
          `SELECT id, result_path, content_type, status
           FROM render_jobs WHERE id = $1`,
          [job_id],
        );

        if (jobResult.rows.length === 0) {
          return sendError(reply, req, 'JOB_NOT_FOUND');
        }

        sourceJob = jobResult.rows[0] as typeof sourceJob;
        if (sourceJob!.status !== 'completed' || !sourceJob!.result_path) {
          return sendError(reply, req, 'VALIDATION_ERROR', {
            message: 'Source render job is not completed or has no result',
          });
        }
      }

      // Create extraction job record
      const jobInsert = await pool.query(
        `INSERT INTO extraction_jobs (api_key_id, source_type, source_url, source_job_id, prompt, response_schema, model, status, byok)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing', $8)
         RETURNING id`,
        [
          apiKeyId,
          url ? 'url' : 'job_id',
          url ?? null,
          job_id ?? null,
          prompt,
          schema ? JSON.stringify(schema) : null,
          model,
          !!byokKey,
        ],
      );
      const extractionId = jobInsert.rows[0].id;

      try {
        // Get the screenshot buffer
        let imageBuffer: Buffer;
        let imageMediaType: 'image/png' | 'image/jpeg' | 'image/webp';
        let screenshotPath: string | undefined;

        if (job_id && sourceJob) {
          const storage = getStorageBackend();
          imageBuffer = await storage.download(sourceJob.result_path);
          imageMediaType = contentTypeToMediaType(sourceJob.content_type);
          screenshotPath = sourceJob.result_path;
        } else {
          // Capture a new screenshot
          const browserPool = app.browserPool;
          const { takeScreenshot } = await import('../renderer/screenshot.js');
          const { screenshotOptionsSchema } = await import('../renderer/schemas.js');

          const screenshotOpts = screenshotOptionsSchema.parse({
            url,
            viewport_width: screenshot_options?.viewport_width ?? 1280,
            viewport_height: screenshot_options?.viewport_height ?? 800,
            format: screenshot_options?.format ?? 'png',
            full_page: screenshot_options?.full_page ?? false,
            delay: screenshot_options?.delay_ms,
          });

          const result = await takeScreenshot(browserPool, screenshotOpts, config.NAVIGATION_TIMEOUT_MS);
          imageBuffer = result.buffer;
          imageMediaType = contentTypeToMediaType(result.contentType);

          // Store the screenshot
          const storage = getStorageBackend();
          const ext = screenshot_options?.format ?? 'png';
          const key = `extract-${extractionId}.${ext}`;
          screenshotPath = await storage.upload(key, result.buffer, result.contentType);
        }

        // Call Anthropic vision API
        const imageBase64 = imageBuffer.toString('base64');
        const extractionResult = await extractFromImage({
          imageBase64,
          imageMediaType,
          prompt,
          schema,
          model: model as ModelChoice,
          apiKey: llmApiKey,
        });

        const durationMs = Math.round(performance.now() - start);

        // Update extraction job with results
        await pool.query(
          `UPDATE extraction_jobs
           SET status = 'completed', extracted_data = $1, tokens_used = $2,
               screenshot_path = $3, duration_ms = $4, completed_at = NOW()
           WHERE id = $5`,
          [
            JSON.stringify(extractionResult.data),
            extractionResult.tokensUsed,
            screenshotPath,
            durationMs,
            extractionId,
          ],
        );

        // Increment extraction usage
        await pool.query(
          `INSERT INTO extraction_usage_daily (api_key_id, date, count)
           VALUES ($1, CURRENT_DATE, 1)
           ON CONFLICT (api_key_id, date) DO UPDATE SET count = extraction_usage_daily.count + 1`,
          [apiKeyId],
        );

        // Also increment general usage
        await incrementUsage(apiKeyId);

        return reply.send({
          extraction_id: extractionId,
          data: extractionResult.data,
          model_used: extractionResult.modelUsed,
          tokens_used: extractionResult.tokensUsed,
          screenshot_path: screenshotPath,
          duration_ms: durationMs,
        });
      } catch (err) {
        const durationMs = Math.round(performance.now() - start);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';

        await pool.query(
          `UPDATE extraction_jobs
           SET status = 'failed', error = $1, duration_ms = $2, completed_at = NOW()
           WHERE id = $3`,
          [errorMessage, durationMs, extractionId],
        );

        if (err instanceof AnthropicApiError) {
          return sendError(reply, req, 'EXTRACTION_FAILED', {
            message: `LLM extraction failed: ${errorMessage}`,
          });
        }

        throw err;
      }
    },
  );

  // GET /v1/extract/:id — get extraction job details
  app.get(
    '/v1/extract/:id',
    {
      schema: {
        tags: ['extract'],
        summary: 'Get extraction result',
        description: 'Retrieve the result of a previous extraction job.',
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
      },
      preHandler: [authMiddleware],
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const apiKeyId = req.apiKey!.id;
      const pool = getPool();

      const result = await pool.query(
        `SELECT * FROM extraction_jobs WHERE id = $1 AND api_key_id = $2`,
        [id, apiKeyId],
      );

      if (result.rows.length === 0) {
        return sendError(reply, req, 'NOT_FOUND', {
          message: 'Extraction job not found',
        });
      }

      const row = result.rows[0];
      return reply.send({
        extraction: formatExtraction(row),
      });
    },
  );

  // GET /v1/extract — list extraction jobs
  app.get(
    '/v1/extract',
    {
      schema: {
        tags: ['extract'],
        summary: 'List extraction jobs',
        description: 'List all extraction jobs for the authenticated API key.',
        security: [{ apiKey: [] }],
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
      preHandler: [authMiddleware],
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const apiKeyId = req.apiKey!.id;
      const { limit = 20, offset = 0 } = req.query as { limit?: number; offset?: number };
      const pool = getPool();

      const result = await pool.query(
        `SELECT * FROM extraction_jobs WHERE api_key_id = $1
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [apiKeyId, limit, offset],
      );

      return reply.send({
        extractions: result.rows.map(formatExtraction),
        total: result.rows.length,
      });
    },
  );
}

function formatExtraction(row: Record<string, unknown>) {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    sourceJobId: row.source_job_id,
    prompt: row.prompt,
    responseSchema: row.response_schema,
    model: row.model,
    data: row.extracted_data,
    tokensUsed: row.tokens_used,
    screenshotPath: row.screenshot_path,
    status: row.status,
    error: row.error,
    durationMs: row.duration_ms,
    byok: row.byok,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function contentTypeToMediaType(
  contentType: string,
): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'image/jpeg';
  if (contentType.includes('webp')) return 'image/webp';
  return 'image/png';
}
