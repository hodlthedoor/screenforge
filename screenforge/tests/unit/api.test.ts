import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rm } from 'node:fs/promises';

const FIXTURE_URL = pathToFileURL(resolve(__dirname, '../fixtures/test-page.html')).toString();
const TEST_STORAGE = resolve(__dirname, '../../storage-test');

describe('API endpoints', { timeout: 120_000 }, () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.STORAGE_PATH = TEST_STORAGE;
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    await rm(TEST_STORAGE, { recursive: true, force: true });
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
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.statusCode).toBe(400);
    });

    it('returns 400 for invalid url', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: { url: 'not-a-url' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('renders a screenshot and returns buffer', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: { url: FIXTURE_URL },
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
        payload: { url: FIXTURE_URL, format: 'jpeg', quality: 70 },
      });
      // Second request (same options)
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: { url: FIXTURE_URL, format: 'jpeg', quality: 70 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-cache']).toBe('HIT');
      expect(res.headers['x-render-duration-ms']).toBe('0');
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
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('renders a PDF and returns buffer', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/pdf',
        payload: { url: FIXTURE_URL },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['x-cache']).toBe('MISS');
      expect(res.headers['x-render-duration-ms']).toBeDefined();
      expect(res.rawPayload.slice(0, 5).toString()).toBe('%PDF-');
    });

    it('returns cache HIT on second PDF request', async () => {
      const payload = { url: FIXTURE_URL, format: 'letter', landscape: true };
      await app.inject({ method: 'POST', url: '/v1/pdf', payload });
      const res = await app.inject({ method: 'POST', url: '/v1/pdf', payload });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-cache']).toBe('HIT');
    });
  });

  describe('error handler', () => {
    it('returns consistent error JSON for unknown routes', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/nonexistent' });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
      expect(body.statusCode).toBe(404);
    });
  });
});
