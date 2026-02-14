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

describe('dashboard API key CRUD', () => {
  let app: FastifyInstance;
  let sessionCookie: string;

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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_api_keys (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        api_key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, api_key_id)
      )
    `);

    // Register with CSRF
    const regPage = await app.inject({ method: 'GET', url: '/register' });
    const regCsrf = extractCsrfToken(regPage.body);
    const regCookie = extractCookie(regPage);

    await app.inject({
      method: 'POST',
      url: '/register',
      headers: { cookie: regCookie },
      payload: { email: 'keys-test@example.com', password: 'password123', _csrf: regCsrf },
    });

    // Login with CSRF
    const loginPage = await app.inject({ method: 'GET', url: '/login' });
    const loginCsrf = extractCsrfToken(loginPage.body);
    const loginCookie = extractCookie(loginPage);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/login',
      headers: { cookie: loginCookie },
      payload: { email: 'keys-test@example.com', password: 'password123', _csrf: loginCsrf },
    });
    sessionCookie = extractCookie(loginRes);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query("DELETE FROM user_api_keys WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%keys-test%')");
    await pool.query("DELETE FROM users WHERE email LIKE '%keys-test%'");
    await app.close();
  });

  it('GET /dashboard/keys returns HTML with key list and CSRF token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/keys',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('API Keys');
    expect(res.body).toContain('name="_csrf"');
  });

  it('POST /dashboard/keys creates a new key and flash shows raw key', async () => {
    // Get CSRF from dashboard keys page
    const keysPage = await app.inject({
      method: 'GET',
      url: '/dashboard/keys',
      headers: { cookie: sessionCookie },
    });
    const csrf = extractCsrfToken(keysPage.body);
    // Update cookie if session changed
    const updatedCookie = extractCookie(keysPage) || sessionCookie;

    const res = await app.inject({
      method: 'POST',
      url: '/dashboard/keys',
      headers: { cookie: updatedCookie },
      payload: { name: 'Test Key', tier: 'free', _csrf: csrf },
    });
    // Should redirect back to keys page
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/dashboard/keys');

    // Follow redirect to see flash-based key display
    const redirectCookie = extractCookie(res) || updatedCookie;
    const keysPageAfter = await app.inject({
      method: 'GET',
      url: '/dashboard/keys',
      headers: { cookie: redirectCookie },
    });
    expect(keysPageAfter.statusCode).toBe(200);
    expect(keysPageAfter.body).toContain('key-display');
    expect(keysPageAfter.body).toContain('Copy this key now');

    // Update session cookie for subsequent tests
    sessionCookie = extractCookie(keysPageAfter) || redirectCookie;
  });

  it('POST /dashboard/keys/:id/revoke deactivates a key', async () => {
    // Create a key first
    const keysPage = await app.inject({
      method: 'GET',
      url: '/dashboard/keys',
      headers: { cookie: sessionCookie },
    });
    const csrf = extractCsrfToken(keysPage.body);
    const updatedCookie = extractCookie(keysPage) || sessionCookie;

    const createRes = await app.inject({
      method: 'POST',
      url: '/dashboard/keys',
      headers: { cookie: updatedCookie },
      payload: { name: 'Revoke Me', tier: 'free', _csrf: csrf },
    });
    sessionCookie = extractCookie(createRes) || updatedCookie;

    // Get the key ID from the database
    const pool = getPool();
    const keysResult = await pool.query(
      `SELECT ak.id FROM api_keys ak
       JOIN user_api_keys uak ON uak.api_key_id = ak.id
       JOIN users u ON u.id = uak.user_id
       WHERE u.email = 'keys-test@example.com' AND ak.name = 'Revoke Me'`
    );
    const keyId = keysResult.rows[0]?.id;
    expect(keyId).toBeDefined();

    // Get fresh CSRF for revoke
    const revokeKeysPage = await app.inject({
      method: 'GET',
      url: '/dashboard/keys',
      headers: { cookie: sessionCookie },
    });
    const revokeCsrf = extractCsrfToken(revokeKeysPage.body);
    const revokeCookie = extractCookie(revokeKeysPage) || sessionCookie;

    const revokeRes = await app.inject({
      method: 'POST',
      url: `/dashboard/keys/${keyId}/revoke`,
      headers: { cookie: revokeCookie },
      payload: { _csrf: revokeCsrf },
    });
    expect([200, 302]).toContain(revokeRes.statusCode);

    // Verify key is deactivated
    const checkResult = await pool.query('SELECT active FROM api_keys WHERE id = $1', [keyId]);
    expect(checkResult.rows[0].active).toBe(false);

    sessionCookie = extractCookie(revokeRes) || revokeCookie;
  });

  it('requires auth for all dashboard key routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/keys' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('POST /dashboard/keys without CSRF is rejected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dashboard/keys',
      headers: { cookie: sessionCookie },
      payload: { name: 'No CSRF Key', tier: 'free' },
    });
    expect(res.statusCode).toBe(403);
  });
});
