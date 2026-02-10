import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export async function registerDocs(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ScreenForge API',
        description: 'Self-hostable screenshot & render API — open-source alternative to ScreenshotOne',
        version: '0.2.0',
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
      },
      tags: [
        { name: 'render', description: 'Screenshot and PDF rendering' },
        { name: 'async', description: 'Async render job management' },
        { name: 'batch', description: 'Batch rendering' },
        { name: 'og', description: 'OpenGraph card generation' },
        { name: 'admin', description: 'Admin API key management' },
        { name: 'usage', description: 'Usage and quota tracking' },
        { name: 'health', description: 'Health checks' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
}
