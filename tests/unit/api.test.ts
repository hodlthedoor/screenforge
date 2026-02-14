import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import { rm, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';

const TEST_STORAGE = resolve(__dirname, '../../storage-test');

describe('API endpoints', { timeout: 120_000 }, () => {
  let app: FastifyInstance;
  let fixtureServer: Server;
  let fixtureUrl: string;

  beforeAll(async () => {
    const html = await readFile(resolve(__dirname, '../fixtures/test-page.html'), 'utf-8');
    fixtureServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    await new Promise<void>((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
    const addr = fixtureServer.address();
    if (addr && typeof addr === 'object') {
      fixtureUrl = `http://127.0.0.1:${addr.port}`;
    }

    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.STORAGE_PATH = TEST_STORAGE;
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.ALLOW_PRIVATE_URLS = 'true';
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await rm(TEST_STORAGE, { recursive: true, force: true });
    delete process.env.ALLOW_PRIVATE_URLS;
  });

  describe('POST /v1/screenshot', () => {
    it('returns 400 for missing url', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.request_id).toBeDefined();
    });

    it('returns 400 for invalid url', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: { url: 'not-a-url' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for file:// URL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: { url: 'file:///etc/passwd' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('renders a screenshot and returns buffer', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: { url: fixtureUrl },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['x-cache']).toBe('MISS');
      expect(res.headers['x-render-duration-ms']).toBeDefined();
      expect(res.rawPayload.length).toBeGreaterThan(0);
      // PNG magic bytes
      expect(res.rawPayload[0]).toBe(0x89);
      expect(res.rawPayload[1]).toBe(0x50);
    });

    it('returns cache HIT on second request', async () => {
      // First request
      await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: { url: fixtureUrl, format: 'jpeg', quality: 70 },
      });
      // Second request (same options)
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: { url: fixtureUrl, format: 'jpeg', quality: 70 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-cache']).toBe('HIT');
      expect(res.headers['x-render-duration-ms']).toBe('0');
    });

    it('returns 400 for negative clip x', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: { url: fixtureUrl, clip: { x: -10, y: 0, width: 800, height: 600 } },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for zero clip width', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: { url: fixtureUrl, clip: { x: 0, y: 0, width: 0, height: 600 } },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for clip + selector (mutually exclusive)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: { url: fixtureUrl, clip: { x: 0, y: 0, width: 800, height: 600 }, selector: '#target' },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /v1/pdf', () => {
    it('returns 400 for missing url', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/pdf',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.request_id).toBeDefined();
    });

    it('renders a PDF and returns buffer', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/pdf',
        payload: { url: fixtureUrl },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['x-cache']).toBe('MISS');
      expect(res.headers['x-render-duration-ms']).toBeDefined();
      expect(res.rawPayload.slice(0, 5).toString()).toBe('%PDF-');
    });

    it('returns cache HIT on second PDF request', async () => {
      const payload = { url: fixtureUrl, format: 'letter', landscape: true };
      await app.inject({ method: 'POST', url: '/v1/pdf', payload });
      const res = await app.inject({ method: 'POST', url: '/v1/pdf', payload });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-cache']).toBe('HIT');
    });
  });

  describe('SSRF protection', () => {
    it('blocks private IP when ALLOW_PRIVATE_URLS is false', async () => {
      // Build a separate server with SSRF protection enabled
      process.env.ALLOW_PRIVATE_URLS = 'false';
      const ssrfApp = await buildServer({ skipBrowserInit: true });

      const res = await ssrfApp.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: { url: 'http://192.168.1.1' },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('SSRF_BLOCKED');
      expect(body.error.request_id).toBeDefined();

      await ssrfApp.close();
      process.env.ALLOW_PRIVATE_URLS = 'true';
    });

    it('blocks localhost when ALLOW_PRIVATE_URLS is false', async () => {
      process.env.ALLOW_PRIVATE_URLS = 'false';
      const ssrfApp = await buildServer({ skipBrowserInit: true });

      const res = await ssrfApp.inject({
        method: 'POST',
        url: '/v1/pdf',
        payload: { url: 'http://localhost:3000' },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('SSRF_BLOCKED');
      expect(body.error.request_id).toBeDefined();

      await ssrfApp.close();
      process.env.ALLOW_PRIVATE_URLS = 'true';
    });
  });

  describe('error handler', () => {
    it('returns consistent error JSON for unknown routes', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/nonexistent' });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.request_id).toBeDefined();
    });
  });

  describe('custom headers and cookies', () => {
    let authServer: Server;
    let authUrl: string;

    beforeAll(async () => {
      // Create a test server that requires custom auth header
      authServer = createServer((req, res) => {
        const authHeader = req.headers['authorization'];
        const cookieHeader = req.headers['cookie'];

        if (authHeader === 'Bearer secret-token') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Authenticated</h1></body></html>');
        } else if (cookieHeader?.includes('session=valid-session')) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Cookie Auth</h1></body></html>');
        } else {
          res.writeHead(401, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Unauthorized</h1></body></html>');
        }
      });
      await new Promise<void>((resolve) => authServer.listen(0, '127.0.0.1', resolve));
      const addr = authServer.address();
      if (addr && typeof addr === 'object') {
        authUrl = `http://127.0.0.1:${addr.port}`;
      }
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => authServer.close(() => resolve()));
    });

    it('rejects blocked Host header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: {
          url: fixtureUrl,
          headers: { 'Host': 'evil.com' },
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Host');
    });

    it('rejects blocked Content-Length header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: {
          url: fixtureUrl,
          headers: { 'content-length': '100' },
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('allows custom Authorization header for screenshot', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: {
          url: authUrl,
          headers: { 'Authorization': 'Bearer secret-token' },
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
    });

    it('allows custom cookies for screenshot', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: {
          url: authUrl,
          cookies: [{ name: 'session', value: 'valid-session' }],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
    });

    it('allows custom headers for PDF', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/pdf',
        payload: {
          url: authUrl,
          headers: { 'Authorization': 'Bearer secret-token' },
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
    });

    it('allows custom cookies for PDF', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/pdf',
        payload: {
          url: authUrl,
          cookies: [{ name: 'session', value: 'valid-session' }],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
    });
  });
});
