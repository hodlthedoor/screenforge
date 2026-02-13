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

  app.post('/v1/batch', { preHandler: [authMiddleware] }, async (req, reply) => {
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
        url: urlOrHtml,
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

  app.get('/v1/batch/:id', async (req, reply) => {
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
      `SELECT id, type, url, status, error, duration_ms FROM render_jobs WHERE batch_id = $1 ORDER BY created_at`,
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
      }) => ({
        id: j.id,
        type: j.type,
        url: j.url,
        status: j.status,
        error: j.error ?? undefined,
        durationMs: j.duration_ms ?? undefined,
        pollUrl: `${config.BASE_URL}/v1/render/${j.id}`,
      })),
    });
  });
}
