import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { loadConfig } from '../../src/config/index.js';
import type { FastifyInstance } from 'fastify';

describe('error response format', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.REQUIRE_AUTH = 'false';
    app = await buildServer({ skipBrowserInit: true });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('canonical error envelope', () => {
    it('should return consistent format for validation errors', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'content-type': 'application/json' },
        payload: { url: 'not-a-valid-url' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);

      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.error).toBeDefined();
      expect(body.statusCode).toBe(400);
      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('should return consistent format for auth errors', async () => {
      // Enable auth requirement
      process.env.REQUIRE_AUTH = 'true';
      const testApp = await buildServer({ skipBrowserInit: true });

      const response = await testApp.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'content-type': 'application/json' },
        payload: { url: 'https://example.com' },
      });

      await testApp.close();
      process.env.REQUIRE_AUTH = 'false';
      loadConfig();

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);

      expect(body.code).toBe('AUTH_REQUIRED');
      expect(body.error).toBeDefined();
      expect(body.statusCode).toBe(401);
      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('should return consistent format for not found errors', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/render/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);

      expect(body.code).toBe('JOB_NOT_FOUND');
      expect(body.error).toBeDefined();
      expect(body.statusCode).toBe(404);
      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('should include details field only when needed', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'content-type': 'application/json' },
        payload: { url: 'not-a-url', width: 'invalid-width' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);

      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.details).toBeDefined();
    });

    it('should always include request_id matching x-request-id header', async () => {
      const customRequestId = 'test-request-id-12345';

      const response = await app.inject({
        method: 'GET',
        url: '/v1/render/00000000-0000-0000-0000-000000000001',
        headers: { 'x-request-id': customRequestId },
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['x-request-id']).toBe(customRequestId);
    });
  });

  describe('error codes endpoint', () => {
    it('should return documented error codes at GET /v1/errors', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/errors',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('errors');
      expect(Array.isArray(body.errors)).toBe(true);

      // Verify structure of each error doc
      const firstError = body.errors[0];
      expect(firstError).toHaveProperty('code');
      expect(firstError).toHaveProperty('http_status');
      expect(firstError).toHaveProperty('description');
      expect(firstError).toHaveProperty('retry_guidance');
    });

    it('should include all error codes in documentation', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/errors',
      });

      const body = JSON.parse(response.body);
      const codes = body.errors.map((e: { code: string }) => e.code);

      const expectedCodes = [
        'VALIDATION_ERROR',
        'INVALID_URL',
        'SSRF_BLOCKED',
        'AUTH_REQUIRED',
        'INVALID_API_KEY',
        'INVALID_ADMIN_KEY',
        'API_KEY_DISABLED',
        'QUOTA_EXCEEDED',
        'RATE_LIMITED',
        'RENDER_TIMEOUT',
        'RENDER_FAILED',
        'JOB_NOT_FOUND',
        'BATCH_NOT_FOUND',
        'BATCH_TOO_LARGE',
        'ADMIN_NOT_CONFIGURED',
        'INTERNAL_ERROR',
      ];

      for (const code of expectedCodes) {
        expect(codes).toContain(code);
      }
    });
  });
});
