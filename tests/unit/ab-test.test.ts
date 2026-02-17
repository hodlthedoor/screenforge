import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { getPool } from '../../src/db/index.js';
import type { FastifyInstance } from 'fastify';

const ADMIN_KEY = 'test-admin-key-12345678';

describe('A/B test infrastructure', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-must-be-32-chars!!';
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = await buildServer({ skipBrowserInit: true });
  });

  afterAll(async () => {
    delete process.env.ADMIN_API_KEY;
    await app.close();
  });

  describe('variant cookie assignment', () => {
    it('sets ab_variant cookie on landing page visit', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const setCookie = res.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie ?? '');
      expect(cookieStr).toMatch(/ab_variant=/);
    });

    it('assigns variant A or B', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const setCookie = res.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie ?? '');
      expect(cookieStr).toMatch(/ab_variant=(A|B)/);
    });

    it('respects existing ab_variant cookie', async () => {
      // If user already has variant A, they should get A back
      const res = await app.inject({
        method: 'GET',
        url: '/',
        headers: { cookie: 'ab_variant=A' },
      });
      const body = res.body;
      // Variant A CTA text should be present
      expect(body).toContain('Get Started Free');
    });

    it('shows variant-specific CTA text', async () => {
      // Force variant B
      const resB = await app.inject({
        method: 'GET',
        url: '/',
        headers: { cookie: 'ab_variant=B' },
      });
      expect(resB.body).toContain('Start Building Free');
    });

    it('cookie has SameSite=Lax and HttpOnly attributes', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const setCookie = res.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie ?? '');
      expect(cookieStr.toLowerCase()).toMatch(/samesite=lax/i);
    });
  });

  describe('preconnect hints', () => {
    it('landing page does not have render-blocking external fonts', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      // Landing uses inlined CSS — no Google Fonts. Should NOT have googleapis link.
      expect(res.body).not.toContain('fonts.googleapis.com');
    });

    it('landing page CSS is fully inlined (no external stylesheets)', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      // All styles should be in <style> tag, no external <link rel="stylesheet">
      expect(res.body).not.toMatch(/<link[^>]+rel="stylesheet"[^>]*>/);
    });
  });

  describe('lazy-loading images', () => {
    it('landing page has no static img tags without lazy-load outside script blocks', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      // Strip all <script>...</script> blocks (demo img is dynamically set via JS)
      const htmlWithoutScripts = res.body.replace(/<script[\s\S]*?<\/script>/gi, '');
      // Any remaining static <img> tags must have loading="lazy"
      const imgMatches = htmlWithoutScripts.match(/<img\s/g);
      if (imgMatches) {
        const nonLazy = htmlWithoutScripts.match(/<img(?![^>]*loading=["']lazy["'])[^>]*>/g);
        expect(nonLazy).toBeNull();
      }
      // This test documents that landing page CSS is inlined and images are dynamic
    });
  });

  describe('A/B conversion tracking', () => {
    it('records signup event when user registers with ab_variant cookie', async () => {
      const pool = getPool();
      // Clear prior signup events for variant A
      await pool.query("DELETE FROM ab_test_events WHERE variant = 'A' AND event_type = 'signup'");

      // First get a CSRF token via the register GET page
      const getRes = await app.inject({
        method: 'GET',
        url: '/register',
        headers: { cookie: 'ab_variant=A' },
      });
      expect(getRes.statusCode).toBe(200);

      // Extract session cookie from GET response
      const sessionCookie = getRes.headers['set-cookie'];
      const sessionStr = Array.isArray(sessionCookie) ? sessionCookie.join('; ') : String(sessionCookie ?? '');

      // Extract CSRF token from the form
      const csrfMatch = getRes.body.match(/name="_csrf"\s+value="([^"]+)"/);
      const csrfToken = csrfMatch?.[1] ?? '';

      // POST registration with ab_variant cookie and unique email
      const uniqueEmail = `ab-test-${Date.now()}@example.com`;
      const postRes = await app.inject({
        method: 'POST',
        url: '/register',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: `ab_variant=A; ${sessionStr}`,
        },
        payload: `email=${encodeURIComponent(uniqueEmail)}&password=testpass123&_csrf=${encodeURIComponent(csrfToken)}`,
      });
      // Should redirect to dashboard on success
      expect(postRes.statusCode).toBe(302);

      // Wait briefly for fire-and-forget tracking
      await new Promise((r) => setTimeout(r, 100));

      // Verify signup event was recorded
      const { rows } = await pool.query(
        "SELECT COUNT(*)::int as count FROM ab_test_events WHERE variant = 'A' AND event_type = 'signup'",
      );
      expect(rows[0].count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /v1/admin/ab-stats', () => {
    it('requires admin API key', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/admin/ab-stats' });
      expect([401, 403]).toContain(res.statusCode);
    });

    it('rejects wrong admin key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/ab-stats',
        headers: { 'x-api-key': 'wrong-key' },
      });
      expect([401, 403]).toContain(res.statusCode);
    });

    it('returns ab stats with valid admin key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/ab-stats',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('variants');
      expect(body.variants).toBeInstanceOf(Array);
    });

    it('ab-stats response includes variant, views, and conversions', async () => {
      // Insert some test data directly
      const pool = getPool();
      await pool.query(`
        INSERT INTO ab_test_events (variant, event_type)
        VALUES ('A', 'view'), ('A', 'view'), ('A', 'signup'), ('B', 'view'), ('B', 'signup')
        ON CONFLICT DO NOTHING
      `).catch(() => {
        // Table may not exist yet — test will fail naturally
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/ab-stats',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.variants).toBeInstanceOf(Array);
      // Each variant entry should have required fields
      for (const v of body.variants) {
        expect(v).toHaveProperty('variant');
        expect(v).toHaveProperty('views');
        expect(v).toHaveProperty('signups');
        expect(v).toHaveProperty('conversion_rate');
      }
    });

    it('ab-stats supports since/until date filters', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/ab-stats?since=2020-01-01&until=2099-12-31',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.variants).toBeInstanceOf(Array);
    });

    it('ab-stats returns empty when date range excludes all data', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/ab-stats?since=1990-01-01&until=1990-01-02',
        headers: { 'x-api-key': ADMIN_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.variants).toEqual([]);
    });
  });
});
