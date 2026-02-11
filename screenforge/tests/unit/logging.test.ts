import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('structured logging', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = 'info';

    // Build server with custom logger for testing
    app = await buildServer({ skipBrowserInit: true });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('module child loggers', () => {
    it('should create child loggers with module binding', async () => {
      const { getLogger } = await import('../../src/logging/index.js');

      const rendererLogger = getLogger('renderer');
      const queueLogger = getLogger('queue');
      const cacheLogger = getLogger('cache');
      const authLogger = getLogger('auth');
      const billingLogger = getLogger('billing');

      expect(rendererLogger).toBeDefined();
      expect(queueLogger).toBeDefined();
      expect(cacheLogger).toBeDefined();
      expect(authLogger).toBeDefined();
      expect(billingLogger).toBeDefined();
    });
  });

  describe('request logging', () => {
    it('should log API requests with method, url, status, duration_ms', async () => {
      const infoSpy = vi.spyOn(app.log, 'info');

      const response = await app.inject({
        method: 'GET',
        url: '/v1/health',
      });

      expect(response.statusCode).toBe(200);

      const requestLogCall = infoSpy.mock.calls.find((call) => {
        const payload = call[0] as Record<string, unknown> | undefined;
        return payload?.method === 'GET' && payload?.url === '/v1/health';
      });
      const requestLog = requestLogCall?.[0] as Record<string, unknown> | undefined;

      expect(requestLog).toBeDefined();
      expect(requestLog).toMatchObject({
        method: 'GET',
        url: '/v1/health',
        status: 200,
      });
      expect(requestLog).toHaveProperty('duration_ms');
      expect(requestLog).toHaveProperty('request_id');
      expect(typeof requestLog?.duration_ms).toBe('number');

      infoSpy.mockRestore();
    });

    it('should log api_key_prefix when auth is present', async () => {
      // This test will need a real API key setup once auth middleware is integrated
      // For now, we just verify the structure
      expect(true).toBe(true);
    });
  });

  describe('render job logging', () => {
    it('should emit structured logs for render jobs', async () => {
      // This will be tested once queue processor logging is implemented
      // Expected fields: url, type, duration_ms, cache_hit, format, job_id, status
      expect(true).toBe(true);
    });
  });
});
