import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('docs site', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-must-be-32-chars!!';
    app = await buildServer({ skipBrowserInit: true });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /docs returns 200 with HTML', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('has cache-control header', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('contains page title and meta', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.body).toContain('<title>');
    expect(res.body).toContain('ScreenForge');
    expect(res.body).toContain('lang="en"');
  });

  it('contains sidebar navigation', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.body).toContain('class="sidebar');
  });

  it('includes highlight.js CDN for syntax highlighting', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.body).toContain('highlight.js');
    expect(res.body).toContain('hljs');
  });

  describe('documentation sections', () => {
    let body: string;

    beforeAll(async () => {
      const res = await app.inject({ method: 'GET', url: '/docs' });
      body = res.body;
    });

    it('contains Getting Started section', () => {
      expect(body).toContain('Getting Started');
      expect(body).toContain('x-api-key');
    });

    it('contains Authentication section', () => {
      expect(body).toContain('Authentication');
      expect(body).toContain('API Key');
      expect(body).toContain('Signed URL');
    });

    it('contains Screenshots section with examples', () => {
      expect(body).toContain('Screenshot');
      expect(body).toContain('/v1/screenshot');
      expect(body).toContain('curl');
    });

    it('contains PDFs section with examples', () => {
      expect(body).toContain('PDF');
      expect(body).toContain('/v1/pdf');
    });

    it('contains OG Cards section', () => {
      expect(body).toContain('OG Card');
      expect(body).toContain('/v1/og');
    });

    it('contains Batch Rendering section', () => {
      expect(body).toContain('Batch');
      expect(body).toContain('/v1/batch');
    });

    it('contains Async Rendering section', () => {
      expect(body).toContain('Async');
      expect(body).toContain('/v1/render');
    });

    it('contains Webhooks section', () => {
      expect(body).toContain('Webhook');
      expect(body).toContain('verification');
    });

    it('contains SDKs section with JS and Python', () => {
      expect(body).toContain('SDK');
      expect(body).toContain('npm install');
      expect(body).toContain('pip install');
    });

    it('contains Rate Limits section', () => {
      expect(body).toContain('Rate Limit');
    });

    it('contains Error Codes section', () => {
      expect(body).toContain('Error Code');
      expect(body).toContain('/v1/errors');
    });

    it('contains Self-Hosting Guide section', () => {
      expect(body).toContain('Self-Hosting');
      expect(body).toContain('Docker');
      expect(body).toContain('Environment');
    });

    it('each endpoint section has curl, JS, and Python examples', () => {
      // Check screenshot section has all three
      expect(body).toContain('curl -X POST');
      expect(body).toContain('@screenforge/sdk');
      expect(body).toContain('requests.post');
    });

    it('has Try it buttons linking to /playground', () => {
      expect(body).toContain('/playground');
      expect(body).toContain('Try it');
    });
  });

  describe('Swagger UI at /docs/swagger', () => {
    it('GET /docs/swagger/ returns 200 with Swagger UI', async () => {
      const res = await app.inject({ method: 'GET', url: '/docs/swagger/' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('swagger');
    });

    it('GET /docs/swagger/json returns OpenAPI spec', async () => {
      const res = await app.inject({ method: 'GET', url: '/docs/swagger/json' });
      expect(res.statusCode).toBe(200);
      const spec = JSON.parse(res.body);
      expect(spec.openapi).toMatch(/^3\./);
      expect(spec.info.title).toBe('ScreenForge API');
    });
  });

  describe('navigation links', () => {
    it('has links to playground, swagger, and home', async () => {
      const res = await app.inject({ method: 'GET', url: '/docs' });
      expect(res.body).toContain('/playground');
      expect(res.body).toContain('/docs/swagger');
      expect(res.body).toContain('href="/"');
    });
  });
});
