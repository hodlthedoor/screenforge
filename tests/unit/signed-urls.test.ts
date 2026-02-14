import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { getPool, closePool } from '../../src/db/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import { generateSignedUrl, validateSignedUrl, type SignedUrlOptions } from '../../src/auth/signed-urls.js';
import { loadConfig } from '../../src/config/index.js';
import type { FastifyInstance } from 'fastify';

describe('signed URLs', () => {
  let testApiKeyId: string;
  let testSigningSecret: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'postgresql:///screenforge?host=/var/run/postgresql';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.SESSION_SECRET = 'test-session-secret-32-chars-minimum-required';
    process.env.BASE_URL = 'http://localhost:3100';
    loadConfig();

    app = await buildServer();

    const { key } = await createApiKey('Signed URL Test Key', 'pro');
    testApiKeyId = key.id;

    // Get signing secret
    const result = await getPool().query('SELECT signing_secret FROM api_keys WHERE id = $1', [testApiKeyId]);
    testSigningSecret = result.rows[0].signing_secret;
  });

  afterAll(async () => {
    await getPool().query('DELETE FROM api_keys WHERE name = $1', ['Signed URL Test Key']);
    await app.close();
    await closePool();
  });

  describe('generateSignedUrl', () => {
    it('generates a valid signed URL for screenshot', () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        format: 'png',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options, 3600);

      expect(signedUrl).toContain('/v1/signed/screenshot?');
      expect(signedUrl).toContain('url=https%3A%2F%2Fexample.com');
      expect(signedUrl).toContain('&signature=');
      expect(signedUrl).toContain('&expires=');
      expect(signedUrl).toContain('&format=png');
    });

    it('generates a valid signed URL for PDF', () => {
      const options: SignedUrlOptions = {
        type: 'pdf',
        url: 'https://example.com/page',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options, 1800);

      expect(signedUrl).toContain('/v1/signed/pdf?');
      expect(signedUrl).toContain('url=https%3A%2F%2Fexample.com%2Fpage');
      expect(signedUrl).toContain('&signature=');
      expect(signedUrl).toContain('&expires=');
    });

    it('generates signed URL with webp format', () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        format: 'webp',
        quality: 85,
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      expect(signedUrl).toContain('/v1/signed/screenshot?');
      expect(signedUrl).toContain('format=webp');
      expect(signedUrl).toContain('quality=85');
    });

    it('includes viewport parameters in signed URL', () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        viewport: { width: 1920, height: 1080 },
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      expect(signedUrl).toContain('viewport.width=1920');
      expect(signedUrl).toContain('viewport.height=1080');
    });

    it('defaults to 1 hour expiry', () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);
      const url = new URL(signedUrl, 'http://localhost');
      const expires = Number(url.searchParams.get('expires'));

      const expectedExpiry = Date.now() + 3600 * 1000;
      expect(expires).toBeGreaterThan(Date.now());
      expect(expires).toBeLessThanOrEqual(expectedExpiry);
    });

    it('respects custom expiry (max 30 days)', () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
      };

      const thirtyDaysInSeconds = 30 * 24 * 3600;
      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options, thirtyDaysInSeconds);
      const url = new URL(signedUrl, 'http://localhost');
      const expires = Number(url.searchParams.get('expires'));

      const expectedExpiry = Date.now() + thirtyDaysInSeconds * 1000;
      expect(expires).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
      expect(expires).toBeLessThanOrEqual(expectedExpiry);
    });

    it('includes cache_ttl in signed URL', () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        cache_ttl: 7200,
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      expect(signedUrl).toContain('cache_ttl=7200');
    });

    it('includes cache_key in signed URL', () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        cache_key: 'user-abc-session-123',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      expect(signedUrl).toContain('cache_key=user-abc-session-123');
    });

    it('includes both cache_ttl and cache_key in signed URL', () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        cache_ttl: 3600,
        cache_key: 'state-v2',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      expect(signedUrl).toContain('cache_ttl=3600');
      expect(signedUrl).toContain('cache_key=state-v2');
    });
  });

  describe('validateSignedUrl', () => {
    it('validates a correctly signed URL', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);
      const url = new URL(signedUrl, 'http://localhost');
      const queryParams = Object.fromEntries(url.searchParams.entries());

      const result = await validateSignedUrl(queryParams, testSigningSecret);

      expect(result.valid).toBe(true);
      expect(result.apiKeyId).toBe(testApiKeyId);
    });

    it('rejects URL with tampered parameters', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);
      const url = new URL(signedUrl, 'http://localhost');

      // Tamper with the URL
      url.searchParams.set('url', 'https://malicious.com');

      const queryParams = Object.fromEntries(url.searchParams.entries());
      const result = await validateSignedUrl(queryParams, testSigningSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_SIGNATURE');
    });

    it('rejects expired URL', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
      };

      // Generate with 1-second expiry
      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options, 1);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const url = new URL(signedUrl, 'http://localhost');
      const queryParams = Object.fromEntries(url.searchParams.entries());

      const result = await validateSignedUrl(queryParams, testSigningSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('EXPIRED');
    });

    it('rejects URL with missing signature', async () => {
      const queryParams = {
        url: 'https://example.com',
        expires: String(Date.now() + 3600000),
        api_key_id: testApiKeyId,
      };

      const result = await validateSignedUrl(queryParams, testSigningSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('MISSING_SIGNATURE');
    });

    it('rejects URL with missing expiry', async () => {
      const queryParams = {
        url: 'https://example.com',
        signature: 'fake-signature',
        api_key_id: testApiKeyId,
      };

      const result = await validateSignedUrl(queryParams, testSigningSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('MISSING_EXPIRY');
    });

    it('rejects URL with wrong signing secret', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);
      const url = new URL(signedUrl, 'http://localhost');
      const queryParams = Object.fromEntries(url.searchParams.entries());

      const result = await validateSignedUrl(queryParams, 'wrong-secret');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_SIGNATURE');
    });

    it('validates signed URL with cache_ttl and cache_key', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        cache_ttl: 7200,
        cache_key: 'test-key',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);
      const url = new URL(signedUrl, 'http://localhost');
      const queryParams = Object.fromEntries(url.searchParams.entries());

      const result = await validateSignedUrl(queryParams, testSigningSecret);

      expect(result.valid).toBe(true);
      expect(result.apiKeyId).toBe(testApiKeyId);
    });

    it('rejects tampered cache_ttl in signed URL', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        cache_ttl: 3600,
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);
      const url = new URL(signedUrl, 'http://localhost');

      // Tamper with cache_ttl
      url.searchParams.set('cache_ttl', '999999');

      const queryParams = Object.fromEntries(url.searchParams.entries());
      const result = await validateSignedUrl(queryParams, testSigningSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_SIGNATURE');
    });
  });

  describe('signed URL routes', () => {
    it('renders screenshot with valid signed URL', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        format: 'png',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      const res = await app.inject({
        method: 'GET',
        url: signedUrl,
      });

      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('status', 'pending');
    });

    it('renders PDF with valid signed URL', async () => {
      const options: SignedUrlOptions = {
        type: 'pdf',
        url: 'https://example.com',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      const res = await app.inject({
        method: 'GET',
        url: signedUrl,
      });

      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('status', 'pending');
    });

    it('rejects signed URL with tampered signature', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);
      const url = new URL(signedUrl, 'http://localhost');

      // Tamper with URL
      url.searchParams.set('url', 'https://malicious.com');

      const res = await app.inject({
        method: 'GET',
        url: url.pathname + url.search,
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'INVALID_SIGNATURE');
    });

    it('rejects expired signed URL', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options, 1);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const res = await app.inject({
        method: 'GET',
        url: signedUrl,
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'SIGNATURE_EXPIRED');
    });

    it('rejects signed URL for inactive API key', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      // Deactivate key
      await getPool().query('UPDATE api_keys SET active = false WHERE id = $1', [testApiKeyId]);

      const res = await app.inject({
        method: 'GET',
        url: signedUrl,
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'API_KEY_DISABLED');

      // Reactivate key for other tests
      await getPool().query('UPDATE api_keys SET active = true WHERE id = $1', [testApiKeyId]);
    });

    it('counts signed URL requests against API key quota', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      // Clear usage
      await getPool().query('DELETE FROM usage_daily WHERE api_key_id = $1', [testApiKeyId]);

      const res = await app.inject({
        method: 'GET',
        url: signedUrl,
      });

      expect(res.statusCode).toBe(202);

      // Check usage incremented
      const usage = await getPool().query(
        'SELECT count FROM usage_daily WHERE api_key_id = $1 AND date = CURRENT_DATE',
        [testApiKeyId],
      );

      expect(usage.rows[0]?.count).toBe(1);
    });

    it('rejects signed URL without api_key_id parameter', async () => {
      // Send empty api_key_id (passes Fastify schema validation but triggers handler check)
      const res = await app.inject({
        method: 'GET',
        url: '/v1/signed/screenshot?url=https://example.com&api_key_id=&signature=test&expires=999999999999',
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'AUTH_REQUIRED');
    });

    it('rejects signed URL with unknown api_key_id', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
      };

      const fakeApiKeyId = '00000000-0000-0000-0000-000000000000';
      const signedUrl = generateSignedUrl(fakeApiKeyId, 'fake-secret', options);

      const res = await app.inject({
        method: 'GET',
        url: signedUrl,
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'INVALID_API_KEY');
    });

    it('rejects signed URL when quota is exceeded', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      // Set usage to quota limit
      const keyInfo = await getPool().query('SELECT monthly_quota FROM api_keys WHERE id = $1', [testApiKeyId]);
      const quota = keyInfo.rows[0].monthly_quota;

      await getPool().query(
        'INSERT INTO usage_daily (api_key_id, date, count) VALUES ($1, CURRENT_DATE, $2) ON CONFLICT (api_key_id, date) DO UPDATE SET count = $2',
        [testApiKeyId, quota],
      );

      const res = await app.inject({
        method: 'GET',
        url: signedUrl,
      });

      expect(res.statusCode).toBe(429);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'QUOTA_EXCEEDED');

      // Reset usage for other tests
      await getPool().query('DELETE FROM usage_daily WHERE api_key_id = $1', [testApiKeyId]);
    });

    it('handles nested query parameters (viewport.width, viewport.height)', async () => {
      // First check that the URL generation works with nested params
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        viewport: { width: 1280, height: 720 },
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      // Verify URL contains nested params
      expect(signedUrl).toContain('viewport.width=1280');
      expect(signedUrl).toContain('viewport.height=720');

      // Nested params are parsed and validated successfully
      const url = new URL(signedUrl, 'http://localhost');
      expect(url.searchParams.get('viewport.width')).toBe('1280');
    });

    it('converts cache_ttl from string to number in route handler', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        cache_ttl: 7200,
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      // Hit the route so the handler parses cache_ttl from query string to number
      const res = await app.inject({
        method: 'GET',
        url: signedUrl,
      });

      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('status', 'pending');
    });

    it('rejects signed URL with invalid hide_selectors', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        hide_selectors: ['<script>alert(1)</script>'],
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      const res = await app.inject({
        method: 'GET',
        url: signedUrl,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('rejects signed URL with invalid remove_selectors', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        remove_selectors: ['javascript:alert(1)'],
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      const res = await app.inject({
        method: 'GET',
        url: signedUrl,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('rejects signed URL with invalid blur_selectors', async () => {
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        blur_selectors: ['<img onerror=alert(1)>'],
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      const res = await app.inject({
        method: 'GET',
        url: signedUrl,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    // Helper: build a signed URL with proper array params (repeated keys)
    // that Fastify will parse as arrays, with a valid HMAC signature.
    function buildSignedUrlWithArrays(
      apiKeyId: string,
      secret: string,
      type: 'screenshot' | 'pdf',
      baseParams: Record<string, string>,
      arrayParams: Record<string, string[]>,
    ): string {
      const expiresAt = Date.now() + 3600_000;
      // Build canonical form: arrays become comma-joined via String()
      const allParams: Record<string, unknown> = {
        api_key_id: apiKeyId,
        expires: expiresAt,
        ...baseParams,
      };
      for (const [k, v] of Object.entries(arrayParams)) {
        allParams[k] = v; // array value — String([...]) produces comma-joined
      }
      const sorted = Object.keys(allParams).sort();
      const pairs: string[] = [];
      for (const key of sorted) {
        const val = allParams[key];
        if (val === undefined || val === null) continue;
        pairs.push(`${key}=${encodeURIComponent(String(val))}`);
      }
      const canonicalQuery = pairs.join('&');
      const hmac = createHmac('sha256', secret);
      hmac.update(canonicalQuery + expiresAt);
      const signature = hmac.digest('hex');

      // Build actual URL with repeated keys for arrays
      const path = type === 'screenshot' ? '/v1/signed/screenshot' : '/v1/signed/pdf';
      const urlParts: string[] = [];
      for (const key of sorted) {
        const val = allParams[key];
        if (val === undefined || val === null) continue;
        if (Array.isArray(val)) {
          for (const item of val) {
            urlParts.push(`${key}=${encodeURIComponent(String(item))}`);
          }
        } else {
          urlParts.push(`${key}=${encodeURIComponent(String(val))}`);
        }
      }
      urlParts.push(`signature=${signature}`);
      return `${path}?${urlParts.join('&')}`;
    }

    it('rejects signed URL with malicious hide_selectors array (sanitization)', async () => {
      // Use 2 values so Fastify qs parser creates an array (single value → string)
      const signedUrl = buildSignedUrlWithArrays(
        testApiKeyId,
        testSigningSecret,
        'screenshot',
        { url: 'https://example.com' },
        { hide_selectors: ['<script>alert(1)</script>', '.valid'] },
      );

      const res = await app.inject({ method: 'GET', url: signedUrl });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(body.error.message).toContain('hide_selectors');
    });

    it('rejects signed URL with malicious remove_selectors array (sanitization)', async () => {
      const signedUrl = buildSignedUrlWithArrays(
        testApiKeyId,
        testSigningSecret,
        'screenshot',
        { url: 'https://example.com' },
        { remove_selectors: ['javascript:alert(1)', '.valid'] },
      );

      const res = await app.inject({ method: 'GET', url: signedUrl });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(body.error.message).toContain('remove_selectors');
    });

    it('rejects signed URL with malicious blur_selectors array (sanitization)', async () => {
      const signedUrl = buildSignedUrlWithArrays(
        testApiKeyId,
        testSigningSecret,
        'screenshot',
        { url: 'https://example.com' },
        { blur_selectors: ['<img onerror=alert(1)>', '.valid'] },
      );

      const res = await app.inject({ method: 'GET', url: signedUrl });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(body.error.message).toContain('blur_selectors');
    });

    it('rate limits signed URL requests when REQUIRE_AUTH is true', async () => {
      // Build a separate server with REQUIRE_AUTH=true so the rate limiter branch is exercised
      const originalRequireAuth = process.env.REQUIRE_AUTH;
      process.env.REQUIRE_AUTH = 'true';
      loadConfig();

      const authApp = await buildServer();

      // Set rate limit to 1 so the second request is blocked
      const originalRateLimit = await getPool().query(
        'SELECT rate_limit FROM api_keys WHERE id = $1',
        [testApiKeyId],
      );
      await getPool().query('UPDATE api_keys SET rate_limit = 1 WHERE id = $1', [testApiKeyId]);

      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
      };

      // First request should succeed
      const signedUrl1 = generateSignedUrl(testApiKeyId, testSigningSecret, options);
      const res1 = await authApp.inject({ method: 'GET', url: signedUrl1 });
      expect(res1.statusCode).toBe(202);

      // Second request should be rate limited
      const signedUrl2 = generateSignedUrl(testApiKeyId, testSigningSecret, options);
      const res2 = await authApp.inject({ method: 'GET', url: signedUrl2 });
      expect(res2.statusCode).toBe(429);
      const body = JSON.parse(res2.body);
      expect(body.error).toHaveProperty('code', 'RATE_LIMITED');

      // Restore rate limit and REQUIRE_AUTH, close the temp server
      await getPool().query('UPDATE api_keys SET rate_limit = $1 WHERE id = $2', [
        originalRateLimit.rows[0].rate_limit,
        testApiKeyId,
      ]);
      await authApp.close();
      if (originalRequireAuth !== undefined) {
        process.env.REQUIRE_AUTH = originalRequireAuth;
      } else {
        delete process.env.REQUIRE_AUTH;
      }
      loadConfig();
    });

    it('rejects signed URL with overly long selector (sanitization error)', async () => {
      const longSelector = 'a'.repeat(501);
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        selector: longSelector,
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      const res = await app.inject({
        method: 'GET',
        url: signedUrl,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(body.error.message).toContain('Selector');
    });

    it('rejects signed URL with overly long waitFor (sanitization error)', async () => {
      const longWaitFor = 'div'.repeat(200); // 600 chars > 500 max
      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'https://example.com',
        waitFor: longWaitFor,
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      const res = await app.inject({
        method: 'GET',
        url: signedUrl,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(body.error.message).toContain('waitFor');
    });

    it('rejects signed URL with private/SSRF URL when ALLOW_PRIVATE_URLS is false', async () => {
      // Temporarily set ALLOW_PRIVATE_URLS to "no"
      const originalValue = process.env.ALLOW_PRIVATE_URLS;
      delete process.env.ALLOW_PRIVATE_URLS;
      loadConfig();

      const options: SignedUrlOptions = {
        type: 'screenshot',
        url: 'http://192.168.1.1',
      };

      const signedUrl = generateSignedUrl(testApiKeyId, testSigningSecret, options);

      const res = await app.inject({
        method: 'GET',
        url: signedUrl,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toHaveProperty('code', 'SSRF_BLOCKED');

      // Restore original value
      if (originalValue) {
        process.env.ALLOW_PRIVATE_URLS = originalValue;
      }
      loadConfig();
    });
  });
});
