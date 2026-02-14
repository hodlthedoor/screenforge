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

describe('admin routes — page rendering', () => {
  let app: FastifyInstance;
  let adminCookie: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-must-be-32-chars!!';
    app = await buildServer({ skipBrowserInit: true });

    // Register admin
    const regPage = await app.inject({ method: 'GET', url: '/register' });
    const regCsrf = extractCsrfToken(regPage.body);
    const regCookie = extractCookie(regPage);

    await app.inject({
      method: 'POST',
      url: '/register',
      headers: { cookie: regCookie },
      payload: { email: 'admin-routes@example.com', password: 'password123', _csrf: regCsrf },
    });

    const pool = getPool();
    await pool.query("UPDATE users SET is_admin = true WHERE email = 'admin-routes@example.com'");

    // Login
    const loginPage = await app.inject({ method: 'GET', url: '/login' });
    const loginCsrf = extractCsrfToken(loginPage.body);
    const loginCookie = extractCookie(loginPage);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/login',
      headers: { cookie: loginCookie },
      payload: { email: 'admin-routes@example.com', password: 'password123', _csrf: loginCsrf },
    });
    adminCookie = extractCookie(loginRes);

    // Create some test users for pagination/search
    for (let i = 0; i < 3; i++) {
      const page = await app.inject({ method: 'GET', url: '/register' });
      const csrf = extractCsrfToken(page.body);
      const cookie = extractCookie(page);
      await app.inject({
        method: 'POST',
        url: '/register',
        headers: { cookie },
        payload: { email: `search-user-${i}@example.com`, password: 'password123', _csrf: csrf },
      });
    }
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query("DELETE FROM user_api_keys WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%routes@example.com' OR email LIKE 'search-user-%')");
    await pool.query("DELETE FROM users WHERE email LIKE '%routes@example.com' OR email LIKE 'search-user-%'");
    await app.close();
  });

  describe('dashboard page', () => {
    it('GET /admin returns 200 with stats', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/admin',
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Total Users');
      expect(res.body).toContain('Renders Today');
      expect(res.body).toContain('Queue Depth');
      expect(res.body).toContain('Storage Used');
    });
  });

  describe('users page', () => {
    it('GET /admin/users renders user list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/users',
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Users');
      expect(res.body).toContain('admin-routes@example.com');
    });

    it('supports search by email', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/users?search=search-user',
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('search-user-0@example.com');
      expect(res.body).toContain('search-user-1@example.com');
      expect(res.body).toContain('search-user-2@example.com');
      // Admin user should not appear in search results
      expect(res.body).not.toContain('admin-routes@example.com');
    });

    it('supports pagination parameter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/users?page=1',
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      // With few users, pagination links won't show but page renders successfully
      expect(res.body).toContain('total)');
    });
  });

  describe('user detail page', () => {
    it('GET /admin/users/:id shows user detail', async () => {
      const pool = getPool();
      const result = await pool.query("SELECT id FROM users WHERE email = 'search-user-0@example.com'");
      const userId = result.rows[0].id;

      const res = await app.inject({
        method: 'GET',
        url: `/admin/users/${userId}`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('search-user-0@example.com');
      expect(res.body).toContain('Suspend User');
      expect(res.body).toContain('Change Tier');
    });

    it('returns 404 for non-existent user', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/users/00000000-0000-0000-0000-000000000000',
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain('Not Found');
    });
  });

  describe('queue page', () => {
    it('GET /admin/queue renders queue stats', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/queue',
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Queue Management');
      expect(res.body).toContain('Waiting');
      expect(res.body).toContain('Active');
      expect(res.body).toContain('Completed');
      expect(res.body).toContain('Failed');
    });
  });

  describe('storage page', () => {
    it('GET /admin/storage renders storage stats', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/storage',
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Storage');
      expect(res.body).toContain('Disk Usage');
      expect(res.body).toContain('Cache Hit Rate');
      expect(res.body).toContain('Run Cleanup');
    });
  });
});
