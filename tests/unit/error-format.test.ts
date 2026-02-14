import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { loadConfig } from '../../src/config/index.js';
import type { FastifyInstance } from 'fastify';

describe('error response format', () => {
  let app: FastifyInstance;

  function expectCanonicalEnvelope(
    body: Record<string, unknown>,
    code: string,
    message: string,
    requestId: string,
  ) {
    expect(body).toMatchObject({
      error: {
        code,
        message,
        request_id: requestId,
      },
    });
  }

  function expectNoLegacyErrorShape(body: Record<string, unknown>) {
    expect(body).not.toHaveProperty('code');
    expect(body).not.toHaveProperty('statusCode');
    expect(typeof body.error).toBe('object');
  }

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
      const requestId = String(response.headers['x-request-id']);

      expectCanonicalEnvelope(body, 'VALIDATION_ERROR', 'Validation failed', requestId);
      expectNoLegacyErrorShape(body);
      expect(body.error.details).toBeDefined();
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
      const requestId = String(response.headers['x-request-id']);

      expectCanonicalEnvelope(body, 'AUTH_REQUIRED', 'API key required. Provide via Authorization: Bearer <key> or x-api-key header.', requestId);
      expectNoLegacyErrorShape(body);
    });

    it('should return consistent format for not found errors', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/render/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      const requestId = String(response.headers['x-request-id']);

      expectCanonicalEnvelope(body, 'JOB_NOT_FOUND', 'Job not found', requestId);
      expectNoLegacyErrorShape(body);
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

      expect(body.error.details).toBeDefined();
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
      const body = JSON.parse(response.body);
      expect(body.error.request_id).toBe(customRequestId);
    });

    it('should return canonical envelope for batch validation errors', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/batch',
        headers: { 'content-type': 'application/json' },
        payload: { items: [] },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      const requestId = String(response.headers['x-request-id']);
      expectCanonicalEnvelope(body, 'VALIDATION_ERROR', 'Validation failed', requestId);
      expectNoLegacyErrorShape(body);
      expect(body.error.details).toBeDefined();
    });

    it('should return canonical envelope for OG validation errors', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/og',
        headers: { 'content-type': 'application/json' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      const requestId = String(response.headers['x-request-id']);
      expectCanonicalEnvelope(body, 'VALIDATION_ERROR', 'Either url or title must be provided', requestId);
      expectNoLegacyErrorShape(body);
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
        'NOT_FOUND',
      ];

      for (const code of expectedCodes) {
        expect(codes).toContain(code);
      }
    });
  });
});
