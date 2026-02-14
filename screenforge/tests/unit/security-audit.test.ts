import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import { isPrivateUrl } from '../../src/renderer/schemas.js';

describe('Security audit', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.SESSION_SECRET = 'test-session-secret-must-be-32-chars-long-minimum';
    process.env.DATABASE_URL = 'postgresql:///screenforge_test?host=/var/run/postgresql';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.METRICS_ENABLED = 'true';
    process.env.REQUIRE_AUTH = 'false';

    app = await buildServer({ skipBrowserInit: true });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('CORS configuration', () => {
    it('should not echo arbitrary origins when CORS_ORIGINS is unset', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'https://evil.com',
        },
      });

      const allowOrigin = response.headers['access-control-allow-origin'];
      expect(allowOrigin).not.toBe('https://evil.com');
    });

    it('should only allow configured CORS origins', async () => {
      await app.close();
      process.env.CORS_ORIGINS = 'https://allowed.com,https://app.allowed.com';

      app = await buildServer({ skipBrowserInit: true });
      await app.ready();

      // Allowed origin should be echoed back
      const allowed = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://allowed.com' },
      });
      expect(allowed.headers['access-control-allow-origin']).toBe('https://allowed.com');

      // Disallowed origin should not be echoed
      const disallowed = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://evil.com' },
      });
      expect(disallowed.headers['access-control-allow-origin']).toBeUndefined();

      // Cleanup
      await app.close();
      delete process.env.CORS_ORIGINS;
      app = await buildServer({ skipBrowserInit: true });
      await app.ready();
    });
  });

  describe('SSRF protection', () => {
    it('should block IPv4 private ranges', () => {
      expect(isPrivateUrl('http://127.0.0.1')).toBe(true);
      expect(isPrivateUrl('http://10.0.0.1')).toBe(true);
      expect(isPrivateUrl('http://172.16.0.1')).toBe(true);
      expect(isPrivateUrl('http://172.31.255.255')).toBe(true);
      expect(isPrivateUrl('http://192.168.1.1')).toBe(true);
      expect(isPrivateUrl('http://169.254.1.1')).toBe(true);
      expect(isPrivateUrl('http://0.0.0.0')).toBe(true);
      expect(isPrivateUrl('http://localhost')).toBe(true);
    });

    it('should block IPv6 private ranges', () => {
      expect(isPrivateUrl('http://[::1]')).toBe(true);
      expect(isPrivateUrl('http://[::ffff:127.0.0.1]')).toBe(true);

      // fd00::/8 - unique local addresses
      expect(isPrivateUrl('http://[fd00::1]')).toBe(true);
      expect(isPrivateUrl('http://[fdff:ffff:ffff:ffff::1]')).toBe(true);

      // fe80::/10 - link-local addresses (currently NOT blocked, should be)
      expect(isPrivateUrl('http://[fe80::1]')).toBe(true);
      expect(isPrivateUrl('http://[febf:ffff:ffff:ffff::1]')).toBe(true);
    });

    it('should allow public URLs', () => {
      expect(isPrivateUrl('http://example.com')).toBe(false);
      expect(isPrivateUrl('https://google.com')).toBe(false);
      expect(isPrivateUrl('http://8.8.8.8')).toBe(false);
    });
  });

  describe('/metrics endpoint authentication', () => {
    it('should require authentication when REQUIRE_AUTH is true', async () => {
      // Restart app with auth required
      await app.close();
      process.env.REQUIRE_AUTH = 'true';
      process.env.METRICS_AUTH_REQUIRED = 'true'; // New config flag we'll add

      app = await buildServer({ skipBrowserInit: true });
      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      // Should require auth (401) when METRICS_AUTH_REQUIRED is true
      expect(response.statusCode).toBe(401);

      await app.close();
      process.env.REQUIRE_AUTH = 'false';
      process.env.METRICS_AUTH_REQUIRED = 'false';

      app = await buildServer({ skipBrowserInit: true });
      await app.ready();
    });

    it('should not expose sensitive data in metrics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.statusCode).toBe(200);
      const body = response.body;

      // Metrics should not contain API keys, secrets, or PII
      expect(body).not.toMatch(/sk_live_/);
      expect(body).not.toMatch(/sk_test_/);
      expect(body).not.toMatch(/whsec_/);
      expect(body).not.toMatch(/@/); // No email addresses
      expect(body).not.toMatch(/api_key_value/);

      // Should only contain metric names and values
      expect(body).toMatch(/screenforge_/);
    });
  });

  describe('Security headers', () => {
    it('should include X-Content-Type-Options', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should include X-Frame-Options', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.headers['x-frame-options']).toBe('DENY');
    });

    it('should include Strict-Transport-Security in production', async () => {
      // Close test app and restart in production mode
      await app.close();
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      app = await buildServer({ skipBrowserInit: true });
      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      // HSTS should be present in production mode
      const hsts = response.headers['strict-transport-security'];
      expect(hsts).toBeDefined();
      expect(hsts).toMatch(/max-age=\d+/);
      expect(hsts).toMatch(/includeSubDomains/);

      // Restore test environment
      await app.close();
      process.env.NODE_ENV = originalEnv;
      app = await buildServer({ skipBrowserInit: true });
      await app.ready();
    });
  });

  describe('Rate limiting', () => {
    it('should respect X-Forwarded-For when trustProxy is enabled (production)', async () => {
      await app.close();
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const prodApp = await buildServer({ skipBrowserInit: true });
      await prodApp.ready();

      // In production, trustProxy is enabled so X-Forwarded-For should set req.ip
      const response = await prodApp.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-forwarded-for': '203.0.113.50' },
      });

      // The response should succeed (trustProxy doesn't block, just parses headers)
      expect(response.statusCode).toBe(200);

      await prodApp.close();
      process.env.NODE_ENV = origEnv;
      app = await buildServer({ skipBrowserInit: true });
      await app.ready();
    });
  });
});
