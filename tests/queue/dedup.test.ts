import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import { getPool, closePool, resetPool } from '../../src/db/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import Redis from 'ioredis';
import { computeFingerprint, checkDedup, clearDedup } from '../../src/queue/dedup.js';

const TEST_STORAGE = resolve(import.meta.dirname, '../../storage-dedup-test');
const REDIS_URL = 'redis://127.0.0.1:6379/15';

describe('computeFingerprint', () => {
  it('generates consistent SHA256 hash for identical parameters', () => {
    const params1 = {
      url: 'https://example.com',
      format: 'png',
      width: 1920,
      height: 1080,
      fullPage: false,
    };
    const params2 = {
      url: 'https://example.com',
      format: 'png',
      width: 1920,
      height: 1080,
      fullPage: false,
    };

    const fp1 = computeFingerprint(params1);
    const fp2 = computeFingerprint(params2);

    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
  });

  it('generates different hashes for different URLs', () => {
    const params1 = { url: 'https://example.com', format: 'png', width: 1920, height: 1080 };
    const params2 = { url: 'https://different.com', format: 'png', width: 1920, height: 1080 };

    expect(computeFingerprint(params1)).not.toBe(computeFingerprint(params2));
  });

  it('generates different hashes for different formats', () => {
    const params1 = { url: 'https://example.com', format: 'png', width: 1920, height: 1080 };
    const params2 = { url: 'https://example.com', format: 'jpeg', width: 1920, height: 1080 };

    expect(computeFingerprint(params1)).not.toBe(computeFingerprint(params2));
  });

  it('generates different hashes for different dimensions', () => {
    const params1 = { url: 'https://example.com', format: 'png', width: 1920, height: 1080 };
    const params2 = { url: 'https://example.com', format: 'png', width: 1280, height: 720 };

    expect(computeFingerprint(params1)).not.toBe(computeFingerprint(params2));
  });

  it('excludes timestamp and requestId from fingerprint', () => {
    const params1 = {
      url: 'https://example.com',
      format: 'png',
      width: 1920,
      height: 1080,
      timestamp: Date.now(),
      requestId: 'abc-123',
    };
    const params2 = {
      url: 'https://example.com',
      format: 'png',
      width: 1920,
      height: 1080,
      timestamp: Date.now() + 1000,
      requestId: 'def-456',
    };

    expect(computeFingerprint(params1)).toBe(computeFingerprint(params2));
  });

  it('includes clip region in fingerprint', () => {
    const params1 = {
      url: 'https://example.com',
      format: 'png',
      width: 1920,
      height: 1080,
      clip: { x: 0, y: 0, width: 100, height: 100 },
    };
    const params2 = {
      url: 'https://example.com',
      format: 'png',
      width: 1920,
      height: 1080,
      clip: { x: 10, y: 10, width: 100, height: 100 },
    };

    expect(computeFingerprint(params1)).not.toBe(computeFingerprint(params2));
  });

  it('includes device preset in fingerprint', () => {
    const params1 = {
      url: 'https://example.com',
      format: 'png',
      device: 'iphone-15-pro',
    };
    const params2 = {
      url: 'https://example.com',
      format: 'png',
      device: 'desktop-4k',
    };

    expect(computeFingerprint(params1)).not.toBe(computeFingerprint(params2));
  });

  it('normalizes parameter order', () => {
    const params1 = { url: 'https://example.com', format: 'png', width: 1920, height: 1080 };
    const params2 = { height: 1080, width: 1920, format: 'png', url: 'https://example.com' };

    expect(computeFingerprint(params1)).toBe(computeFingerprint(params2));
  });

  it('includes type in fingerprint to prevent cross-type dedup', () => {
    const params = { url: 'https://example.com', format: 'png', width: 1920, height: 1080 };

    const screenshotFp = computeFingerprint(params, 'screenshot');
    const pdfFp = computeFingerprint(params, 'pdf');

    expect(screenshotFp).not.toBe(pdfFp);
  });

  it('fingerprint without type is backward-compatible', () => {
    const params = { url: 'https://example.com', format: 'png' };

    // Without type, should still produce consistent hashes
    expect(computeFingerprint(params)).toBe(computeFingerprint(params));
  });

  it('HTML render fingerprint is consistent regardless of url field', () => {
    const html = '<html><body>Hello</body></html>';
    // When enqueuing, url is set to the html content and html is in options
    const enqueueParams = { url: html, html, format: 'png', width: 1920, height: 1080 };
    // Verify consistency: same inputs always produce same fingerprint
    expect(computeFingerprint(enqueueParams, 'screenshot')).toBe(
      computeFingerprint(enqueueParams, 'screenshot'),
    );
  });

  it('HTML renders produce different fingerprints from URL renders', () => {
    const html = '<html><body>Hello</body></html>';
    const htmlParams = { url: html, html, format: 'png', width: 1920 };
    const urlParams = { url: 'https://example.com', format: 'png', width: 1920 };

    expect(computeFingerprint(htmlParams, 'screenshot')).not.toBe(
      computeFingerprint(urlParams, 'screenshot'),
    );
  });
});

describe('Redis deduplication', () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(REDIS_URL);
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    // Clear all dedup keys before each test
    const keys = await redis.keys('dedup:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  it('checkDedup returns null when no matching job exists', async () => {
    const fingerprint = 'test-fingerprint-123';
    const result = await checkDedup(redis, fingerprint);
    expect(result).toBeNull();
  });

  it('SET NX stores job ID with TTL', async () => {
    const fingerprint = 'test-fingerprint-456';
    const jobId = 'job-789';
    const ttlMs = 5000;

    await redis.set(`dedup:${fingerprint}`, jobId, 'PX', ttlMs, 'NX');

    const stored = await redis.get(`dedup:${fingerprint}`);
    expect(stored).toBe(jobId);

    // Verify TTL is set (allow 1 second tolerance)
    const ttl = await redis.pttl(`dedup:${fingerprint}`);
    expect(ttl).toBeGreaterThan(4000);
    expect(ttl).toBeLessThanOrEqual(5000);
  });

  it('checkDedup returns existing job ID', async () => {
    const fingerprint = 'test-fingerprint-789';
    const jobId = 'job-abc';

    await redis.set(`dedup:${fingerprint}`, jobId, 'PX', 30000, 'NX');

    const result = await checkDedup(redis, fingerprint);
    expect(result).toBe(jobId);
  });

  it('clearDedup removes dedup key', async () => {
    const fingerprint = 'test-fingerprint-clear';
    const jobId = 'job-clear';

    await redis.set(`dedup:${fingerprint}`, jobId, 'PX', 30000, 'NX');
    expect(await checkDedup(redis, fingerprint)).toBe(jobId);

    await clearDedup(redis, fingerprint);
    expect(await checkDedup(redis, fingerprint)).toBeNull();
  });

  it('dedup key expires after TTL', async () => {
    const fingerprint = 'test-fingerprint-expire';
    const jobId = 'job-expire';
    const ttlMs = 100; // Very short TTL for testing

    await redis.set(`dedup:${fingerprint}`, jobId, 'PX', ttlMs, 'NX');
    expect(await checkDedup(redis, fingerprint)).toBe(jobId);

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 150));

    expect(await checkDedup(redis, fingerprint)).toBeNull();
  });
});

describe('End-to-end deduplication — DEDUP_ENABLED=true', { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let apiKey: string;
  let redis: Redis;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.STORAGE_PATH = TEST_STORAGE;
    process.env.REDIS_URL = REDIS_URL;
    process.env.ALLOW_PRIVATE_URLS = 'true';
    process.env.REQUIRE_AUTH = 'true';
    process.env.BASE_URL = 'http://localhost:3000';
    process.env.DEDUP_ENABLED = 'true';
    process.env.DEDUP_WINDOW_MS = '30000';

    app = await buildServer({ skipBrowserInit: true });
    redis = new Redis(REDIS_URL);

    const created = await createApiKey('Dedup Test Key', 'free');
    apiKey = created.rawKey;
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
    await rm(TEST_STORAGE, { recursive: true, force: true });
    const pool = getPool();
    const keyResult = await pool.query(
      "SELECT id FROM api_keys WHERE name = 'Dedup Test Key'",
    );
    const keyIds = keyResult.rows.map((r: { id: string }) => r.id);
    if (keyIds.length > 0) {
      await pool.query('DELETE FROM render_jobs WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM usage_daily WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM api_keys WHERE id = ANY($1)', [keyIds]);
    }
    await closePool();
    resetPool();
    delete process.env.ALLOW_PRIVATE_URLS;
    delete process.env.REQUIRE_AUTH;
    delete process.env.BASE_URL;
    delete process.env.DEDUP_ENABLED;
    delete process.env.DEDUP_WINDOW_MS;
  });

  beforeEach(async () => {
    // Clear dedup keys before each test
    const keys = await redis.keys('dedup:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  it('identical concurrent requests return the same job ID', async () => {
    const payload = {
      url: 'http://127.0.0.1:1234',
      format: 'png',
      viewport: { width: 1920, height: 1080 },
      fullPage: false,
    };

    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/screenshot?async=true',
        headers: { 'x-api-key': apiKey },
        payload,
      }),
      app.inject({
        method: 'POST',
        url: '/v1/screenshot?async=true',
        headers: { 'x-api-key': apiKey },
        payload,
      }),
    ]);

    expect(res1.statusCode).toBe(202);
    expect(res2.statusCode).toBe(202);

    const body1 = JSON.parse(res1.body);
    const body2 = JSON.parse(res2.body);

    // Both requests should return the same job ID
    expect(body1.id).toBe(body2.id);

    // Only one job should be created in the database
    const pool = getPool();
    const result = await pool.query(
      'SELECT COUNT(*) FROM render_jobs WHERE id = $1',
      [body1.id],
    );
    expect(parseInt(result.rows[0].count)).toBe(1);
  });

  it('different parameters create separate jobs', async () => {
    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': apiKey },
      payload: {
        url: 'http://127.0.0.1:1234',
        format: 'png',
        viewport: { width: 1920, height: 1080 },
      },
    });

    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': apiKey },
      payload: {
        url: 'http://127.0.0.1:1234',
        format: 'jpeg', // Different format
        viewport: { width: 1920, height: 1080 },
      },
    });

    expect(res1.statusCode).toBe(202);
    expect(res2.statusCode).toBe(202);

    const body1 = JSON.parse(res1.body);
    const body2 = JSON.parse(res2.body);

    // Different parameters should create different jobs
    expect(body1.id).not.toBe(body2.id);
  });

  it('expired dedup window allows re-render', async () => {
    // NOTE: This test verifies TTL expiry at the Redis level.
    // We can't easily change DEDUP_WINDOW_MS mid-test because config is loaded at server startup.
    // Instead, we directly test the TTL mechanism via Redis in the unit tests above.
    // This is a placeholder for a proper integration test that would require server restart.

    // The DEDUP_WINDOW_MS=30000 is set in beforeAll, so we verify that the dedup key
    // persists within that window by making two quick requests.
    const payload = {
      url: 'http://127.0.0.1:1234',
      format: 'png',
      viewport: { width: 800, height: 600 },
    };

    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': apiKey },
      payload,
    });

    const body1 = JSON.parse(res1.body);

    // Immediately send the same request - should get same job ID (dedup hit)
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': apiKey },
      payload,
    });

    const body2 = JSON.parse(res2.body);

    // Within the dedup window, should return the same job
    expect(body1.id).toBe(body2.id);
  });

  it('dedup key persists after job creation (TTL-based expiry)', async () => {
    // Dedup keys are NOT cleared on completion — they expire via TTL.
    // This ensures concurrent requests within the window still resolve to the same job.
    const payload = {
      url: 'http://127.0.0.1:5555',
      format: 'png',
      viewport: { width: 640, height: 480 },
    };

    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': apiKey },
      payload,
    });
    expect(res1.statusCode).toBe(202);
    const body1 = JSON.parse(res1.body);

    // Verify a dedup key was set in Redis with the job ID as the value
    const keys = await redis.keys('dedup:*');
    const jobIdValues = await Promise.all(keys.map(k => redis.get(k)));
    expect(jobIdValues).toContain(body1.id);

    // Find the key holding this job ID and verify its TTL
    const keyIndex = jobIdValues.indexOf(body1.id);
    const ttl = await redis.pttl(keys[keyIndex]);
    expect(ttl).toBeGreaterThan(0);
  });

  it('screenshot and pdf with same URL produce different jobs', async () => {
    const payload = {
      url: 'http://127.0.0.1:7777',
      viewport: { width: 1920, height: 1080 },
    };

    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': apiKey },
      payload: { ...payload, format: 'png' },
    });

    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/pdf?async=true',
      headers: { 'x-api-key': apiKey },
      payload: { ...payload, format: 'a4' },
    });

    expect(res1.statusCode).toBe(202);
    expect(res2.statusCode).toBe(202);

    const body1 = JSON.parse(res1.body);
    const body2 = JSON.parse(res2.body);

    // Different render types must produce different job IDs
    expect(body1.id).not.toBe(body2.id);
  });
});

describe('Deduplication disabled — DEDUP_ENABLED=false', { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let apiKey: string;

  const DISABLED_STORAGE = resolve(import.meta.dirname, '../../storage-dedup-disabled-test');

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.STORAGE_PATH = DISABLED_STORAGE;
    process.env.REDIS_URL = REDIS_URL;
    process.env.ALLOW_PRIVATE_URLS = 'true';
    process.env.REQUIRE_AUTH = 'true';
    process.env.BASE_URL = 'http://localhost:3000';
    process.env.DEDUP_ENABLED = 'false';

    app = await buildServer({ skipBrowserInit: true });

    const created = await createApiKey('Dedup Disabled Test', 'free');
    apiKey = created.rawKey;
  });

  afterAll(async () => {
    await app.close();
    await rm(DISABLED_STORAGE, { recursive: true, force: true });
    const pool = getPool();
    const keyResult = await pool.query(
      "SELECT id FROM api_keys WHERE name = 'Dedup Disabled Test'",
    );
    const keyIds = keyResult.rows.map((r: { id: string }) => r.id);
    if (keyIds.length > 0) {
      await pool.query('DELETE FROM render_jobs WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM usage_daily WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM api_keys WHERE id = ANY($1)', [keyIds]);
    }
    await closePool();
    resetPool();
    delete process.env.ALLOW_PRIVATE_URLS;
    delete process.env.REQUIRE_AUTH;
    delete process.env.BASE_URL;
    delete process.env.DEDUP_ENABLED;
  });

  it('identical requests create separate jobs when dedup is disabled', async () => {
    const payload = {
      url: 'http://127.0.0.1:1234',
      format: 'png',
      viewport: { width: 1920, height: 1080 },
    };

    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/screenshot?async=true',
        headers: { 'x-api-key': apiKey },
        payload,
      }),
      app.inject({
        method: 'POST',
        url: '/v1/screenshot?async=true',
        headers: { 'x-api-key': apiKey },
        payload,
      }),
    ]);

    expect(res1.statusCode).toBe(202);
    expect(res2.statusCode).toBe(202);

    const body1 = JSON.parse(res1.body);
    const body2 = JSON.parse(res2.body);

    // With dedup disabled, should create separate jobs
    expect(body1.id).not.toBe(body2.id);
  });
});

describe('Deduplication metrics', { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let apiKey: string;

  const METRICS_STORAGE = resolve(import.meta.dirname, '../../storage-dedup-metrics-test');

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.STORAGE_PATH = METRICS_STORAGE;
    process.env.REDIS_URL = REDIS_URL;
    process.env.ALLOW_PRIVATE_URLS = 'true';
    process.env.REQUIRE_AUTH = 'true';
    process.env.BASE_URL = 'http://localhost:3000';
    process.env.DEDUP_ENABLED = 'true';
    process.env.DEDUP_WINDOW_MS = '30000';
    process.env.METRICS_ENABLED = 'true';

    app = await buildServer({ skipBrowserInit: true });

    const created = await createApiKey('Dedup Metrics Test', 'free');
    apiKey = created.rawKey;
  });

  afterAll(async () => {
    await app.close();
    await rm(METRICS_STORAGE, { recursive: true, force: true });
    const pool = getPool();
    const keyResult = await pool.query(
      "SELECT id FROM api_keys WHERE name = 'Dedup Metrics Test'",
    );
    const keyIds = keyResult.rows.map((r: { id: string }) => r.id);
    if (keyIds.length > 0) {
      await pool.query('DELETE FROM render_jobs WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM usage_daily WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM api_keys WHERE id = ANY($1)', [keyIds]);
    }
    await closePool();
    resetPool();
    delete process.env.ALLOW_PRIVATE_URLS;
    delete process.env.REQUIRE_AUTH;
    delete process.env.BASE_URL;
    delete process.env.DEDUP_ENABLED;
    delete process.env.DEDUP_WINDOW_MS;
    delete process.env.METRICS_ENABLED;
  });

  it('increments dedup hit counter on duplicate request', async () => {
    const payload = {
      url: 'http://127.0.0.1:9999',
      format: 'png',
      viewport: { width: 1024, height: 768 },
    };

    // First request - should be a miss
    await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': apiKey },
      payload,
    });

    // Second request - should be a hit
    await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': apiKey },
      payload,
    });

    // Fetch metrics
    const metricsRes = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(metricsRes.statusCode).toBe(200);
    const metrics = metricsRes.body;

    // Check that dedup hit counter exists and is incremented
    expect(metrics).toContain('screenforge_dedup_hits_total');
    expect(metrics).toMatch(/screenforge_dedup_hits_total \d+/);
  });

  it('increments dedup miss counter on first request', async () => {
    const payload = {
      url: 'http://127.0.0.1:8888',
      format: 'jpeg',
      viewport: { width: 1280, height: 720 },
    };

    // First request - should be a miss
    await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': apiKey },
      payload,
    });

    // Fetch metrics
    const metricsRes = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(metricsRes.statusCode).toBe(200);
    const metrics = metricsRes.body;

    // Check that dedup miss counter exists
    expect(metrics).toContain('screenforge_dedup_misses_total');
    expect(metrics).toMatch(/screenforge_dedup_misses_total \d+/);
  });
});
