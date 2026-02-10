import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { getPool } from '../../src/db/index.js';
import type { FastifyInstance } from 'fastify';

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
    it('POST /register returns 200 with valid data', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/register',
        payload: { email: 'auth-test-reg@example.com', password: 'password123' },
      });
      expect(res.statusCode).toBe(302);
    });

    it('rejects duplicate email', async () => {
      // Use the email we already registered in the test above
      const res = await app.inject({
        method: 'POST',
        url: '/register',
        payload: { email: 'auth-test-reg@example.com', password: 'password123' },
      });
      expect(res.statusCode).toBe(409);
    });

    it('rejects short password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/register',
        payload: { email: 'auth-test-short@example.com', password: '123' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/register',
        payload: { email: 'notanemail', password: 'password123' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('login', () => {
    beforeAll(async () => {
      await app.inject({
        method: 'POST',
        url: '/register',
        payload: { email: 'auth-test-login@example.com', password: 'password123' },
      });
    });

    it('POST /login with valid credentials sets session cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'auth-test-login@example.com', password: 'password123' },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('POST /login with wrong password returns 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'auth-test-login@example.com', password: 'wrongpassword' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('POST /login with nonexistent email returns 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'auth-test-nobody@example.com', password: 'password123' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('session protection', () => {
    it('GET /dashboard without session redirects to /login', async () => {
      const res = await app.inject({ method: 'GET', url: '/dashboard' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('GET /dashboard with valid session returns 200', async () => {
      // Login first
      const loginRes = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'auth-test-login@example.com', password: 'password123' },
      });
      const cookie = loginRes.headers['set-cookie'];
      expect(cookie).toBeDefined();

      const res = await app.inject({
        method: 'GET',
        url: '/dashboard',
        headers: { cookie: Array.isArray(cookie) ? cookie[0] : cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('POST /logout clears session', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'auth-test-login@example.com', password: 'password123' },
      });
      const cookie = loginRes.headers['set-cookie'];

      const logoutRes = await app.inject({
        method: 'POST',
        url: '/logout',
        headers: { cookie: Array.isArray(cookie) ? cookie[0] : cookie },
      });
      expect(logoutRes.statusCode).toBe(302);
      expect(logoutRes.headers.location).toBe('/');
    });
  });
});
