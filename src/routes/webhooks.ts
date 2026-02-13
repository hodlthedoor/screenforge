import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../auth/middleware.js';
import { listDeliveries, getDeliveryById, enqueueWebhook } from '../webhooks/delivery.js';
import { getWebhookConfig } from '../db/api-keys.js';
import { createError } from '../security/errors.js';
import { sanitizeCallbackUrl, SanitizeError } from '../security/sanitize.js';
import { getConfig } from '../config/index.js';
import { getPool } from '../db/index.js';

const listDeliveriesSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

const testWebhookSchema = z.object({
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function webhooksRoutes(app: FastifyInstance) {
  // GET /v1/webhooks/deliveries - List webhook deliveries for the authenticated API key
  app.get(
    '/v1/webhooks/deliveries',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'List webhook deliveries',
        description: 'List webhook deliveries for the authenticated API key.',
        security: [{ apiKey: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', minimum: 1, default: 1 },
            limit: { type: 'number', minimum: 1, maximum: 100, default: 50 },
          },
        },
      },
      preHandler: [authMiddleware],
    },
    async (req, reply) => {
      const parsed = listDeliveriesSchema.safeParse(req.query);
      if (!parsed.success) {
        const err = createError('VALIDATION_ERROR', undefined, { details: parsed.error.issues });
        return reply.status(err.statusCode).send(err);
      }

      const { page, limit } = parsed.data;
      const apiKeyId = req.apiKey!.id;

      const result = await listDeliveries({ apiKeyId, page, limit });

      return reply.send({
        deliveries: result.deliveries.map((d) => ({
          id: d.id,
          jobId: d.jobId,
          url: d.url,
          status: d.status,
          attempts: d.attempts,
          lastStatusCode: d.lastStatusCode,
          lastError: d.lastError,
          createdAt: d.createdAt,
          deliveredAt: d.deliveredAt,
        })),
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
        },
      });
    },
  );

  // GET /v1/webhooks/deliveries/:id - Get a specific delivery by ID
  app.get(
    '/v1/webhooks/deliveries/:id',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'Get webhook delivery',
        description: 'Get a specific webhook delivery by ID.',
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Delivery ID' },
          },
          required: ['id'],
        },
      },
      preHandler: [authMiddleware],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const apiKeyId = req.apiKey!.id;

      const delivery = await getDeliveryById(id, apiKeyId);

      if (!delivery) {
        const err = createError('JOB_NOT_FOUND', 'Webhook delivery not found');
        return reply.status(err.statusCode).send(err);
      }

      return reply.send({
        id: delivery.id,
        jobId: delivery.jobId,
        url: delivery.url,
        payload: delivery.payload,
        status: delivery.status,
        attempts: delivery.attempts,
        lastStatusCode: delivery.lastStatusCode,
        lastError: delivery.lastError,
        createdAt: delivery.createdAt,
        deliveredAt: delivery.deliveredAt,
      });
    },
  );

  // POST /v1/webhooks/test - Send a test webhook to the configured URL
  app.post(
    '/v1/webhooks/test',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'Send test webhook',
        description: 'Send a test webhook to the configured URL.',
        security: [{ apiKey: [] }],
        body: {
          type: 'object',
          properties: {
            payload: { type: 'object', additionalProperties: true, description: 'Custom payload for the test webhook' },
          },
        },
      },
      preHandler: [authMiddleware],
    },
    async (req, reply) => {
      const parsed = testWebhookSchema.safeParse(req.body);
      if (!parsed.success) {
        const err = createError('VALIDATION_ERROR', undefined, { details: parsed.error.issues });
        return reply.status(err.statusCode).send(err);
      }

      const apiKeyId = req.apiKey!.id;
      const webhookConfig = await getWebhookConfig(apiKeyId);

      if (!webhookConfig.url || !webhookConfig.secret) {
        const err = createError('VALIDATION_ERROR', 'Webhook URL and secret must be configured');
        return reply.status(err.statusCode).send(err);
      }

      // Validate webhook URL (SSRF protection)
      try {
        sanitizeCallbackUrl(webhookConfig.url, getConfig().ALLOW_PRIVATE_URLS);
      } catch (e) {
        if (e instanceof SanitizeError) {
          const err = createError('VALIDATION_ERROR', e.message);
          return reply.status(err.statusCode).send(err);
        }
        throw e;
      }

      // Create a test render job for the webhook
      const jobResult = await getPool().query(
        `INSERT INTO render_jobs (api_key_id, type, url, options, status)
         VALUES ($1, 'screenshot', 'https://example.com', '{}', 'completed')
         RETURNING id`,
        [apiKeyId],
      );
      const jobId = jobResult.rows[0].id;

      // Enqueue test webhook
      const testPayload = parsed.data.payload ?? {
        type: 'test',
        jobId,
        message: 'This is a test webhook from ScreenForge',
        timestamp: new Date().toISOString(),
      };

      const deliveryId = await enqueueWebhook(
        apiKeyId,
        jobId,
        webhookConfig.url,
        testPayload,
        webhookConfig.secret,
      );

      return reply.status(201).send({
        message: 'Test webhook enqueued',
        deliveryId,
        url: webhookConfig.url,
      });
    },
  );
}
