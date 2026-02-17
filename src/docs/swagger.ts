import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { APP_VERSION } from '../utils/version.js';

export async function registerDocs(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ScreenForge API',
        description: 'Self-hostable screenshot & render API — open-source alternative to ScreenshotOne',
        version: APP_VERSION,
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'x-api-key',
            description: 'API key for authentication (sf_live_* or sf_test_* prefix)',
          },
          bearer: {
            type: 'http',
            scheme: 'bearer',
            description: 'Bearer token authentication with API key',
          },
        },
        headers: {
          'X-RateLimit-Limit': {
            description: 'Maximum number of requests allowed in the current rate limit window (burst capacity for token bucket, window limit for sliding window)',
            schema: { type: 'integer' },
          },
          'X-RateLimit-Remaining': {
            description: 'Number of requests remaining in the current rate limit window (available tokens for token bucket, remaining requests for sliding window)',
            schema: { type: 'integer' },
          },
          'X-RateLimit-Reset': {
            description: 'Unix epoch timestamp (seconds) when the rate limit window resets (when next token becomes available for token bucket, window end for sliding window)',
            schema: { type: 'integer' },
          },
          'Retry-After': {
            description: 'Number of seconds to wait before retrying (only present on 429 rate limit responses)',
            schema: { type: 'integer' },
          },
        },
      },
      tags: [
        { name: 'render', description: 'Screenshot, PDF, and GIF rendering' },
        { name: 'async', description: 'Async render job management' },
        { name: 'batch', description: 'Batch rendering' },
        { name: 'og', description: 'OpenGraph card generation' },
        { name: 'devices', description: 'Device emulation presets' },
        { name: 'admin', description: 'Admin API key management' },
        { name: 'usage', description: 'Usage and quota tracking' },
        { name: 'health', description: 'Health checks' },
        { name: 'signed', description: 'Signed URL rendering' },
        { name: 'billing', description: 'Billing & Stripe integration' },
        { name: 'webhooks', description: 'Webhook management' },
        { name: 'schedules', description: 'Recurring render schedules' },
        { name: 'extract', description: 'LLM-powered structured data extraction' },
        { name: 'accessibility', description: 'WCAG accessibility auditing' },
        { name: 'auth', description: 'Authentication' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs/swagger',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
}
