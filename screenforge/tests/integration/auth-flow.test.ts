import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import { getPool, closePool, resetPool } from '../../src/db/index.js';
import { loadConfig } from '../../src/config/index.js';

/**
 * Integration test for the full register → login → session → dashboard flow.
 * Uses real HTTP with cookies to verify the session auth pipeline end-to-end.
 */
describe('auth flow integration', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const testEmail = `auth-flow-test-${Date.now()}@test.local`;
  const testPassword = 'securepassword123';

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql:///screenforge_test?host=/var/run/postgresql';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    loadConfig();
    app = await buildServer({ skipBrowserInit: true });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.addresses()[0];
    baseUrl = `http://${addr.address}:${addr.port}`;
  });

  afterAll(async () => {
    // Clean up test user
    const pool = getPool();
    await pool.query('DELETE FROM users WHERE email = $1', [testEmail]);
    await app.close();
    await closePool();
    resetPool();
  });

  /** Extract Set-Cookie session cookie value from response */
  function extractSessionCookie(res: Response): string {
    const setCookies = res.headers.getSetCookie();
    const sessionCookie = setCookies.find(c => c.startsWith('sessionId='));
    return sessionCookie ? sessionCookie.split(';')[0] : '';
  }

  /** Extract CSRF token from HTML form */
  function extractCsrfToken(html: string): string {
    const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
    return match ? match[1] : '';
  }

  it('GET /register returns registration form with CSRF token', async () => {
    const res = await fetch(`${baseUrl}/register`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Create Account');
    expect(html).toContain('name="_csrf"');
    const csrf = extractCsrfToken(html);
    expect(csrf).toBeTruthy();
  });

  it('POST /register without CSRF returns 403', async () => {
    // First get a session
    const getRes = await fetch(`${baseUrl}/register`);
    const cookie = extractSessionCookie(getRes);

    const res = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie,
      },
      body: `email=${testEmail}&password=${testPassword}&_csrf=invalid-token`,
      redirect: 'manual',
    });
    expect(res.status).toBe(403);
  });

  it('full register → login → dashboard flow with session cookies', async () => {
    // Step 1: GET /register to obtain CSRF token and session cookie
    const registerPage = await fetch(`${baseUrl}/register`);
    expect(registerPage.status).toBe(200);
    const registerHtml = await registerPage.text();
    const registerCsrf = extractCsrfToken(registerHtml);
    const registerCookie = extractSessionCookie(registerPage);
    expect(registerCsrf).toBeTruthy();
    expect(registerCookie).toBeTruthy();

    // Step 2: POST /register with valid CSRF and credentials
    const registerRes = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: registerCookie,
      },
      body: `email=${encodeURIComponent(testEmail)}&password=${encodeURIComponent(testPassword)}&_csrf=${encodeURIComponent(registerCsrf)}`,
      redirect: 'manual',
    });
    // Should redirect to /dashboard
    expect(registerRes.status).toBe(302);
    expect(registerRes.headers.get('location')).toBe('/dashboard');

    // Capture the authenticated session cookie
    const authCookie = extractSessionCookie(registerRes) || registerCookie;

    // Step 3: Follow redirect to /dashboard with session cookie
    const dashboardRes = await fetch(`${baseUrl}/dashboard`, {
      headers: { Cookie: authCookie },
      redirect: 'manual',
    });
    // Should get 200 (dashboard page) — NOT a redirect to /login
    expect(dashboardRes.status).toBe(200);
    const dashboardHtml = await dashboardRes.text();
    expect(dashboardHtml).toContain('Dashboard');

    // Step 4: POST /logout to end session
    const logoutRes = await fetch(`${baseUrl}/logout`, {
      method: 'POST',
      headers: { Cookie: authCookie },
      redirect: 'manual',
    });
    expect(logoutRes.status).toBe(302);

    // Step 5: Verify dashboard is now inaccessible (redirect to /login)
    const postLogoutDash = await fetch(`${baseUrl}/dashboard`, {
      headers: { Cookie: authCookie },
      redirect: 'manual',
    });
    expect(postLogoutDash.status).toBe(302);
    expect(postLogoutDash.headers.get('location')).toBe('/login');

    // Step 6: GET /login to get fresh CSRF token
    const loginPage = await fetch(`${baseUrl}/login`);
    expect(loginPage.status).toBe(200);
    const loginHtml = await loginPage.text();
    const loginCsrf = extractCsrfToken(loginHtml);
    const loginCookie = extractSessionCookie(loginPage);
    expect(loginCsrf).toBeTruthy();

    // Step 7: POST /login with valid credentials
    const loginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: loginCookie,
      },
      body: `email=${encodeURIComponent(testEmail)}&password=${encodeURIComponent(testPassword)}&_csrf=${encodeURIComponent(loginCsrf)}`,
      redirect: 'manual',
    });
    expect(loginRes.status).toBe(302);
    expect(loginRes.headers.get('location')).toBe('/dashboard');

    // Step 8: Verify dashboard is accessible again
    const loginAuthCookie = extractSessionCookie(loginRes) || loginCookie;
    const dashAfterLogin = await fetch(`${baseUrl}/dashboard`, {
      headers: { Cookie: loginAuthCookie },
      redirect: 'manual',
    });
    expect(dashAfterLogin.status).toBe(200);
  });

  it('POST /login with wrong password returns 401', async () => {
    const loginPage = await fetch(`${baseUrl}/login`);
    const loginHtml = await loginPage.text();
    const csrf = extractCsrfToken(loginHtml);
    const cookie = extractSessionCookie(loginPage);

    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie,
      },
      body: `email=${encodeURIComponent(testEmail)}&password=wrongpassword&_csrf=${encodeURIComponent(csrf)}`,
      redirect: 'manual',
    });
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain('Invalid email or password');
  });

  it('POST /register with duplicate email returns 409', async () => {
    const registerPage = await fetch(`${baseUrl}/register`);
    const registerHtml = await registerPage.text();
    const csrf = extractCsrfToken(registerHtml);
    const cookie = extractSessionCookie(registerPage);

    const res = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie,
      },
      body: `email=${encodeURIComponent(testEmail)}&password=${encodeURIComponent(testPassword)}&_csrf=${encodeURIComponent(csrf)}`,
      redirect: 'manual',
    });
    expect(res.status).toBe(409);
    const html = await res.text();
    expect(html).toContain('Email already registered');
  });
});
