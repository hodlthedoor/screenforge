import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { getPool } from '../../src/db/index.js';
import type { FastifyInstance } from 'fastify';

function extractCookie(res: { headers: Record<string, string | string[] | undefined> }): string {
  const c = res.headers['set-cookie'];
  return Array.isArray(c) ? c[0] : (c as string);
}

function extractCsrfToken(html: string): string {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match?.[1] ?? '';
}

async function registerAndLogin(app: FastifyInstance, email: string): Promise<string> {
  const regPage = await app.inject({ method: 'GET', url: '/register' });
  const regCsrf = extractCsrfToken(regPage.body);
  const regCookie = extractCookie(regPage);

  await app.inject({
    method: 'POST',
    url: '/register',
    headers: { cookie: regCookie },
    payload: { email, password: 'password123', _csrf: regCsrf },
  });

  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const loginCsrf = extractCsrfToken(loginPage.body);
  const loginCookie = extractCookie(loginPage);

  const loginRes = await app.inject({
    method: 'POST',
    url: '/login',
    headers: { cookie: loginCookie },
    payload: { email, password: 'password123', _csrf: loginCsrf },
  });
  return extractCookie(loginRes);
}

describe('admin panel', () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let regularCookie: string;
  let regularUserId: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-must-be-32-chars!!';
    app = await buildServer({ skipBrowserInit: true });

    // Register admin user
    adminCookie = await registerAndLogin(app, 'admin-test@example.com');

    // Make admin
    const pool = getPool();
    await pool.query("UPDATE users SET is_admin = true WHERE email = 'admin-test@example.com'");

    // Re-login to pick up is_admin flag in session
    const loginPage = await app.inject({ method: 'GET', url: '/login' });
    const loginCsrf = extractCsrfToken(loginPage.body);
    const loginCookie = extractCookie(loginPage);
    const loginRes = await app.inject({
      method: 'POST',
      url: '/login',
      headers: { cookie: loginCookie },
      payload: { email: 'admin-test@example.com', password: 'password123', _csrf: loginCsrf },
    });
    adminCookie = extractCookie(loginRes);

    // Register regular user
    regularCookie = await registerAndLogin(app, 'regular-test@example.com');

    const userResult = await pool.query("SELECT id FROM users WHERE email = 'regular-test@example.com'");
    regularUserId = userResult.rows[0].id;
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query("DELETE FROM user_api_keys WHERE user_id IN (SELECT id FROM users WHERE email IN ('admin-test@example.com', 'regular-test@example.com'))");
    await pool.query("DELETE FROM users WHERE email IN ('admin-test@example.com', 'regular-test@example.com')");
    await app.close();
  });

  describe('auth guard', () => {
    it('rejects unauthenticated access with redirect', async () => {
      const res = await app.inject({ method: 'GET', url: '/admin' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('rejects non-admin users with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/admin',
        headers: { cookie: regularCookie },
      });
      expect(res.statusCode).toBe(403);
      expect(res.body).toContain('Access Denied');
    });

    it('allows admin users', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/admin',
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Admin Dashboard');
    });
  });

  describe('user suspension', () => {
    it('toggles user active status', async () => {
      // Get CSRF token
      const page = await app.inject({
        method: 'GET',
        url: `/admin/users/${regularUserId}`,
        headers: { cookie: adminCookie },
      });
      const csrf = extractCsrfToken(page.body);

      // Suspend
      const suspendRes = await app.inject({
        method: 'POST',
        url: `/admin/users/${regularUserId}/suspend`,
        headers: { cookie: adminCookie },
        payload: { _csrf: csrf },
      });
      expect(suspendRes.statusCode).toBe(302);

      // Verify suspended
      const pool = getPool();
      const result = await pool.query('SELECT active FROM users WHERE id = $1', [regularUserId]);
      expect(result.rows[0].active).toBe(false);

      // Get new CSRF and reactivate
      const page2 = await app.inject({
        method: 'GET',
        url: `/admin/users/${regularUserId}`,
        headers: { cookie: adminCookie },
      });
      const csrf2 = extractCsrfToken(page2.body);

      await app.inject({
        method: 'POST',
        url: `/admin/users/${regularUserId}/suspend`,
        headers: { cookie: adminCookie },
        payload: { _csrf: csrf2 },
      });

      const result2 = await pool.query('SELECT active FROM users WHERE id = $1', [regularUserId]);
      expect(result2.rows[0].active).toBe(true);
    });
  });

  describe('tier change', () => {
    it('changes user tier via API keys', async () => {
      // First create an API key for the regular user
      const keysPage = await app.inject({
        method: 'GET',
        url: '/dashboard/keys',
        headers: { cookie: regularCookie },
      });
      const keysCsrf = extractCsrfToken(keysPage.body);

      await app.inject({
        method: 'POST',
        url: '/dashboard/keys',
        headers: { cookie: regularCookie },
        payload: { name: 'Test Key', tier: 'free', _csrf: keysCsrf },
      });

      // Now change tier as admin
      const adminPage = await app.inject({
        method: 'GET',
        url: `/admin/users/${regularUserId}`,
        headers: { cookie: adminCookie },
      });
      const adminCsrf = extractCsrfToken(adminPage.body);

      const res = await app.inject({
        method: 'POST',
        url: `/admin/users/${regularUserId}/tier`,
        headers: { cookie: adminCookie },
        payload: { tier: 'pro', _csrf: adminCsrf },
      });
      expect(res.statusCode).toBe(302);

      // Verify tier changed on API key
      const pool = getPool();
      const keyResult = await pool.query(
        `SELECT ak.tier FROM api_keys ak JOIN user_api_keys uak ON uak.api_key_id = ak.id WHERE uak.user_id = $1`,
        [regularUserId],
      );
      expect(keyResult.rows[0]?.tier).toBe('pro');
    });
  });

  describe('queue retry', () => {
    it('retries a failed job', async () => {
      const pool = getPool();

      // Insert a fake failed job - need a real api_key_id
      const keyResult = await pool.query(
        `SELECT ak.id FROM api_keys ak JOIN user_api_keys uak ON uak.api_key_id = ak.id WHERE uak.user_id = $1 LIMIT 1`,
        [regularUserId],
      );
      const apiKeyId = keyResult.rows[0]?.id;

      const jobResult = await pool.query(
        `INSERT INTO render_jobs (api_key_id, type, url, status, error) VALUES ($1, 'screenshot', 'https://example.com', 'failed', 'test error') RETURNING id`,
        [apiKeyId],
      );
      const jobId = jobResult.rows[0].id;

      // Get CSRF token
      const queuePage = await app.inject({
        method: 'GET',
        url: '/admin/queue',
        headers: { cookie: adminCookie },
      });
      const csrf = extractCsrfToken(queuePage.body);

      const res = await app.inject({
        method: 'POST',
        url: `/admin/queue/${jobId}/retry`,
        headers: { cookie: adminCookie },
        payload: { _csrf: csrf },
      });
      expect(res.statusCode).toBe(302);

      // Verify job status reset
      const updated = await pool.query('SELECT status FROM render_jobs WHERE id = $1', [jobId]);
      expect(updated.rows[0].status).toBe('pending');

      // Cleanup
      await pool.query('DELETE FROM render_jobs WHERE id = $1', [jobId]);
    });
  });
});
