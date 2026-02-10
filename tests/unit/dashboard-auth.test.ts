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

describe('dashboard auth', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-must-be-32-chars!!';
    app = await buildServer({ skipBrowserInit: true });

    // Ensure users table exists
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query("DELETE FROM users WHERE email LIKE '%auth-test%'");
    await app.close();
  });

  describe('registration', () => {
    it('POST /register returns 302 with valid data', async () => {
      // Get CSRF token first
      const getRes = await app.inject({ method: 'GET', url: '/register' });
      const csrf = extractCsrfToken(getRes.body);
      const cookie = extractCookie(getRes);

      const res = await app.inject({
        method: 'POST',
        url: '/register',
        headers: { cookie },
        payload: { email: 'auth-test-reg@example.com', password: 'password123', _csrf: csrf },
      });
      expect(res.statusCode).toBe(302);
    });

    it('rejects duplicate email with HTML error', async () => {
      const getRes = await app.inject({ method: 'GET', url: '/register' });
      const csrf = extractCsrfToken(getRes.body);
      const cookie = extractCookie(getRes);

      const res = await app.inject({
        method: 'POST',
        url: '/register',
        headers: { cookie },
        payload: { email: 'auth-test-reg@example.com', password: 'password123', _csrf: csrf },
      });
      expect(res.statusCode).toBe(409);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Email already registered');
    });

    it('rejects short password with HTML error', async () => {
      const getRes = await app.inject({ method: 'GET', url: '/register' });
      const csrf = extractCsrfToken(getRes.body);
      const cookie = extractCookie(getRes);

      const res = await app.inject({
        method: 'POST',
        url: '/register',
        headers: { cookie },
        payload: { email: 'auth-test-short@example.com', password: '123', _csrf: csrf },
      });
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Password must be at least 8 characters');
    });

    it('rejects invalid email with HTML error', async () => {
      const getRes = await app.inject({ method: 'GET', url: '/register' });
      const csrf = extractCsrfToken(getRes.body);
      const cookie = extractCookie(getRes);

      const res = await app.inject({
        method: 'POST',
        url: '/register',
        headers: { cookie },
        payload: { email: 'notanemail', password: 'password123', _csrf: csrf },
      });
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Invalid email address');
    });

    it('rejects POST without CSRF token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/register',
        payload: { email: 'auth-test-nocsrf@example.com', password: 'password123' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Invalid form submission');
    });
  });

  describe('login', () => {
    beforeAll(async () => {
      const getRes = await app.inject({ method: 'GET', url: '/register' });
      const csrf = extractCsrfToken(getRes.body);
      const cookie = extractCookie(getRes);

      await app.inject({
        method: 'POST',
        url: '/register',
        headers: { cookie },
        payload: { email: 'auth-test-login@example.com', password: 'password123', _csrf: csrf },
      });
    });

    it('POST /login with valid credentials sets session cookie', async () => {
      const getRes = await app.inject({ method: 'GET', url: '/login' });
      const csrf = extractCsrfToken(getRes.body);
      const cookie = extractCookie(getRes);

      const res = await app.inject({
        method: 'POST',
        url: '/login',
        headers: { cookie },
        payload: { email: 'auth-test-login@example.com', password: 'password123', _csrf: csrf },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('POST /login with wrong password returns 401 HTML', async () => {
      const getRes = await app.inject({ method: 'GET', url: '/login' });
      const csrf = extractCsrfToken(getRes.body);
      const cookie = extractCookie(getRes);

      const res = await app.inject({
        method: 'POST',
        url: '/login',
        headers: { cookie },
        payload: { email: 'auth-test-login@example.com', password: 'wrongpassword', _csrf: csrf },
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Invalid email or password');
    });

    it('POST /login with nonexistent email returns 401 HTML', async () => {
      const getRes = await app.inject({ method: 'GET', url: '/login' });
      const csrf = extractCsrfToken(getRes.body);
      const cookie = extractCookie(getRes);

      const res = await app.inject({
        method: 'POST',
        url: '/login',
        headers: { cookie },
        payload: { email: 'auth-test-nobody@example.com', password: 'password123', _csrf: csrf },
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('POST /login without CSRF returns 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'auth-test-login@example.com', password: 'password123' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('session protection', () => {
    it('GET /dashboard without session redirects to /login', async () => {
      const res = await app.inject({ method: 'GET', url: '/dashboard' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('GET /dashboard with valid session returns 200', async () => {
      const getRes = await app.inject({ method: 'GET', url: '/login' });
      const csrf = extractCsrfToken(getRes.body);
      const cookie = extractCookie(getRes);

      const loginRes = await app.inject({
        method: 'POST',
        url: '/login',
        headers: { cookie },
        payload: { email: 'auth-test-login@example.com', password: 'password123', _csrf: csrf },
      });
      const sessionCookie = extractCookie(loginRes);

      const res = await app.inject({
        method: 'GET',
        url: '/dashboard',
        headers: { cookie: sessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('POST /logout clears session', async () => {
      const getRes = await app.inject({ method: 'GET', url: '/login' });
      const csrf = extractCsrfToken(getRes.body);
      const cookie = extractCookie(getRes);

      const loginRes = await app.inject({
        method: 'POST',
        url: '/login',
        headers: { cookie },
        payload: { email: 'auth-test-login@example.com', password: 'password123', _csrf: csrf },
      });
      const sessionCookie = extractCookie(loginRes);

      const logoutRes = await app.inject({
        method: 'POST',
        url: '/logout',
        headers: { cookie: sessionCookie },
      });
      expect(logoutRes.statusCode).toBe(302);
      expect(logoutRes.headers.location).toBe('/');
    });
  });

  describe('CSRF tokens in forms', () => {
    it('login form contains hidden _csrf field', async () => {
      const res = await app.inject({ method: 'GET', url: '/login' });
      expect(res.body).toContain('name="_csrf"');
      expect(extractCsrfToken(res.body)).toBeTruthy();
    });

    it('register form contains hidden _csrf field', async () => {
      const res = await app.inject({ method: 'GET', url: '/register' });
      expect(res.body).toContain('name="_csrf"');
      expect(extractCsrfToken(res.body)).toBeTruthy();
    });
  });
});
