import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { getPool, closePool, resetPool } from '../../src/db/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import { Redis } from 'ioredis';
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

vi.mock('../../src/queue/render-queue.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/queue/render-queue.js')>('../../src/queue/render-queue.js');
  return {
    ...actual,
    getQueue: () => ({ add: vi.fn() }),
  };
});

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

    it('returns X-Cache: HIT for cached screenshot', async () => {
      // First request — populates the cache (default cache_ttl > 0)
      mockTakeScreenshot.mockResolvedValueOnce({
        buffer: Buffer.from('cached-ss'),
        contentType: 'image/png',
        durationMs: 200,
        metadata: { title: 'Cached' },
      });

      const payload = { url: `https://cache-hit-ss-${Date.now()}.com` };
      const first = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload,
      });
      expect(first.statusCode).toBe(200);
      expect(first.headers['x-cache']).toBe('MISS');

      // Second request — should hit cache
      const second = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload,
      });
      expect(second.statusCode).toBe(200);
      expect(second.headers['x-cache']).toBe('HIT');
    });

    it('returns X-Cache: HIT with metadata envelope for cached screenshot', async () => {
      mockTakeScreenshot.mockResolvedValueOnce({
        buffer: Buffer.from('cached-ss-meta'),
        contentType: 'image/png',
        durationMs: 120,
        metadata: { title: 'CacheMeta' },
      });

      const payload = { url: `https://cache-hit-ss-meta-${Date.now()}.com` };
      // Populate cache
      await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload,
      });

      // Cache HIT with metadata
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot?metadata=true',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload,
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['x-cache']).toBe('HIT');
      const body = JSON.parse(res.body);
      expect(body.data).toBeDefined();
      expect(body.durationMs).toBe(0); // cache HIT duration is 0
    });

    it('returns 429 when rate limited', async () => {
      const pool = getPool();
      // Get the key ID
      const keyResult = await pool.query(
        'SELECT id FROM api_keys WHERE name = $1',
        ['Render Routes Test Key'],
      );
      const keyId = keyResult.rows[0].id;

      // Clear any existing rate limit entries from prior tests
      const redis = new Redis('redis://127.0.0.1:6379/15', { maxRetriesPerRequest: 3 });
      await redis.del(`screenforge:ratelimit:${keyId}`);
      redis.disconnect();

      // Set rate limit to 1
      const origRateLimit = await pool.query('SELECT rate_limit FROM api_keys WHERE id = $1', [keyId]);
      await pool.query('UPDATE api_keys SET rate_limit = 1 WHERE id = $1', [keyId]);

      // First request succeeds (uses limit)
      mockTakeScreenshot.mockResolvedValueOnce({
        buffer: Buffer.from('rl1'),
        contentType: 'image/png',
        durationMs: 10,
        metadata: null,
      });
      const first = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: { url: 'https://rate-limit-test.com', cache_ttl: 0 },
      });
      expect(first.statusCode).toBe(200);

      // Second request should be rate limited
      const second = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: { url: 'https://rate-limit-test-2.com', cache_ttl: 0 },
      });
      expect(second.statusCode).toBe(429);
      const body = JSON.parse(second.body);
      expect(body.error).toHaveProperty('code', 'RATE_LIMITED');

      // Restore rate limit
      await pool.query('UPDATE api_keys SET rate_limit = $1 WHERE id = $2', [origRateLimit.rows[0].rate_limit, keyId]);
    });

    it('returns 429 when monthly quota is exceeded', async () => {
      const pool = getPool();
      const keyResult = await pool.query(
        'SELECT id, monthly_quota FROM api_keys WHERE name = $1',
        ['Render Routes Test Key'],
      );
      const keyId = keyResult.rows[0].id;
      const quota = keyResult.rows[0].monthly_quota;

      // Set usage to quota limit
      await pool.query(
        'INSERT INTO usage_daily (api_key_id, date, count) VALUES ($1, CURRENT_DATE, $2) ON CONFLICT (api_key_id, date) DO UPDATE SET count = $2',
        [keyId, quota],
      );

      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: { url: 'https://quota-test.com', cache_ttl: 0 },
      });
      expect(res.statusCode).toBe(429);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'QUOTA_EXCEEDED');

      // Cleanup
      await pool.query('DELETE FROM usage_daily WHERE api_key_id = $1', [keyId]);
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

    it('returns X-Cache: HIT for cached PDF', async () => {
      mockRenderPdf.mockResolvedValueOnce({
        buffer: Buffer.from('cached-pdf'),
        contentType: 'application/pdf',
        durationMs: 180,
        metadata: null,
      });

      const payload = { url: `https://cache-hit-pdf-${Date.now()}.com` };
      const first = await app.inject({
        method: 'POST',
        url: '/v1/pdf',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload,
      });
      expect(first.statusCode).toBe(200);
      expect(first.headers['x-cache']).toBe('MISS');

      // Second request — should hit cache
      const second = await app.inject({
        method: 'POST',
        url: '/v1/pdf',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload,
      });
      expect(second.statusCode).toBe(200);
      expect(second.headers['x-cache']).toBe('HIT');
    });

    it('returns X-Cache: HIT with metadata envelope for cached PDF', async () => {
      mockRenderPdf.mockResolvedValueOnce({
        buffer: Buffer.from('cached-pdf-meta'),
        contentType: 'application/pdf',
        durationMs: 160,
        metadata: { title: 'PDF Cached' },
      });

      const payload = { url: `https://cache-hit-pdf-meta-${Date.now()}.com` };
      // Populate cache
      await app.inject({
        method: 'POST',
        url: '/v1/pdf',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload,
      });

      // Cache HIT with metadata
      const res = await app.inject({
        method: 'POST',
        url: '/v1/pdf?metadata=true',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload,
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['x-cache']).toBe('HIT');
      const body = JSON.parse(res.body);
      expect(body.data).toBeDefined();
      expect(body.durationMs).toBe(0); // cache HIT duration is 0
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

    it('returns 400 for PDF URL exceeding max length (sanitization)', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2040);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/pdf',
        headers: { 'x-api-key': rawKey, 'content-type': 'application/json' },
        payload: { url: longUrl },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(body.error.message).toContain('URL exceeds');
    });
  });
});
