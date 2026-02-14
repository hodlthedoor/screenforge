import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { getPool, closePool, resetPool } from '../../src/db/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import type { FastifyInstance } from 'fastify';

// Mock renderers to avoid spinning up real browsers
const mockTakeScreenshot = vi.fn().mockResolvedValue({
  buffer: Buffer.from('png'),
  contentType: 'image/png',
  durationMs: 100,
  metadata: { title: 'Test' },
});

const mockRenderPdf = vi.fn().mockResolvedValue({
  buffer: Buffer.from('pdf'),
  contentType: 'application/pdf',
  durationMs: 150,
  metadata: null,
});

vi.mock('../../src/renderer/screenshot.js', () => ({
  takeScreenshot: (...args: unknown[]) => mockTakeScreenshot(...args),
}));

vi.mock('../../src/renderer/pdf.js', () => ({
  renderPdf: (...args: unknown[]) => mockRenderPdf(...args),
}));

vi.mock('../../src/queue/render-queue.js', () => ({
  getQueue: () => ({ add: vi.fn() }),
}));

describe('render routes', () => {
  let app: FastifyInstance;
  let rawKey: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-32-chars-minimum-required';
    process.env.BASE_URL = 'http://localhost:3100';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.REQUIRE_AUTH = 'true';
    process.env.ALLOW_PRIVATE_URLS = 'false';

    app = await buildServer({ skipBrowserInit: true });

    const created = await createApiKey('Render Routes Test Key', 'pro');
    rawKey = created.rawKey;
  });

  afterAll(async () => {
    const pool = getPool();
    const keyResult = await pool.query(
      'SELECT id FROM api_keys WHERE name = $1',
      ['Render Routes Test Key'],
    );
    const keyIds = keyResult.rows.map((r: { id: string }) => r.id);
    if (keyIds.length > 0) {
      await pool.query('DELETE FROM render_jobs WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM usage_daily WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM api_keys WHERE id = ANY($1)', [keyIds]);
    }
    await app.close();
    await closePool();
    resetPool();
    delete process.env.ALLOW_PRIVATE_URLS;
  });

  describe('POST /v1/screenshot', () => {
    it('returns 400 for validation error (no url or html)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: { format: 'png' },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
    });

    it('returns 400 for SSRF blocked private URL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: { url: 'http://192.168.1.1' },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
    });

    it('returns 200 with image/png for valid screenshot', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: { url: 'https://example.com' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['x-cache']).toBeDefined();
    });

    it('returns JSON metadata envelope when metadata=true', async () => {
      mockTakeScreenshot.mockResolvedValueOnce({
        buffer: Buffer.from('png-meta'),
        contentType: 'image/png',
        durationMs: 80,
        metadata: { title: 'Meta Test' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot?metadata=true',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: { url: 'https://example.com', cache_ttl: 0 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      const body = JSON.parse(res.body);
      expect(body.data).toBeDefined();
      expect(body.contentType).toBe('image/png');
      expect(body.metadata).toEqual({ title: 'Meta Test' });
    });

    it('bypasses cache when cache_ttl=0 and returns X-Cache: MISS', async () => {
      mockTakeScreenshot.mockResolvedValueOnce({
        buffer: Buffer.from('no-cache-png'),
        contentType: 'image/png',
        durationMs: 50,
        metadata: null,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: { url: 'https://example.com/no-cache', cache_ttl: 0 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-cache']).toBe('MISS');
      expect(res.headers['content-type']).toBe('image/png');
    });

    it('returns 202 with job id for async=true', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot?async=true',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: { url: 'https://example.com' },
      });
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body.id).toBeDefined();
      expect(body.status).toBe('pending');
      expect(body.pollUrl).toContain('/v1/render/');
    });

    it('returns 400 for blocked header (Host)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: {
          url: 'https://example.com',
          headers: { Host: 'evil.com' },
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
    });

    it('returns 400 for selector with dangerous content', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: {
          url: 'https://example.com',
          hide_selectors: ['<script>alert(1)</script>'],
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
    });
  });

  describe('POST /v1/pdf', () => {
    it('returns 200 with application/pdf for valid request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/pdf',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: { url: 'https://example.com' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['x-cache']).toBeDefined();
    });

    it('returns JSON metadata envelope when metadata=true', async () => {
      mockRenderPdf.mockResolvedValueOnce({
        buffer: Buffer.from('pdf-meta'),
        contentType: 'application/pdf',
        durationMs: 120,
        metadata: { title: 'PDF Meta' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/pdf?metadata=true',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: { url: 'https://example.com', cache_ttl: 0 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      const body = JSON.parse(res.body);
      expect(body.data).toBeDefined();
      expect(body.contentType).toBe('application/pdf');
      expect(body.metadata).toEqual({ title: 'PDF Meta' });
    });

    it('returns 202 with job id for async=true', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/pdf?async=true',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: { url: 'https://example.com' },
      });
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body.id).toBeDefined();
      expect(body.status).toBe('pending');
      expect(body.pollUrl).toContain('/v1/render/');
    });

    it('returns 400 for SSRF blocked private URL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/pdf',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: { url: 'http://192.168.1.1' },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
    });
  });
});
