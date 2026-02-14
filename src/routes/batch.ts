import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/index.js';
import { getQueue, type RenderJobData } from '../queue/render-queue.js';
import { authMiddleware } from '../auth/middleware.js';
import { getConfig } from '../config/index.js';
import { screenshotOptionsSchema, pdfOptionsSchema, isPrivateUrl } from '../renderer/schemas.js';
import { sanitizeCallbackUrl, SanitizeError } from '../security/sanitize.js';
import { sendError } from '../security/errors.js';

const batchItemSchema = z.object({
  type: z.enum(['screenshot', 'pdf']).default('screenshot'),
  url: z.string().url().optional(),
  html: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  callbackUrl: z.string().optional(),
}).refine((data) => (data.url && !data.html) || (!data.url && data.html), {
  message: 'Exactly one of url or html must be provided',
});

const batchRequestSchema = z.object({
  items: z.array(batchItemSchema).min(1).max(50),
});

export async function batchRoutes(app: FastifyInstance) {
  const config = getConfig();

  app.post('/v1/batch', {
    schema: {
      tags: ['batch'],
      summary: 'Submit batch render job',
      description: 'Submit multiple render jobs (screenshot or PDF) as a batch.',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['screenshot', 'pdf'], default: 'screenshot' },
                url: { type: 'string', },
                html: { type: 'string' },
                options: { type: 'object', additionalProperties: true },
                callbackUrl: { type: 'string', },
              },
            },
          },
        },
      },
    },
    preHandler: [authMiddleware],
  }, async (req, reply) => {
    const parsed = batchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(reply, req, 'VALIDATION_ERROR', { details: parsed.error.issues });
      return;
    }

    const { items } = parsed.data;

    // Validate each item's options against its type schema
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const fullOptions = {
        ...(item.url ? { url: item.url } : { html: item.html }),
        ...(item.options ?? {}),
      };
      const schema = item.type === 'pdf' ? pdfOptionsSchema : screenshotOptionsSchema;
      const check = schema.safeParse(fullOptions);
      if (!check.success) {
        sendError(reply, req, 'VALIDATION_ERROR', {
          message: `Validation failed for item ${i}`,
          details: check.error.issues,
        });
        return;
      }

      // SSRF check only for URL-based renders
      if (item.url && !config.ALLOW_PRIVATE_URLS && isPrivateUrl(item.url)) {
        sendError(reply, req, 'SSRF_BLOCKED', {
          message: `Item ${i}: URLs targeting private networks are not allowed`,
        });
        return;
      }

      if (item.callbackUrl) {
        try {
          sanitizeCallbackUrl(item.callbackUrl);
        } catch (e) {
          if (e instanceof SanitizeError) {
            sendError(reply, req, 'VALIDATION_ERROR', {
              message: `Item ${i}: ${e.message}`,
            });
            return;
          }
          throw e;
        }
      }
    }

    const pool = getPool();
    const apiKeyId = req.apiKey?.id ?? null;

    // Create batch record
    const batchResult = await pool.query(
      `INSERT INTO batch_jobs (api_key_id, total, status) VALUES ($1, $2, 'processing') RETURNING id`,
      [apiKeyId, items.length],
    );
    const batchId = batchResult.rows[0].id;

    const q = getQueue(config.REDIS_URL);
    const jobIds: string[] = [];

    for (const item of items) {
      const urlOrHtml = item.url ?? item.html!;
      const fullOptions = {
        ...(item.url ? { url: item.url } : { html: item.html }),
        ...(item.options ?? {}),
      };

      // Create job record in DB
      const jobResult = await pool.query(
        `INSERT INTO render_jobs (api_key_id, type, url, options, status, batch_id)
         VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING id`,
        [apiKeyId, item.type, urlOrHtml, JSON.stringify(fullOptions), batchId],
      );
      const jobId = jobResult.rows[0].id;
      jobIds.push(jobId);

      // Enqueue job
      const jobData: RenderJobData = {
        jobId,
        apiKeyId,
        type: item.type,
        ...(item.url ? { url: item.url } : {}),
        options: fullOptions,
        callbackUrl: item.callbackUrl,
        batchId,
      };
      await q.add(`render-${jobId}`, jobData);
    }

    return reply.status(202).send({
      batchId,
      total: items.length,
      status: 'processing',
      jobs: jobIds.map((id) => ({
        id,
        pollUrl: `${config.BASE_URL}/v1/render/${id}`,
      })),
      pollUrl: `${config.BASE_URL}/v1/batch/${batchId}`,
    });
  });

  app.get('/v1/batch/:id', {
    schema: {
      tags: ['batch'],
      summary: 'Get batch status',
      description: 'Get the status and jobs of a batch render.',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Batch ID' },
        },
        required: ['id'],
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const batchResult = await getPool().query(
      `SELECT id, total, completed, failed, status, created_at, completed_at
       FROM batch_jobs WHERE id = $1`,
      [id],
    );

    if (batchResult.rows.length === 0) {
      sendError(reply, req, 'BATCH_NOT_FOUND');
      return;
    }

    const batch = batchResult.rows[0];

    const jobsResult = await getPool().query(
      `SELECT id, type, url, status, error, duration_ms, content_type, result_path,
              metadata_title, metadata_final_url, metadata_status_code, metadata_width, metadata_height,
              metadata_enhanced
       FROM render_jobs WHERE batch_id = $1 ORDER BY created_at`,
      [id],
    );

    return reply.send({
      id: batch.id,
      total: batch.total,
      completed: batch.completed,
      failed: batch.failed,
      status: batch.status,
      createdAt: batch.created_at,
      completedAt: batch.completed_at ?? undefined,
      jobs: jobsResult.rows.map((j: {
        id: string;
        type: string;
        url: string;
        status: string;
        error: string | null;
        duration_ms: number | null;
        content_type: string | null;
        result_path: string | null;
        metadata_title: string | null;
        metadata_final_url: string | null;
        metadata_status_code: number | null;
        metadata_width: number | null;
        metadata_height: number | null;
        metadata_enhanced: unknown;
      }) => {
        // Build metadata if available (prefer enhanced, fall back to basic)
        let metadata;
        if (j.status === 'completed' && j.metadata_enhanced) {
          metadata = j.metadata_enhanced;
        } else if (j.status === 'completed' && (j.metadata_title !== null || j.metadata_final_url !== null || j.metadata_status_code !== null)) {
          metadata = {
            title: j.metadata_title ?? '',
            finalUrl: j.metadata_final_url ?? '',
            statusCode: j.metadata_status_code ?? 0,
            ...(j.metadata_width !== null ? { width: j.metadata_width } : {}),
            ...(j.metadata_height !== null ? { height: j.metadata_height } : {}),
          };
        }

        return {
          id: j.id,
          type: j.type,
          url: j.url,
          status: j.status,
          error: j.error ?? undefined,
          contentType: j.content_type ?? undefined,
          durationMs: j.duration_ms ?? undefined,
          metadata,
          pollUrl: `${config.BASE_URL}/v1/render/${j.id}`,
        };
      }),
    });
  });
}
