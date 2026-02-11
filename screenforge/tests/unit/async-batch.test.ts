import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import { getPool, closePool, resetPool } from '../../src/db/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import { resolve } from 'node:path';
import { rm, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';

const TEST_STORAGE = resolve(import.meta.dirname, '../../storage-async-test');

describe('async render & batch', { timeout: 120_000 }, () => {
  let app: FastifyInstance;
  let fixtureServer: Server;
  let fixtureUrl: string;
  let apiKey: string;

  beforeAll(async () => {
    const html = await readFile(resolve(import.meta.dirname, '../fixtures/test-page.html'), 'utf-8');
    fixtureServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    await new Promise<void>((r) => fixtureServer.listen(0, '127.0.0.1', r));
    const addr = fixtureServer.address();
    if (addr && typeof addr === 'object') {
      fixtureUrl = `http://127.0.0.1:${addr.port}`;
    }

    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.STORAGE_PATH = TEST_STORAGE;
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.ALLOW_PRIVATE_URLS = 'true';
    process.env.REQUIRE_AUTH = 'true';
    process.env.BASE_URL = 'http://localhost:3000';

    // Build server first so config is loaded, then create key with same salt
    app = await buildServer({ skipBrowserInit: true });

    const created = await createApiKey('Async Test Key', 'pro');
    apiKey = created.rawKey;
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((r) => fixtureServer.close(() => r()));
    await rm(TEST_STORAGE, { recursive: true, force: true });
    const pool = getPool();
    const keyResult = await pool.query('SELECT id FROM api_keys WHERE name = $1', ['Async Test Key']);
    const keyIds = keyResult.rows.map((r: { id: string }) => r.id);
    if (keyIds.length > 0) {
      await pool.query('DELETE FROM render_jobs WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM batch_jobs WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM usage_daily WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM api_keys WHERE id = ANY($1)', [keyIds]);
    }
    await closePool();
    resetPool();
    delete process.env.ALLOW_PRIVATE_URLS;
    delete process.env.REQUIRE_AUTH;
    delete process.env.BASE_URL;
  });

  describe('POST /v1/screenshot?async=true', () => {
    it('returns 202 with job info when async=true', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot?async=true',
        headers: { 'x-api-key': apiKey },
        payload: { url: fixtureUrl },
      });
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body.id).toBeDefined();
      expect(body.status).toBe('pending');
      expect(body.pollUrl).toContain('/v1/render/');
    });
  });

  describe('POST /v1/pdf?async=true', () => {
    it('returns 202 with job info for async PDF', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/pdf?async=true',
        headers: { 'x-api-key': apiKey },
        payload: { url: fixtureUrl },
      });
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body.id).toBeDefined();
      expect(body.status).toBe('pending');
    });
  });

  describe('GET /v1/render/:id', () => {
    it('returns job status for valid job', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/screenshot?async=true',
        headers: { 'x-api-key': apiKey },
        payload: { url: fixtureUrl },
      });
      const { id } = JSON.parse(createRes.body);

      const pollRes = await app.inject({
        method: 'GET',
        url: `/v1/render/${id}`,
      });
      expect(pollRes.statusCode).toBe(200);
      const body = JSON.parse(pollRes.body);
      expect(body.id).toBe(id);
      expect(body.url).toBe(fixtureUrl);
      expect(['pending', 'processing', 'completed']).toContain(body.status);
      expect(body.pollUrl).toContain(`/v1/render/${id}`);
    });

    it('returns 404 for non-existent job', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/render/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('JOB_NOT_FOUND');
    });
  });

  describe('POST /v1/batch', () => {
    it('creates a batch with multiple items', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/batch',
        headers: { 'x-api-key': apiKey },
        payload: {
          items: [
            { type: 'screenshot', url: fixtureUrl },
            { type: 'screenshot', url: fixtureUrl, options: { format: 'jpeg' } },
          ],
        },
      });
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body.batchId).toBeDefined();
      expect(body.total).toBe(2);
      expect(body.status).toBe('processing');
      expect(body.jobs).toHaveLength(2);
      expect(body.jobs[0].id).toBeDefined();
      expect(body.jobs[0].pollUrl).toContain('/v1/render/');
      expect(body.pollUrl).toContain('/v1/batch/');
    });

    it('rejects empty items array', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/batch',
        headers: { 'x-api-key': apiKey },
        payload: { items: [] },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects batch with invalid item URL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/batch',
        headers: { 'x-api-key': apiKey },
        payload: {
          items: [
            { type: 'screenshot', url: 'not-a-url' },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('supports mixed screenshot and pdf items', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/batch',
        headers: { 'x-api-key': apiKey },
        payload: {
          items: [
            { type: 'screenshot', url: fixtureUrl },
            { type: 'pdf', url: fixtureUrl },
          ],
        },
      });
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body.total).toBe(2);
    });
  });

  describe('GET /v1/batch/:id', () => {
    it('returns batch status with jobs', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/batch',
        headers: { 'x-api-key': apiKey },
        payload: {
          items: [
            { type: 'screenshot', url: fixtureUrl },
          ],
        },
      });
      const { batchId } = JSON.parse(createRes.body);

      const pollRes = await app.inject({
        method: 'GET',
        url: `/v1/batch/${batchId}`,
      });
      expect(pollRes.statusCode).toBe(200);
      const body = JSON.parse(pollRes.body);
      expect(body.id).toBe(batchId);
      expect(body.total).toBe(1);
      expect(body.jobs).toBeDefined();
      expect(Array.isArray(body.jobs)).toBe(true);
    });

    it('returns 404 for non-existent batch', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/batch/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('BATCH_NOT_FOUND');
    });
  });
});
