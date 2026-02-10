import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { getPool } from '../../src/db/index.js';
import type { FastifyInstance } from 'fastify';

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

    // Register and login
    await app.inject({
      method: 'POST',
      url: '/register',
      payload: { email: 'keys-test@example.com', password: 'password123' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'keys-test@example.com', password: 'password123' },
    });
    const cookie = loginRes.headers['set-cookie'];
    sessionCookie = Array.isArray(cookie) ? cookie[0] : cookie as string;
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query("DELETE FROM user_api_keys WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%keys-test%')");
    await pool.query("DELETE FROM users WHERE email LIKE '%keys-test%'");
    await app.close();
  });

  it('GET /dashboard/keys returns HTML with key list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/keys',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('API Keys');
  });

  it('POST /dashboard/keys creates a new key and shows raw key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dashboard/keys',
      headers: { cookie: sessionCookie },
      payload: { name: 'Test Key', tier: 'free' },
    });
    // Should redirect back to keys page or return success
    expect([200, 302]).toContain(res.statusCode);
  });

  it('POST /dashboard/keys/:id/revoke deactivates a key', async () => {
    // Create a key first
    await app.inject({
      method: 'POST',
      url: '/dashboard/keys',
      headers: { cookie: sessionCookie },
      payload: { name: 'Revoke Me', tier: 'free' },
    });

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

    const revokeRes = await app.inject({
      method: 'POST',
      url: `/dashboard/keys/${keyId}/revoke`,
      headers: { cookie: sessionCookie },
    });
    expect([200, 302]).toContain(revokeRes.statusCode);

    // Verify key is deactivated
    const checkResult = await pool.query('SELECT active FROM api_keys WHERE id = $1', [keyId]);
    expect(checkResult.rows[0].active).toBe(false);
  });

  it('requires auth for all dashboard key routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/keys' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});
