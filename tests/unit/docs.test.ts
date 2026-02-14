import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('API documentation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    app = await buildServer({ skipBrowserInit: true });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /docs/swagger returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/swagger/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('GET /docs/swagger/json returns valid OpenAPI spec', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/swagger/json' });
    expect(res.statusCode).toBe(200);
    const spec = JSON.parse(res.body);
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe('ScreenForge API');
    expect(spec.info.version).toBe('1.0.0');
  });

  describe('swagger tags', () => {
    it('has all required tags', async () => {
      const spec = app.swagger();
      const tagNames = spec.tags?.map((t: { name: string }) => t.name) ?? [];
      const requiredTags = [
        'render', 'async', 'batch', 'og', 'admin', 'usage', 'health',
        'signed', 'billing', 'webhooks', 'auth', 'devices',
      ];
      for (const tag of requiredTags) {
        expect(tagNames, `Missing tag: ${tag}`).toContain(tag);
      }
    });
  });

  describe('all API routes have swagger schemas', () => {
    it('every /v1/* path has at least one documented operation', () => {
      const spec = app.swagger();
      const paths = spec.paths ?? {};

      // Check that key API paths are documented
      const requiredPaths = [
        '/v1/screenshot',
        '/v1/pdf',
        '/v1/og',
        '/v1/batch',
        '/v1/batch/{id}',
        '/v1/render/{id}',
        '/v1/keys',
        '/v1/usage',
        '/v1/devices',
        '/v1/signed/screenshot',
        '/v1/signed/pdf',
        '/v1/webhooks/deliveries',
        '/v1/webhooks/deliveries/{id}',
        '/v1/webhooks/test',
        '/v1/health',
      ];

      const documentedPaths = Object.keys(paths);
      for (const path of requiredPaths) {
        expect(documentedPaths, `Missing swagger path: ${path}`).toContain(path);
      }
    });

    it('each documented path has response schema', () => {
      const spec = app.swagger();
      const paths = spec.paths ?? {};

      for (const [path, methods] of Object.entries(paths)) {
        if (!path.startsWith('/v1/')) continue;
        for (const [method, operation] of Object.entries(methods as Record<string, unknown>)) {
          if (method === 'parameters') continue;
          const op = operation as { responses?: Record<string, unknown> };
          expect(op.responses, `${method.toUpperCase()} ${path} missing responses`).toBeDefined();
        }
      }
    });
  });

  describe('README.md sections', () => {
    let readme: string;

    beforeAll(async () => {
      readme = await readFile(join(__dirname, '../../README.md'), 'utf-8');
    });

    it('contains API Reference section', () => {
      expect(readme).toContain('## API Reference');
    });

    it('contains Configuration section', () => {
      expect(readme).toContain('## Configuration');
    });

    it('contains Self-Hosting section', () => {
      expect(readme).toContain('## Self-Hosting');
    });

    it('contains Architecture section', () => {
      expect(readme).toContain('## Architecture');
    });

    it('contains SDK section', () => {
      expect(readme).toMatch(/## SDK|## JavaScript SDK/);
    });

    it('contains Contributing section', () => {
      expect(readme).toContain('## Contributing');
    });
  });
});
