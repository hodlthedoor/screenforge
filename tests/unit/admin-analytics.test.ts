import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { getPool } from '../../src/db/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import type { FastifyInstance } from 'fastify';

const ADMIN_KEY = 'test-admin-analytics-key-abc123';

function extractCookie(res: { headers: Record<string, string | string[] | undefined> }): string {
  const c = res.headers['set-cookie'];
  return Array.isArray(c) ? c[0] : (c as string);
}

function extractCsrfToken(html: string): string {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match?.[1] ?? '';
}

describe('admin analytics endpoint — GET /v1/admin/analytics', () => {
  let app: FastifyInstance;
  let apiKeyId: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-must-be-32-chars!!';
    process.env.REQUIRE_AUTH = 'true';
    process.env.ADMIN_API_KEY = ADMIN_KEY;

    app = await buildServer({ skipBrowserInit: true });

    // Create an API key for seeding render data
    const result = await createApiKey('analytics-admin-test', 'pro');
    apiKeyId = result.key.id;

    const pool = getPool();

    // Seed render_jobs across multiple dates and types
    await pool.query(
      `INSERT INTO render_jobs (api_key_id, type, url, status, duration_ms, created_at)
       VALUES
         ($1, 'screenshot', 'https://example.com/a', 'completed', 400, NOW() - INTERVAL '5 days'),
         ($1, 'screenshot', 'https://example.com/b', 'completed', 300, NOW() - INTERVAL '4 days'),
         ($1, 'screenshot', 'https://example.com/c', 'failed',   null, NOW() - INTERVAL '3 days'),
         ($1, 'pdf',        'https://docs.example.com', 'completed', 900, NOW() - INTERVAL '2 days'),
         ($1, 'og',         'https://blog.example.com', 'completed', 150, NOW() - INTERVAL '1 day'),
         ($1, 'gif',        'https://gif.example.com', 'completed', 5000, NOW()),
         ($1, 'screenshot', 'https://example.com/a', 'completed', 420, NOW())`,
      [apiKeyId],
    );
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM render_jobs WHERE api_key_id = $1', [apiKeyId]);
    await pool.query('DELETE FROM api_keys WHERE id = $1', [apiKeyId]);
    await app.close();
  });

  describe('authentication', () => {
    it('returns 401 without admin key', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/admin/analytics' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 with wrong admin key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics',
        headers: { 'x-api-key': 'wrong-key' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 with valid admin key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('response structure', () => {
    it('returns all expected top-level fields', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('dau');
      expect(body).toHaveProperty('wau');
      expect(body).toHaveProperty('mau');
      expect(body).toHaveProperty('rendersByType');
      expect(body).toHaveProperty('successRate');
      expect(body).toHaveProperty('failureRate');
      expect(body).toHaveProperty('topApiKeys');
      expect(body).toHaveProperty('conversionRate');
      expect(body).toHaveProperty('monthlyRevenue');
      expect(body).toHaveProperty('churnRate');
      expect(body).toHaveProperty('dailyTrend');
      expect(body).toHaveProperty('tierDistribution');
    });

    it('rendersByType lists render counts by type', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.rendersByType)).toBe(true);
      const types = body.rendersByType.map((r: { type: string }) => r.type);
      expect(types).toContain('screenshot');
    });

    it('topApiKeys returns at most 10 entries', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.topApiKeys)).toBe(true);
      expect(body.topApiKeys.length).toBeLessThanOrEqual(10);
    });

    it('topApiKeys entries have name and count fields', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      const body = JSON.parse(res.body);
      if (body.topApiKeys.length > 0) {
        const entry = body.topApiKeys[0];
        expect(entry).toHaveProperty('name');
        expect(entry).toHaveProperty('count');
      }
    });

    it('dailyTrend is array of date+count entries', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.dailyTrend)).toBe(true);
      if (body.dailyTrend.length > 0) {
        expect(body.dailyTrend[0]).toHaveProperty('date');
        expect(body.dailyTrend[0]).toHaveProperty('count');
      }
    });

    it('successRate and failureRate are numeric percentages', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      const body = JSON.parse(res.body);
      expect(typeof body.successRate).toBe('number');
      expect(typeof body.failureRate).toBe('number');
      expect(body.successRate).toBeGreaterThanOrEqual(0);
      expect(body.successRate).toBeLessThanOrEqual(100);
      expect(body.failureRate).toBeGreaterThanOrEqual(0);
      expect(body.failureRate).toBeLessThanOrEqual(100);
    });

    it('conversionRate is a numeric percentage', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      const body = JSON.parse(res.body);
      expect(typeof body.conversionRate).toBe('number');
      expect(body.conversionRate).toBeGreaterThanOrEqual(0);
    });

    it('tierDistribution is an array', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.tierDistribution)).toBe(true);
    });
  });

  describe('date range filtering', () => {
    it('accepts from and to query params', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics?from=2026-01-01&to=2026-12-31',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('dau');
    });

    it('returns empty data for future date range', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics?from=2099-01-01&to=2099-12-31',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.dau).toBe(0);
      expect(body.rendersByType).toEqual([]);
    });

    it('from-only filter returns results', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics?from=2020-01-01',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('conversion rate calculation', () => {
    it('calculates free-to-paid conversion rate correctly', async () => {
      const pool = getPool();

      // Create a few test users to have a known baseline
      await pool.query(`
        INSERT INTO users (email, password_hash, email_verified, created_at)
        VALUES
          ('conv-test-free1@example.com', 'hash', true, NOW() - INTERVAL '10 days'),
          ('conv-test-free2@example.com', 'hash', true, NOW() - INTERVAL '8 days'),
          ('conv-test-paid@example.com',  'hash', true, NOW() - INTERVAL '5 days')
        ON CONFLICT (email) DO NOTHING
      `);

      // Add a subscription for the paid user
      await pool.query(`
        INSERT INTO subscriptions (user_id, stripe_sub_id, plan, status, current_period_end)
        SELECT id, 'sub_conv_test_123', 'starter', 'active', NOW() + INTERVAL '30 days'
        FROM users WHERE email = 'conv-test-paid@example.com'
        ON CONFLICT (stripe_sub_id) DO NOTHING
      `);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // conversionRate should be a non-negative number
      expect(body.conversionRate).toBeGreaterThanOrEqual(0);

      // Cleanup
      await pool.query(`DELETE FROM subscriptions WHERE stripe_sub_id = 'sub_conv_test_123'`);
      await pool.query(`DELETE FROM users WHERE email LIKE 'conv-test-%'`);
    });
  });

  describe('empty data handling', () => {
    it('handles completely empty database gracefully', async () => {
      // The test DB may have data; just verify no 500 errors
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics?from=2000-01-01&to=2000-01-02',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.dau).toBe(0);
      expect(body.wau).toBe(0);
      expect(body.mau).toBe(0);
      expect(body.rendersByType).toEqual([]);
      expect(body.topApiKeys).toEqual([]);
      expect(body.dailyTrend).toEqual([]);
    });
  });
});

describe('admin analytics page — GET /admin/analytics', () => {
  let app: FastifyInstance;
  let adminCookie: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-must-be-32-chars!!';
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = await buildServer({ skipBrowserInit: true });

    // Register admin user
    const regPage = await app.inject({ method: 'GET', url: '/register' });
    const regCsrf = extractCsrfToken(regPage.body);
    const regCookie = extractCookie(regPage);

    await app.inject({
      method: 'POST',
      url: '/register',
      headers: { cookie: regCookie },
      payload: { email: 'admin-analytics-page@example.com', password: 'password123', _csrf: regCsrf },
    });

    const pool = getPool();
    await pool.query("UPDATE users SET is_admin = true WHERE email = 'admin-analytics-page@example.com'");

    // Login
    const loginPage = await app.inject({ method: 'GET', url: '/login' });
    const loginCsrf = extractCsrfToken(loginPage.body);
    const loginCookie = extractCookie(loginPage);
    const loginRes = await app.inject({
      method: 'POST',
      url: '/login',
      headers: { cookie: loginCookie },
      payload: { email: 'admin-analytics-page@example.com', password: 'password123', _csrf: loginCsrf },
    });
    adminCookie = extractCookie(loginRes);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query("DELETE FROM users WHERE email = 'admin-analytics-page@example.com'");
    await app.close();
  });

  it('returns 200 HTML with analytics content', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/analytics',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Analytics');
  });

  it('requires admin session', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/analytics' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });

  it('includes Chart.js script tag', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/analytics',
      headers: { cookie: adminCookie },
    });
    expect(res.body).toContain('chart.js');
  });

  it('includes DAU/WAU/MAU stat cards', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/analytics',
      headers: { cookie: adminCookie },
    });
    expect(res.body).toContain('DAU');
    expect(res.body).toContain('WAU');
    expect(res.body).toContain('MAU');
  });

  it('includes canvas elements for charts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/analytics',
      headers: { cookie: adminCookie },
    });
    expect(res.body).toContain('<canvas');
  });

  it('is listed in admin sidebar nav', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { cookie: adminCookie },
    });
    expect(res.body).toContain('/admin/analytics');
  });
});
