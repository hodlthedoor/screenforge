import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { buildServer } from '../../src/index.js';
import { getPool, closePool } from '../../src/db/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import { loadConfig } from '../../src/config/index.js';
import type { FastifyInstance } from 'fastify';

// Mock axe-core/playwright — the route does `await import('@axe-core/playwright')`
const mockAnalyze = vi.fn();
vi.mock('@axe-core/playwright', () => ({
  AxeBuilder: class AxeBuilder {
    withTags() { return this; }
    analyze() { return mockAnalyze(); }
  },
}));

// Mock the storage backend
vi.mock('../../src/storage/index.js', () => ({
  getStorageBackend: vi.fn().mockReturnValue({
    upload: vi.fn().mockResolvedValue('stored/path.png'),
    download: vi.fn().mockResolvedValue(Buffer.from('fake-stored-image')),
  }),
  createStorageBackend: vi.fn(),
  resetStorageBackend: vi.fn(),
}));

// Mock sharp for annotation
vi.mock('sharp', () => {
  const instance = {
    metadata: vi.fn().mockResolvedValue({ width: 1280, height: 800 }),
    composite: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('annotated-png-data')),
    png: vi.fn().mockReturnThis(),
  };
  const mockSharp = vi.fn().mockReturnValue(instance);
  return { default: mockSharp };
});

function makeAxeResult(overrides?: Partial<{ violations: unknown[]; passes: unknown[]; incomplete: unknown[] }>) {
  return {
    violations: overrides?.violations ?? [
      {
        id: 'image-alt',
        impact: 'critical',
        description: 'Ensures <img> elements have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        nodes: [
          {
            html: '<img src="photo.jpg">',
            target: ['img'],
            failureSummary: 'Fix any of the following: Element does not have an alt attribute',
          },
        ],
      },
    ],
    passes: overrides?.passes ?? [{ id: 'html-has-lang' }, { id: 'document-title' }],
    incomplete: overrides?.incomplete ?? [{ id: 'color-contrast' }],
  };
}

// Create a mock page that the route will use
function createMockPage() {
  return {
    goto: vi.fn().mockResolvedValue({ status: () => 200, url: () => 'https://example.com' }),
    title: vi.fn().mockResolvedValue('Test Page'),
    close: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot-data')),
    evaluate: vi.fn().mockResolvedValue([]),
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockContext() {
  return {
    newPage: vi.fn().mockResolvedValue(createMockPage()),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('accessibility routes', () => {
  let app: FastifyInstance;
  let apiKeyId: string;
  let rawApiKey: string;
  let proApiKeyId: string;
  let proRawApiKey: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql:///screenforge_test?host=/var/run/postgresql';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.ALLOW_PRIVATE_URLS = 'true';
    process.env.REQUIRE_AUTH = 'true';
    process.env.SCHEDULER_ENABLED = 'false';
    loadConfig();

    app = await buildServer({ skipBrowserInit: true });

    // Mock the browser pool's acquire method on the app instance
    app.browserPool.acquire = vi.fn().mockResolvedValue(createMockContext());

    const freeResult = await createApiKey('a11y-test-free', 'free');
    apiKeyId = freeResult.key.id;
    rawApiKey = freeResult.rawKey;

    const proResult = await createApiKey('a11y-test-pro', 'pro');
    proApiKeyId = proResult.key.id;
    proRawApiKey = proResult.rawKey;
  });

  afterEach(async () => {
    mockAnalyze.mockReset();
    await getPool().query('DELETE FROM accessibility_jobs WHERE api_key_id = ANY($1)', [[apiKeyId, proApiKeyId]]);
    await getPool().query('DELETE FROM accessibility_usage_daily WHERE api_key_id = ANY($1)', [[apiKeyId, proApiKeyId]]);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM accessibility_jobs WHERE api_key_id = ANY($1)', [[apiKeyId, proApiKeyId]]);
    await pool.query('DELETE FROM accessibility_usage_daily WHERE api_key_id = ANY($1)', [[apiKeyId, proApiKeyId]]);
    await pool.query('DELETE FROM usage_daily WHERE api_key_id = ANY($1)', [[apiKeyId, proApiKeyId]]);
    await pool.query('DELETE FROM user_api_keys WHERE api_key_id = ANY($1)', [[apiKeyId, proApiKeyId]]);
    await pool.query('DELETE FROM api_keys WHERE id = ANY($1)', [[apiKeyId, proApiKeyId]]);
    await closePool();
    await app.close();
  });

  describe('POST /v1/accessibility', () => {
    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/accessibility',
        payload: { url: 'https://example.com' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('requires url field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/accessibility',
        headers: { 'x-api-key': rawApiKey },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });

    it('validates standard option', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/accessibility',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com', standard: 'INVALID' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns accessibility report with violations', async () => {
      mockAnalyze.mockResolvedValueOnce(makeAxeResult());

      const response = await app.inject({
        method: 'POST',
        url: '/v1/accessibility',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.url).toBe('https://example.com');
      expect(body.standard).toBe('WCAG2AA');
      expect(body.violationsCount).toBe(1);
      expect(body.passesCount).toBe(2);
      expect(body.incompleteCount).toBe(1);
      expect(body.violations).toHaveLength(1);
      expect(body.violations[0].id).toBe('image-alt');
      expect(body.violations[0].impact).toBe('critical');
      expect(body.violations[0].nodes).toHaveLength(1);
      expect(body.auditId).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it('uses specified WCAG standard', async () => {
      mockAnalyze.mockResolvedValueOnce(makeAxeResult());

      const response = await app.inject({
        method: 'POST',
        url: '/v1/accessibility',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com', standard: 'WCAG2AAA' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.standard).toBe('WCAG2AAA');
    });

    it('includes screenshot URL when include_screenshot is true', async () => {
      mockAnalyze.mockResolvedValueOnce(makeAxeResult());

      const response = await app.inject({
        method: 'POST',
        url: '/v1/accessibility',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com', include_screenshot: true },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.screenshotPath).toBeTruthy();
      expect(body.annotatedScreenshotPath).toBeTruthy();
    });

    it('does not include screenshots by default', async () => {
      mockAnalyze.mockResolvedValueOnce(makeAxeResult());

      const response = await app.inject({
        method: 'POST',
        url: '/v1/accessibility',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.screenshotPath).toBeUndefined();
      expect(body.annotatedScreenshotPath).toBeUndefined();
    });

    it('tracks accessibility usage in DB', async () => {
      mockAnalyze.mockResolvedValueOnce(makeAxeResult());

      await app.inject({
        method: 'POST',
        url: '/v1/accessibility',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com' },
      });

      const jobs = await getPool().query(
        'SELECT * FROM accessibility_jobs WHERE api_key_id = $1',
        [apiKeyId],
      );
      expect(jobs.rows.length).toBe(1);
      expect(jobs.rows[0].status).toBe('completed');
      expect(jobs.rows[0].violations_count).toBe(1);
      expect(jobs.rows[0].passes_count).toBe(2);

      const usage = await getPool().query(
        'SELECT count FROM accessibility_usage_daily WHERE api_key_id = $1 AND date = CURRENT_DATE',
        [apiKeyId],
      );
      expect(usage.rows.length).toBe(1);
      expect(usage.rows[0].count).toBe(1);
    });

    it('enforces daily accessibility limit', async () => {
      await getPool().query(
        `INSERT INTO accessibility_usage_daily (api_key_id, date, count)
         VALUES ($1, CURRENT_DATE, 5)
         ON CONFLICT (api_key_id, date) DO UPDATE SET count = 5`,
        [apiKeyId],
      );

      const response = await app.inject({
        method: 'POST',
        url: '/v1/accessibility',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com' },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('ACCESSIBILITY_LIMIT_EXCEEDED');
    });

    it('passes screenshot_options to capture', async () => {
      mockAnalyze.mockResolvedValueOnce(makeAxeResult());

      const response = await app.inject({
        method: 'POST',
        url: '/v1/accessibility',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          url: 'https://example.com',
          screenshot_options: { viewport_width: 375, viewport_height: 812 },
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns clean report when page has no violations', async () => {
      mockAnalyze.mockResolvedValueOnce(makeAxeResult({
        violations: [],
        passes: [{ id: 'html-has-lang' }, { id: 'document-title' }, { id: 'image-alt' }],
        incomplete: [],
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/v1/accessibility',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.violationsCount).toBe(0);
      expect(body.passesCount).toBe(3);
      expect(body.incompleteCount).toBe(0);
      expect(body.violations).toHaveLength(0);
    });

    it('handles axe-core failures gracefully', async () => {
      mockAnalyze.mockRejectedValueOnce(new Error('Browser context closed'));

      const response = await app.inject({
        method: 'POST',
        url: '/v1/accessibility',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('ACCESSIBILITY_FAILED');
    });
  });

  describe('GET /v1/accessibility/:id', () => {
    it('returns audit details', async () => {
      mockAnalyze.mockResolvedValueOnce(makeAxeResult());

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/accessibility',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com' },
      });
      const auditId = JSON.parse(createRes.body).auditId;

      const response = await app.inject({
        method: 'GET',
        url: `/v1/accessibility/${auditId}`,
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.audit.id).toBe(auditId);
      expect(body.audit.status).toBe('completed');
      expect(body.audit.violationsCount).toBe(1);
    });

    it('returns 404 for non-existent audit', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/accessibility/00000000-0000-0000-0000-000000000000',
        headers: { 'x-api-key': rawApiKey },
      });
      expect(response.statusCode).toBe(404);
    });

    it('prevents access to other users audits', async () => {
      mockAnalyze.mockResolvedValueOnce(makeAxeResult());

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/accessibility',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com' },
      });
      const auditId = JSON.parse(createRes.body).auditId;

      const response = await app.inject({
        method: 'GET',
        url: `/v1/accessibility/${auditId}`,
        headers: { 'x-api-key': proRawApiKey },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /v1/accessibility (list)', () => {
    it('returns paginated list with total', async () => {
      for (let i = 0; i < 3; i++) {
        mockAnalyze.mockResolvedValueOnce(makeAxeResult());
        await app.inject({
          method: 'POST',
          url: '/v1/accessibility',
          headers: { 'x-api-key': rawApiKey },
          payload: { url: 'https://example.com' },
        });
      }

      const response = await app.inject({
        method: 'GET',
        url: '/v1/accessibility?limit=2&offset=0',
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.audits).toHaveLength(2);
      expect(body.total).toBe(3);
    });

    it('returns empty list when no audits exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/accessibility',
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.audits).toHaveLength(0);
      expect(body.total).toBe(0);
    });
  });
});
