import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { buildServer } from '../../src/index.js';
import { getPool, closePool } from '../../src/db/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import { loadConfig } from '../../src/config/index.js';
import type { FastifyInstance } from 'fastify';

// Mock the Anthropic API client
vi.mock('../../src/api/anthropic.js', () => ({
  extractFromImage: vi.fn(),
  AnthropicApiError: class AnthropicApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'AnthropicApiError';
      this.statusCode = statusCode;
    }
  },
}));

// Mock the screenshot renderer
vi.mock('../../src/renderer/screenshot.js', () => ({
  takeScreenshot: vi.fn().mockResolvedValue({
    buffer: Buffer.from('fake-png-data'),
    contentType: 'image/png',
    durationMs: 500,
    metadata: { title: 'Test Page' },
  }),
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

import { extractFromImage } from '../../src/api/anthropic.js';
const mockExtract = vi.mocked(extractFromImage);

describe('extract routes', () => {
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
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-server-key';
    loadConfig();

    app = await buildServer({ skipBrowserInit: true });

    const freeResult = await createApiKey('extract-test-free', 'free');
    apiKeyId = freeResult.key.id;
    rawApiKey = freeResult.rawKey;

    const proResult = await createApiKey('extract-test-pro', 'pro');
    proApiKeyId = proResult.key.id;
    proRawApiKey = proResult.rawKey;
  });

  afterEach(async () => {
    mockExtract.mockReset();
    await getPool().query('DELETE FROM extraction_jobs WHERE api_key_id = ANY($1)', [[apiKeyId, proApiKeyId]]);
    await getPool().query('DELETE FROM extraction_usage_daily WHERE api_key_id = ANY($1)', [[apiKeyId, proApiKeyId]]);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM extraction_jobs WHERE api_key_id = ANY($1)', [[apiKeyId, proApiKeyId]]);
    await pool.query('DELETE FROM extraction_usage_daily WHERE api_key_id = ANY($1)', [[apiKeyId, proApiKeyId]]);
    await pool.query('DELETE FROM render_jobs WHERE api_key_id = ANY($1)', [[apiKeyId, proApiKeyId]]);
    await pool.query('DELETE FROM usage_daily WHERE api_key_id = ANY($1)', [[apiKeyId, proApiKeyId]]);
    await pool.query('DELETE FROM user_api_keys WHERE api_key_id = ANY($1)', [[apiKeyId, proApiKeyId]]);
    await pool.query('DELETE FROM api_keys WHERE id = ANY($1)', [[apiKeyId, proApiKeyId]]);
    await closePool();
    await app.close();
  });

  describe('POST /v1/extract', () => {
    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        payload: { url: 'https://example.com', prompt: 'Extract all text' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('requires prompt field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('requires url or job_id', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: { prompt: 'Extract all text' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects both url and job_id together', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          url: 'https://example.com',
          job_id: '00000000-0000-0000-0000-000000000000',
          prompt: 'Extract all text',
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('validates model choice', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com', prompt: 'Extract all text', model: 'gpt-4' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('extracts data from URL with server API key (default model sonnet)', async () => {
      mockExtract.mockResolvedValueOnce({
        data: { title: 'Example', prices: [9.99, 19.99] },
        modelUsed: 'claude-sonnet-4-5-20250929',
        tokensUsed: 1500,
        rawText: '{"title":"Example","prices":[9.99,19.99]}',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com', prompt: 'Extract the page title and all product prices' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toEqual({ title: 'Example', prices: [9.99, 19.99] });
      expect(body.model_used).toBe('claude-sonnet-4-5-20250929');
      expect(body.tokens_used).toBe(1500);
      expect(body.extraction_id).toBeTruthy();

      expect(mockExtract).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-ant-test-server-key',
          model: 'sonnet',
          prompt: 'Extract the page title and all product prices',
        }),
      );
    });

    it('supports haiku model', async () => {
      mockExtract.mockResolvedValueOnce({
        data: { count: 5 },
        modelUsed: 'claude-haiku-4-5-20251001',
        tokensUsed: 500,
        rawText: '{"count":5}',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com', prompt: 'Count the images', model: 'haiku' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.model_used).toBe('claude-haiku-4-5-20251001');
      expect(mockExtract).toHaveBeenCalledWith(expect.objectContaining({ model: 'haiku' }));
    });

    it('supports BYOK via x-llm-api-key header', async () => {
      mockExtract.mockResolvedValueOnce({
        data: { result: 'test' },
        modelUsed: 'claude-sonnet-4-5-20250929',
        tokensUsed: 100,
        rawText: '{"result":"test"}',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey, 'x-llm-api-key': 'sk-ant-user-custom-key' },
        payload: { url: 'https://example.com', prompt: 'Extract data' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockExtract).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-ant-user-custom-key' }),
      );
    });

    it('passes schema to extraction', async () => {
      const schema = {
        type: 'object',
        properties: { name: { type: 'string' }, price: { type: 'number' } },
        required: ['name', 'price'],
      };

      mockExtract.mockResolvedValueOnce({
        data: { name: 'Widget', price: 29.99 },
        modelUsed: 'claude-sonnet-4-5-20250929',
        tokensUsed: 800,
        rawText: '{"name":"Widget","price":29.99}',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com', prompt: 'Extract product info', schema },
      });

      expect(response.statusCode).toBe(200);
      expect(mockExtract).toHaveBeenCalledWith(expect.objectContaining({ schema }));
    });

    it('returns error when no API key available', async () => {
      const saved = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      loadConfig();
      const noKeyApp = await buildServer({ skipBrowserInit: true });

      const response = await noKeyApp.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com', prompt: 'Extract data' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('EXTRACTION_NO_API_KEY');

      await noKeyApp.close();
      process.env.ANTHROPIC_API_KEY = saved;
      loadConfig();
    });

    it('handles Anthropic API errors', async () => {
      const { AnthropicApiError } = await import('../../src/api/anthropic.js');
      mockExtract.mockRejectedValueOnce(new AnthropicApiError('Rate limited', 429));

      const response = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com', prompt: 'Extract data' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('EXTRACTION_FAILED');
    });

    it('tracks extraction usage in DB', async () => {
      mockExtract.mockResolvedValueOnce({
        data: { result: 'test' },
        modelUsed: 'claude-sonnet-4-5-20250929',
        tokensUsed: 100,
        rawText: '{"result":"test"}',
      });

      await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com', prompt: 'Extract data' },
      });

      const jobs = await getPool().query(
        'SELECT * FROM extraction_jobs WHERE api_key_id = $1',
        [apiKeyId],
      );
      expect(jobs.rows.length).toBe(1);
      expect(jobs.rows[0].status).toBe('completed');
      expect(jobs.rows[0].prompt).toBe('Extract data');
      expect(jobs.rows[0].model).toBe('sonnet');
      expect(jobs.rows[0].tokens_used).toBe(100);

      const usage = await getPool().query(
        'SELECT count FROM extraction_usage_daily WHERE api_key_id = $1 AND date = CURRENT_DATE',
        [apiKeyId],
      );
      expect(usage.rows.length).toBe(1);
      expect(usage.rows[0].count).toBe(1);
    });

    it('enforces daily extraction limit', async () => {
      await getPool().query(
        `INSERT INTO extraction_usage_daily (api_key_id, date, count)
         VALUES ($1, CURRENT_DATE, 10)
         ON CONFLICT (api_key_id, date) DO UPDATE SET count = 10`,
        [apiKeyId],
      );

      const response = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com', prompt: 'Extract data' },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('EXTRACTION_LIMIT_EXCEEDED');
    });

    it('extracts data from existing job_id', async () => {
      const jobResult = await getPool().query(
        `INSERT INTO render_jobs (api_key_id, type, url, options, status, result_path, content_type)
         VALUES ($1, 'screenshot', 'https://example.com', '{}', 'completed', 'test-job.png', 'image/png')
         RETURNING id`,
        [apiKeyId],
      );
      const jobId = jobResult.rows[0].id;

      mockExtract.mockResolvedValueOnce({
        data: { heading: 'Hello World' },
        modelUsed: 'claude-sonnet-4-5-20250929',
        tokensUsed: 200,
        rawText: '{"heading":"Hello World"}',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: { job_id: jobId, prompt: 'Extract the main heading' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toEqual({ heading: 'Hello World' });
    });

    it('returns 404 for non-existent job_id', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: { job_id: '00000000-0000-0000-0000-000000000000', prompt: 'Extract data' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('JOB_NOT_FOUND');
    });

    it('passes screenshot_options to capture', async () => {
      mockExtract.mockResolvedValueOnce({
        data: { mobile: true },
        modelUsed: 'claude-sonnet-4-5-20250929',
        tokensUsed: 300,
        rawText: '{"mobile":true}',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          url: 'https://example.com',
          prompt: 'Check mobile layout',
          screenshot_options: { viewport_width: 375, viewport_height: 812, format: 'jpeg' },
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /v1/extract (list)', () => {
    it('returns correct total count independent of limit/offset', async () => {
      // Create 3 extraction jobs
      for (let i = 0; i < 3; i++) {
        mockExtract.mockResolvedValueOnce({
          data: { i },
          modelUsed: 'claude-sonnet-4-5-20250929',
          tokensUsed: 100,
          rawText: `{"i":${i}}`,
        });
        await app.inject({
          method: 'POST',
          url: '/v1/extract',
          headers: { 'x-api-key': rawApiKey },
          payload: { url: 'https://example.com', prompt: 'Extract data' },
        });
      }

      // Request with limit=1 — should return 1 item but total=3
      const response = await app.inject({
        method: 'GET',
        url: '/v1/extract?limit=1&offset=0',
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.extractions).toHaveLength(1);
      expect(body.total).toBe(3);
    });

    it('returns total=0 when no extractions exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.extractions).toHaveLength(0);
      expect(body.total).toBe(0);
    });
  });

  describe('GET /v1/extract/:id', () => {
    it('returns extraction job details', async () => {
      mockExtract.mockResolvedValueOnce({
        data: { title: 'Test' },
        modelUsed: 'claude-sonnet-4-5-20250929',
        tokensUsed: 100,
        rawText: '{"title":"Test"}',
      });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com', prompt: 'Extract title' },
      });
      const extractionId = JSON.parse(createRes.body).extraction_id;

      const response = await app.inject({
        method: 'GET',
        url: `/v1/extract/${extractionId}`,
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.extraction.id).toBe(extractionId);
      expect(body.extraction.data).toEqual({ title: 'Test' });
      expect(body.extraction.status).toBe('completed');
    });

    it('returns 404 for non-existent extraction', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/extract/00000000-0000-0000-0000-000000000000',
        headers: { 'x-api-key': rawApiKey },
      });
      expect(response.statusCode).toBe(404);
    });

    it('prevents access to other users extractions', async () => {
      mockExtract.mockResolvedValueOnce({
        data: { secret: 'data' },
        modelUsed: 'claude-sonnet-4-5-20250929',
        tokensUsed: 100,
        rawText: '{"secret":"data"}',
      });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/extract',
        headers: { 'x-api-key': rawApiKey },
        payload: { url: 'https://example.com', prompt: 'Extract secrets' },
      });
      const extractionId = JSON.parse(createRes.body).extraction_id;

      const response = await app.inject({
        method: 'GET',
        url: `/v1/extract/${extractionId}`,
        headers: { 'x-api-key': proRawApiKey },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
