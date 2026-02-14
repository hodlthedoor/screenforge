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

describe('dashboard enhancements', () => {
  let app: FastifyInstance;
  let sessionCookie: string;
  let apiKeyId: string;
  let userId: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-must-be-32-chars!!';
    app = await buildServer({ skipBrowserInit: true });

    const pool = getPool();

    // Ensure tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_api_keys (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        api_key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, api_key_id)
      )
    `);

    // Register + login
    const regPage = await app.inject({ method: 'GET', url: '/register' });
    const regCsrf = extractCsrfToken(regPage.body);
    const regCookie = extractCookie(regPage);

    await app.inject({
      method: 'POST',
      url: '/register',
      headers: { cookie: regCookie },
      payload: { email: 'dash-enhanced@example.com', password: 'password123', _csrf: regCsrf },
    });

    const loginPage = await app.inject({ method: 'GET', url: '/login' });
    const loginCsrf = extractCsrfToken(loginPage.body);
    const loginCookie = extractCookie(loginPage);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/login',
      headers: { cookie: loginCookie },
      payload: { email: 'dash-enhanced@example.com', password: 'password123', _csrf: loginCsrf },
    });
    sessionCookie = extractCookie(loginRes);

    // Get user ID and create API key linked to user
    const userResult = await pool.query("SELECT id FROM users WHERE email = 'dash-enhanced@example.com'");
    userId = userResult.rows[0].id;

    const keyResult = await createApiKey('enhanced-test-key', 'free');
    apiKeyId = keyResult.key.id;
    await pool.query('INSERT INTO user_api_keys (user_id, api_key_id) VALUES ($1, $2)', [userId, apiKeyId]);

    // Seed render_jobs (mix of completed and failed)
    await pool.query(
      `INSERT INTO render_jobs (api_key_id, type, url, status, duration_ms, created_at, error)
       VALUES
         ($1, 'screenshot', 'https://example.com', 'completed', 450, NOW() - INTERVAL '1 day', NULL),
         ($1, 'pdf', 'https://docs.example.com', 'completed', 800, NOW() - INTERVAL '2 days', NULL),
         ($1, 'og', 'https://blog.example.com', 'completed', 200, NOW() - INTERVAL '3 days', NULL),
         ($1, 'screenshot', 'https://fail1.example.com', 'failed', NULL, NOW() - INTERVAL '1 hour', 'Navigation timeout'),
         ($1, 'pdf', 'https://fail2.example.com', 'failed', NULL, NOW() - INTERVAL '2 hours', 'PDF generation error')`,
      [apiKeyId],
    );

    // Seed webhook_deliveries
    await pool.query(
      `INSERT INTO webhook_deliveries (api_key_id, url, payload, status, attempts, last_status_code, last_error, created_at)
       VALUES
         ($1, 'https://hook.example.com/a', '{"event":"render.completed"}', 'delivered', 1, 200, NULL, NOW() - INTERVAL '1 hour'),
         ($1, 'https://hook.example.com/b', '{"event":"render.completed"}', 'failed', 5, 500, 'Internal Server Error', NOW() - INTERVAL '2 hours'),
         ($1, 'https://hook.example.com/c', '{"event":"render.completed"}', 'pending', 0, NULL, NULL, NOW() - INTERVAL '30 minutes')`,
      [apiKeyId],
    );
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM webhook_deliveries WHERE api_key_id = $1', [apiKeyId]);
    await pool.query('DELETE FROM render_jobs WHERE api_key_id = $1', [apiKeyId]);
    await pool.query('DELETE FROM user_api_keys WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM api_keys WHERE id = $1', [apiKeyId]);
    await pool.query("DELETE FROM users WHERE email = 'dash-enhanced@example.com'");
    await app.close();
  });

  describe('GET /dashboard/webhooks (webhook delivery log)', () => {
    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/dashboard/webhooks' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('returns HTML with webhook deliveries table', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/webhooks',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Webhook Deliveries');
      expect(res.body).toContain('hook.example.com');
    });

    it('supports status filter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/webhooks?status=failed',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('failed');
      // Should contain only the failed delivery URL
      expect(res.body).toContain('hook.example.com/b');
    });

    it('supports pagination with page param', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/webhooks?page=1',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Webhook Deliveries');
    });
  });

  describe('GET /dashboard/usage/export', () => {
    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/dashboard/usage/export?format=json' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('exports JSON with correct content-type and shape', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/usage/export?format=json',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['content-disposition']).toContain('attachment');

      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
      // Each row should have standard render_job fields
      expect(body[0]).toHaveProperty('id');
      expect(body[0]).toHaveProperty('type');
      expect(body[0]).toHaveProperty('url');
      expect(body[0]).toHaveProperty('status');
      expect(body[0]).toHaveProperty('created_at');
    });

    it('exports CSV with correct content-type and header row', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/usage/export?format=csv',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');

      const lines = res.body.split('\n');
      expect(lines[0]).toContain('id');
      expect(lines[0]).toContain('type');
      expect(lines[0]).toContain('url');
      expect(lines[0]).toContain('status');
      // Should have data rows
      expect(lines.length).toBeGreaterThan(1);
    });

    it('returns 400 for invalid format', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/usage/export?format=xml',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /dashboard/usage (Chart.js + auto-refresh + errors)', () => {
    it('includes Chart.js CDN script tag', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/usage',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('chart.js');
    });

    it('includes auto-refresh toggle checkbox', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/usage',
        headers: { cookie: sessionCookie },
      });
      expect(res.body).toContain('auto-refresh');
      expect(res.body).toContain('localStorage');
    });

    it('includes recent errors panel with failed renders', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/usage',
        headers: { cookie: sessionCookie },
      });
      expect(res.body).toContain('Recent Errors');
      expect(res.body).toContain('Navigation timeout');
      expect(res.body).toContain('fail1.example.com');
    });

    it('includes export links', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/usage',
        headers: { cookie: sessionCookie },
      });
      expect(res.body).toContain('/dashboard/usage/export');
    });
  });

  describe('GET /dashboard/analytics', () => {
    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/dashboard/analytics' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('returns analytics page with stats, charts, and top URLs', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/analytics',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Analytics');
      expect(res.body).toContain('Renders This Month');
      expect(res.body).toContain('Avg Duration');
      expect(res.body).toContain('Quota Usage');
      expect(res.body).toContain('dailyChart');
      expect(res.body).toContain('typeChart');
      expect(res.body).toContain('Top Rendered URLs');
    });

    it('shows render data from seeded jobs', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/analytics',
        headers: { cookie: sessionCookie },
      });
      // Should contain at least some of the seeded URLs
      expect(res.body).toContain('example.com');
    });
  });

  describe('GET /dashboard/signed-urls', () => {
    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/dashboard/signed-urls' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('returns signed URLs page with form', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/signed-urls',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Signed URLs');
      expect(res.body).toContain('Generate Signed URL');
      expect(res.body).toContain('api-key');
      expect(res.body).toContain('enhanced-test-key');
    });
  });

  describe('POST /dashboard/signed-urls/generate', () => {
    it('requires auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/dashboard/signed-urls/generate',
        payload: { apiKeyId: 'fake', options: { type: 'screenshot', url: 'https://example.com' }, expiry: 3600 },
      });
      expect(res.statusCode).toBe(302);
    });

    it('returns 403 for non-owned API key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/dashboard/signed-urls/generate',
        headers: { cookie: sessionCookie, 'content-type': 'application/json' },
        payload: { apiKeyId: '00000000-0000-0000-0000-000000000000', options: { type: 'screenshot', url: 'https://example.com' }, expiry: 3600 },
      });
      expect(res.statusCode).toBe(403);
    });

    it('generates signed URL for owned API key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/dashboard/signed-urls/generate',
        headers: { cookie: sessionCookie, 'content-type': 'application/json' },
        payload: { apiKeyId: apiKeyId, options: { type: 'screenshot', url: 'https://example.com' }, expiry: 3600 },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('signedUrl');
      expect(body).toHaveProperty('expiresAt');
      expect(body.signedUrl).toContain('signature=');
      expect(body.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe('GET /dashboard/settings', () => {
    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/dashboard/settings' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('returns settings page with account info and forms', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/settings',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Settings');
      expect(res.body).toContain('dash-enhanced@example.com');
      expect(res.body).toContain('Change Password');
      expect(res.body).toContain('Danger Zone');
      expect(res.body).toContain('Delete Account');
    });
  });
});
