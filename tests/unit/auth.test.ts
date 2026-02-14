import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import { getPool, closePool, resetPool } from '../../src/db/index.js';
import { createApiKey, hashApiKey, lookupApiKey, incrementUsage, getUsageStats } from '../../src/db/api-keys.js';
import { loadConfig } from '../../src/config/index.js';

describe('auth', () => {
  beforeAll(() => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql:///screenforge?host=/var/run/postgresql';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    loadConfig();
  });

  afterAll(async () => {
    const pool = getPool();
    const authTestKeyNames = ['Test Key', 'Pro Key', 'Lookup Test', 'Usage Test', 'Stats Test', 'Header Test', 'Bearer Test'];
    const keyResult = await pool.query(
      'SELECT id FROM api_keys WHERE name = ANY($1)',
      [authTestKeyNames],
    );
    const keyIds = keyResult.rows.map((r: { id: string }) => r.id);
    if (keyIds.length > 0) {
      await pool.query('DELETE FROM usage_daily WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM render_jobs WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM batch_jobs WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM api_keys WHERE id = ANY($1)', [keyIds]);
    }
    await closePool();
    resetPool();
  });

  describe('hashApiKey', () => {
    it('produces consistent hashes', () => {
      const hash1 = hashApiKey('sf_test_abc123');
      const hash2 = hashApiKey('sf_test_abc123');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('produces different hashes for different keys', () => {
      const hash1 = hashApiKey('sf_test_abc123');
      const hash2 = hashApiKey('sf_test_xyz789');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('createApiKey', () => {
    it('creates a free tier key with sf_test_ prefix', async () => {
      const result = await createApiKey('Test Key', 'free');
      expect(result.rawKey).toMatch(/^sf_test_/);
      expect(result.key.name).toBe('Test Key');
      expect(result.key.tier).toBe('free');
      expect(result.key.rateLimit).toBe(10);
      expect(result.key.monthlyQuota).toBe(100); // free tier: 100 renders/mo
      expect(result.key.active).toBe(true);
    });

    it('creates a pro tier key with sf_live_ prefix', async () => {
      const result = await createApiKey('Pro Key', 'pro');
      expect(result.rawKey).toMatch(/^sf_live_/);
      expect(result.key.tier).toBe('pro');
      expect(result.key.rateLimit).toBe(200);
      expect(result.key.monthlyQuota).toBe(25000);
    });
  });

  describe('lookupApiKey', () => {
    it('finds a key by raw key string', async () => {
      const created = await createApiKey('Lookup Test', 'starter');
      const found = await lookupApiKey(created.rawKey);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.key.id);
      expect(found!.name).toBe('Lookup Test');
      expect(found!.tier).toBe('starter');
    });

    it('returns null for unknown key', async () => {
      const found = await lookupApiKey('sf_test_nonexistent_key');
      expect(found).toBeNull();
    });
  });

  describe('usage tracking', () => {
    it('increments daily usage', async () => {
      const key = await createApiKey('Usage Test', 'free');
      const count1 = await incrementUsage(key.key.id);
      expect(count1).toBe(1);
      const count2 = await incrementUsage(key.key.id);
      expect(count2).toBe(2);
    });

    it('returns usage stats', async () => {
      const key = await createApiKey('Stats Test', 'free');
      await incrementUsage(key.key.id);
      await incrementUsage(key.key.id);
      await incrementUsage(key.key.id);

      const stats = await getUsageStats(key.key.id);
      expect(stats.today).toBe(3);
      expect(stats.thisMonth).toBe(3);
    });
  });

  describe('auth middleware', () => {
    let app: FastifyInstance;

    afterEach(async () => {
      if (app) await app.close();
    });

    it('allows requests without auth when REQUIRE_AUTH is false', async () => {
      process.env.REQUIRE_AUTH = 'false';
      app = await buildServer({ skipBrowserInit: true });
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    });

    it('rejects requests without api key when REQUIRE_AUTH is true', async () => {
      process.env.REQUIRE_AUTH = 'true';
      app = await buildServer({ skipBrowserInit: true });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        payload: { url: 'https://example.com' },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('AUTH_REQUIRED');
      expect(body.error.request_id).toBeDefined();
      process.env.REQUIRE_AUTH = 'false';
    });

    it('accepts valid api key in x-api-key header', async () => {
      process.env.REQUIRE_AUTH = 'true';
      process.env.ALLOW_PRIVATE_URLS = 'false';
      app = await buildServer({ skipBrowserInit: true });

      const created = await createApiKey('Header Test', 'free');
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': created.rawKey },
        payload: { url: 'https://example.com' },
      });
      // Should not be 401 — will either 400 (SSRF) or try to render
      expect(res.statusCode).not.toBe(401);
      process.env.REQUIRE_AUTH = 'false';
    });

    it('accepts valid api key in Authorization Bearer header', async () => {
      process.env.REQUIRE_AUTH = 'true';
      process.env.ALLOW_PRIVATE_URLS = 'false';
      app = await buildServer({ skipBrowserInit: true });

      const created = await createApiKey('Bearer Test', 'free');
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { authorization: `Bearer ${created.rawKey}` },
        payload: { url: 'https://example.com' },
      });
      expect(res.statusCode).not.toBe(401);
      process.env.REQUIRE_AUTH = 'false';
    });

    it('rejects invalid api key', async () => {
      process.env.REQUIRE_AUTH = 'true';
      app = await buildServer({ skipBrowserInit: true });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': 'sf_test_invalid_key' },
        payload: { url: 'https://example.com' },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('INVALID_API_KEY');
      expect(body.error.request_id).toBeDefined();
      process.env.REQUIRE_AUTH = 'false';
    });
  });

  describe('admin routes', () => {
    let app: FastifyInstance;

    afterEach(async () => {
      if (app) await app.close();
    });

    it('rejects POST /v1/keys without admin key', async () => {
      process.env.ADMIN_API_KEY = 'admin-secret-key-long-enough';
      app = await buildServer({ skipBrowserInit: true });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        payload: { name: 'Test', tier: 'free' },
      });
      expect(res.statusCode).toBe(401);
      delete process.env.ADMIN_API_KEY;
    });

    it('creates key via POST /v1/keys with valid admin key', async () => {
      process.env.ADMIN_API_KEY = 'admin-secret-key-long-enough';
      app = await buildServer({ skipBrowserInit: true });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { 'x-api-key': 'admin-secret-key-long-enough' },
        payload: { name: 'Admin Created', tier: 'pro' },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.key).toMatch(/^sf_live_/);
      expect(body.name).toBe('Admin Created');
      expect(body.tier).toBe('pro');
      delete process.env.ADMIN_API_KEY;
    });

    it('lists keys via GET /v1/keys', async () => {
      process.env.ADMIN_API_KEY = 'admin-secret-key-long-enough';
      app = await buildServer({ skipBrowserInit: true });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/keys',
        headers: { 'x-api-key': 'admin-secret-key-long-enough' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.keys).toBeDefined();
      expect(Array.isArray(body.keys)).toBe(true);
      delete process.env.ADMIN_API_KEY;
    });
  });
});
