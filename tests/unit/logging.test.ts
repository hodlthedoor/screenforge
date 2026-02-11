import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import { createApiKey } from '../../src/db/api-keys.js';
import { getPool, closePool, resetPool } from '../../src/db/index.js';

describe('structured logging', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let apiKeyId: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'info';
    process.env.REQUIRE_AUTH = 'true';

    app = await buildServer({ skipBrowserInit: true });
    const created = await createApiKey('Logging Test Key', 'starter');
    apiKey = created.rawKey;
    apiKeyId = created.key.id;
  });

  afterAll(async () => {
    await app.close();
    const pool = getPool();
    await pool.query('DELETE FROM usage_daily WHERE api_key_id = $1', [apiKeyId]);
    await pool.query('DELETE FROM api_keys WHERE id = $1', [apiKeyId]);
    await closePool();
    resetPool();
    delete process.env.REQUIRE_AUTH;
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
    it('should log API requests with method, url, status, duration_ms, request_id, api_key_prefix', async () => {
      const infoSpy = vi.spyOn(app.log, 'info');

      const response = await app.inject({
        method: 'POST',
        url: '/v1/screenshot',
        headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
        payload: { url: 'not-a-valid-url' },
      });

      expect(response.statusCode).toBe(400);

      const requestLogCall = infoSpy.mock.calls.find((call) => {
        const payload = call[0] as Record<string, unknown> | undefined;
        return payload?.method === 'POST' && payload?.url === '/v1/screenshot';
      });
      const requestLog = requestLogCall?.[0] as Record<string, unknown> | undefined;

      expect(requestLog).toBeDefined();
      expect(requestLog).toMatchObject({
        method: 'POST',
        url: '/v1/screenshot',
        status: 400,
      });
      expect(typeof requestLog?.api_key_prefix).toBe('string');
      expect(String(requestLog?.api_key_prefix)).toMatch(/^sf_/);
      expect(requestLog).toHaveProperty('duration_ms');
      expect(requestLog).toHaveProperty('request_id');
      expect(typeof requestLog?.duration_ms).toBe('number');

      infoSpy.mockRestore();
    });
  });
});
