import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { getPool } from '../../src/db/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import type { FastifyInstance } from 'fastify';

function extractCookie(res: { headers: Record<string, string | string[] | undefined> }): string {
  const c = res.headers['set-cookie'];
  return Array.isArray(c) ? c[0] : (c as string);
}

function extractCsrfToken(html: string): string {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match?.[1] ?? '';
}

describe('analytics', () => {
  let app: FastifyInstance;
  let rawApiKey: string;
  let apiKeyId: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-must-be-32-chars!!';
    process.env.REQUIRE_AUTH = 'true';
    app = await buildServer({ skipBrowserInit: true });

    // Create test API key and seed some render_jobs
    const result = await createApiKey('analytics-test', 'free');
    rawApiKey = result.rawKey;
    apiKeyId = result.key.id;

    const pool = getPool();

    // Ensure users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Seed render_jobs for analytics
    await pool.query(
      `INSERT INTO render_jobs (api_key_id, type, url, status, duration_ms, created_at)
       VALUES
         ($1, 'screenshot', 'https://example.com', 'completed', 450, NOW() - INTERVAL '1 day'),
         ($1, 'screenshot', 'https://example.com', 'completed', 320, NOW() - INTERVAL '2 days'),
         ($1, 'pdf', 'https://docs.example.com', 'completed', 800, NOW() - INTERVAL '1 day'),
         ($1, 'og', 'https://blog.example.com', 'completed', 200, NOW()),
         ($1, 'screenshot', 'https://example.com', 'completed', 500, NOW())`,
      [apiKeyId],
    );
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM render_jobs WHERE api_key_id = $1', [apiKeyId]);
    await pool.query("DELETE FROM users WHERE email LIKE '%analytics-test%'");
    await pool.query('DELETE FROM api_keys WHERE id = $1', [apiKeyId]);
    await app.close();
    delete process.env.REQUIRE_AUTH;
  });

  describe('GET /v1/analytics (API key auth)', () => {
    it('returns 401 for missing API key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/analytics',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns valid JSON with expected shape', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/analytics',
        headers: { authorization: `Bearer ${rawApiKey}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Verify top-level shape
      expect(body).toHaveProperty('daily');
      expect(body).toHaveProperty('typeBreakdown');
      expect(body).toHaveProperty('topUrls');
      expect(body).toHaveProperty('summary');

      // daily is an array of { date, count, avgDurationMs }
      expect(Array.isArray(body.daily)).toBe(true);
      if (body.daily.length > 0) {
        expect(body.daily[0]).toHaveProperty('date');
        expect(body.daily[0]).toHaveProperty('count');
        expect(body.daily[0]).toHaveProperty('avgDurationMs');
      }

      // typeBreakdown is an array of { type, count }
      expect(Array.isArray(body.typeBreakdown)).toBe(true);

      // topUrls is an array of { url, count, avgDurationMs }
      expect(Array.isArray(body.topUrls)).toBe(true);

      // summary has expected fields
      expect(body.summary).toHaveProperty('totalRendersThisMonth');
      expect(body.summary).toHaveProperty('avgDurationMs');
      expect(body.summary).toHaveProperty('quotaUsagePercent');
    });

    it('returns data matching seeded renders', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/analytics',
        headers: { authorization: `Bearer ${rawApiKey}` },
      });
      const body = JSON.parse(res.body);

      // We seeded 5 renders total
      expect(body.summary.totalRendersThisMonth).toBeGreaterThanOrEqual(5);

      // Type breakdown should include screenshot, pdf, og
      const types = body.typeBreakdown.map((t: { type: string }) => t.type);
      expect(types).toContain('screenshot');
      expect(types).toContain('pdf');
      expect(types).toContain('og');

      // Top URLs should include example.com (3 renders)
      const topUrl = body.topUrls.find((u: { url: string }) => u.url === 'https://example.com');
      expect(topUrl).toBeDefined();
      expect(topUrl.count).toBeGreaterThanOrEqual(3);
    });
  });

  describe('GET /dashboard/analytics (session auth)', () => {
    it('redirects to /login for unauthenticated users', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/analytics',
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('returns 200 for authenticated session', async () => {
      // Register + login
      const regRes = await app.inject({ method: 'GET', url: '/register' });
      const csrf = extractCsrfToken(regRes.body);
      const cookie = extractCookie(regRes);

      await app.inject({
        method: 'POST',
        url: '/register',
        headers: { cookie },
        payload: { email: 'analytics-test@example.com', password: 'password123', _csrf: csrf },
      });

      const loginPage = await app.inject({ method: 'GET', url: '/login' });
      const loginCsrf = extractCsrfToken(loginPage.body);
      const loginCookie = extractCookie(loginPage);

      const loginRes = await app.inject({
        method: 'POST',
        url: '/login',
        headers: { cookie: loginCookie },
        payload: { email: 'analytics-test@example.com', password: 'password123', _csrf: loginCsrf },
      });
      const sessionCookie = extractCookie(loginRes);

      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/analytics',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Analytics');
    });
  });
});
